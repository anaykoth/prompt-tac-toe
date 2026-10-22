import { COURSES, PUTTING_DRILLS } from '../src/golf/course.js';
import { ShotStore, shotSummary } from './shot-store.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { validateTake, recordingBundle, MAX_TAKES } from '../src/phone/recording.js';
import { validateCalibration, isRotation } from '../src/phone/screen-pose.js';
import { CLUBS } from '../src/golf/model.js';
import { validateSwingAnalysis } from '../src/phone/swing-analysis.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secret = () => randomBytes(24).toString('hex');
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const validNumber = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
const tokenEquals = (a, b) => typeof a === 'string' && a.length === 48 && a === b;

/** A separate, ephemeral phone relay. No pub identities, ledger, or source files. */
export function createPhoneServer({ port = 8790, host = '127.0.0.1', publicUrl = '', now = Date.now, recordingDirectory = path.join(ROOT, 'recordings/swing-lab'), shotDirectory = path.join(ROOT, 'recordings/golf-shots') } = {}) {
  const rooms = new Map(),shotStore=new ShotStore(shotDirectory);
  const send = (ws, packet) => { if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 65536) ws.send(JSON.stringify(packet)); };
  const online = ws => ws?.readyState === WebSocket.OPEN;
  const roster = room => [...room.players.values()].map(p => ({ id:p.id, name:p.name, online:online(p.ws) }));
  const broadcast = (room, packet) => { send(room.host,packet); for(const p of room.players.values())send(p.ws,packet); };
  const playerState = (room, player) => {
    if(!room.state)return null;
    const mine=room.state.standings?.find(p=>p.id===player.id),yourTurn=player.id===room.activePlayerId;
    return {...room.state,...(!yourTurn&&mine?{shots:mine.shots,toPin:mine.toPin,lie:mine.lie,holed:mine.holed}:{}),activePlayerId:room.activePlayerId,yourTurn};
  };
  const states = room => { for(const p of room.players.values())if(room.state)send(p.ws,{type:'state',state:playerState(room,p)}); };
  const presence = room => broadcast(room, { type:'presence', host:online(room.host), controller:online(room.players.get(room.activePlayerId)?.ws), players:roster(room), activePlayerId:room.activePlayerId });
  const cleanName = value => String(value || '').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,24);

  const server = http.createServer(async (req, res) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400).end(); return; }
    if(pathname==='/phone-shots'){
      res.setHeader('Content-Type','application/json');
      const url=new URL(req.url,'http://localhost'),room=rooms.get(url.searchParams.get('room')),token=req.headers.authorization?.replace(/^Bearer /,'');
      const player=room&&[...room.players.values()].find(p=>tokenEquals(token,p.token));
      const isHost=room&&tokenEquals(token,room.hostToken);
      if(!room||(!isHost&&!player)){res.writeHead(401).end(JSON.stringify({error:'Pair with the game to access shot data.'}));return;}
      try{if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)throw Error();}catch{res.writeHead(403).end();return;}
      if(req.method==='GET'){
        const records=[...room.shotRecords.values()].filter(r=>isHost||r.playerId===player.id).map(shotSummary);
        res.end(JSON.stringify({records}));return;
      }
      if(req.method!=='POST'){res.writeHead(405).end();return;}
      try{
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>256*1024){res.writeHead(413).end(JSON.stringify({error:'Shot record is too large.'}));return;}chunks.push(chunk);}
        const event=JSON.parse(Buffer.concat(chunks).toString());
        const record=shotStore.save(room,isHost?{role:'host'}:{role:'controller',id:player.id,name:player.name},event);
        send(room.host,{type:'shot.saved',id:record.id,playerId:record.playerId,kind:event.kind});
        res.end(JSON.stringify({record:shotSummary(record)}));
      }catch(error){res.writeHead(400).end(JSON.stringify({error:error instanceof SyntaxError?'Invalid JSON.':error.message}));}
      return;
    }
    if (pathname === '/phone-takes') {
      res.setHeader('Content-Type', 'application/json');
      const url = new URL(req.url, 'http://localhost'), room = rooms.get(url.searchParams.get('room'));
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      const authorized = room && (tokenEquals(token, room.hostToken) || [...room.players.values()].some(p => tokenEquals(token,p.token)));
      if (!authorized) { res.writeHead(401).end(JSON.stringify({ error: 'Pair with the range first.' })); return; }
      try { if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw Error(); }
      catch { res.writeHead(403).end(); return; }
      if (req.method === 'GET') { res.end(JSON.stringify(recordingBundle([...room.takes.values()]))); return; }
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      try {
        const chunks = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 1024 * 1024) { res.writeHead(413).end(JSON.stringify({ error: 'Take is too large.' })); return; } chunks.push(chunk); }
        const take = JSON.parse(Buffer.concat(chunks).toString());
        if (!validateTake(take)) throw Error('Invalid recording data.');
        if (!room.takes.has(take.id) && room.takes.size >= MAX_TAKES) throw Error('Twelve takes saved. Start a new range for another session.');
        const filename = `${room.code}-${take.id}.json`;
        fs.mkdirSync(recordingDirectory, { recursive: true });
        const destination = path.join(recordingDirectory, filename);
        fs.writeFileSync(destination + '.tmp', JSON.stringify(recordingBundle([take]), null, 2) + '\n', { mode: 0o600 });
        fs.renameSync(destination + '.tmp', destination);
        room.takes.set(take.id, take);
        const packet = { type: 'lab.saved', id: take.id, count: room.takes.size, filename };
        broadcast(room, packet);
        res.end(JSON.stringify(packet));
      } catch (error) { res.writeHead(400).end(JSON.stringify({ error: error instanceof SyntaxError ? 'Invalid JSON.' : 'Could not save the take. ' + error.message })); }
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    if (pathname === '/phone-config') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ publicUrl, ok: true })); return;
    }
    if (pathname === '/') pathname = '/golf.html';
    if (!['/golf.html', '/controller.html'].includes(pathname) && !/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css|woff2|png|svg)$/.test(pathname)) {
      res.writeHead(404).end('This server only hosts Felt Fairway and its phone controller.'); return;
    }
    const filename = path.join(ROOT, 'dist', pathname);
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) { res.writeHead(404).end('Run npm run build first.'); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(filename)]);
    res.writeHead(200);
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(filename).pipe(res);
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384 });
  server.on('upgrade', (req, socket, head) => {
    try {
      if (new URL(req.url, 'http://localhost').pathname !== '/phone-ws') throw Error();
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw Error();
    } catch { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    ws.alive = true; ws.count = 0; ws.window = now();
    const timeout = setTimeout(() => { if (!ws.room) ws.close(1008, 'Pair first'); }, 10000);
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    ws.on('message', raw => {
      try {
        if (now() - ws.window >= 1000) { ws.count = 0; ws.window = now(); }
        if (++ws.count > 100) { ws.close(1008, 'Too many inputs'); return; }
        const p = JSON.parse(raw);
        if (!p || typeof p !== 'object' || Array.isArray(p)) throw Error('Invalid message.');
        if (p.type === 'ping') { send(ws, { type: 'pong', sent: p.sent }); return; }
        if (!ws.room) {
          let room;
          if (p.type === 'host') {
            if (p.room) {
              room = rooms.get(p.room);
              if (!room || !tokenEquals(p.token, room.hostToken)) throw Error('This session expired. Open a new range.');
            } else {
              if (rooms.size >= 100) throw Error('The range is full. Try again later.');
              let code; do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (rooms.has(code));
              room = { code, hostToken: secret(), pairToken: secret(), host: null, players: new Map(), activePlayerId: null, state: null, sessionId:secret().slice(0,16), shotRecords:new Map(), takes: new Map(), touched: now() };
              rooms.set(code, room);
            }
            if (online(room.host)) room.host.close(4001, 'Range opened in another tab');
            room.host = ws; ws.role = 'host';
            send(ws, { type: 'welcome', role: 'host', room: room.code, token: room.hostToken, pairKey: room.pairToken, labCount: room.takes.size, players:roster(room), activePlayerId:room.activePlayerId });
          } else if (p.type === 'join') {
            room = rooms.get(p.room);
            if (!room) throw Error('This range has closed. Scan the current QR code.');
            let player = [...room.players.values()].find(player => tokenEquals(p.token,player.token));
            if (!player) {
              if (!tokenEquals(p.key,room.pairToken)) throw Error('This pairing link has expired or is already in use. Ask the computer for a new QR code.');
              if(room.players.size>=8)throw Error('Eight players have joined. Remove a player on the computer to add another.');
              player={id:secret().slice(0,12),token:secret(),name:cleanName(p.name)||`Player ${room.players.size+1}`,ws:null,seen:new Set()};
              room.players.set(player.id,player);room.activePlayerId ||= player.id;
              room.pairToken=secret();send(room.host,{type:'pair.key',key:room.pairToken,joined:true});
            }
            if(online(player.ws))player.ws.close(4001,'Controller opened in another tab');
            player.ws=ws;ws.role='controller';ws.playerId=player.id;
            send(ws,{type:'welcome',role:'controller',room:room.code,token:player.token,playerId:player.id,name:player.name,state:playerState(room,player),labCount:room.takes.size});
          } else throw Error('Pair with the range first.');
          ws.room = room; room.touched = now(); clearTimeout(timeout); presence(room); return;
        }
        const room = ws.room;
        if ((ws.role==='host'?room.host:room.players.get(ws.playerId)?.ws) !== ws) throw Error('This connection was replaced.');
        room.touched = now();
        const player=room.players.get(ws.role==='controller'?ws.playerId:(p.playerId||room.activePlayerId));
        const relay=packet=>{const tagged={...packet,playerId:player?.id};send(room.host,tagged);send(player?.ws,tagged);};
        if(ws.role==='controller'&&p.type==='player.name'){
          const name=cleanName(p.name);if(!name)throw Error('Enter a player name.');player.name=name;presence(room);return;
        }
        if (p.type === 'grip.request') {
          if([...room.players.values()].some(other=>other!==player&&(other.cameraTarget||other.gripRequest?.expires>now())))throw Error('Another player is aligning. Wait for their screen setup to finish.');
          if (!player?.alignmentId || !online(room.host) || !online(player.ws)) throw Error('Lock screen alignment with the phone first.');
          if (!player.gripRequest || player.gripRequest.expires < now()) player.gripRequest = { id: secret().slice(0, 16), expires: now() + 8000 };
          const packet = { type: 'grip.countdown', requestId: player.gripRequest.id, alignmentId: player.alignmentId, seconds: 2 };
          relay(packet); return;
        }
        if (p.type === 'grip.cancel') {
          if(!player)return;
          const request = player.gripRequest; player.gripRequest = null;
          if (request) { const packet = { type: 'grip.result', requestId: request.id, ok: false, message: 'Resting position capture cancelled. Try again when ready.' }; relay(packet); }
          if (p.invalidate && ws.role === 'controller') { player.alignmentId = null; relay({type:'grip.unavailable'}); }
          return;
        }
        if (p.type === 'camera.cancel') {
          if(player)player.cameraTarget = null;
          relay({type:'camera.cancelled'});return;
        }
        if (ws.role === 'host') {
          if (p.type === 'camera.visible') {
            if (!player?.cameraTarget || p.requestId !== player.cameraTarget.requestId) throw Error('Alignment target expired.');
            player.cameraTarget.visible = true; send(player.ws, { type: 'camera.visible', requestId: p.requestId }); return;
          }
          if (p.type === 'pair.reset') {
            room.pairToken=secret();send(ws,{type:'pair.key',key:room.pairToken});return;
          }
          if(p.type==='player.remove'){
            if(room.state?.busy&&!room.state?.finished)throw Error('Wait for the ball to stop.');
            const removed=room.players.get(p.playerId);if(!removed)throw Error('Player not found.');
            room.players.delete(removed.id);removed.ws?.close(4001,'Removed from this game. Scan a fresh QR to rejoin.');
            if(room.activePlayerId===removed.id)room.activePlayerId=room.players.keys().next().value||null;
            presence(room);states(room);return;
          }
          if (p.type !== 'state' || !p.state || typeof p.state !== 'object') throw Error('Unknown range message.');
          const s = p.state;
          if (!Object.hasOwn(CLUBS, s.club) || !validNumber(s.aim, -35, 35) || ![60, 110, 170].includes(s.target) || !Number.isSafeInteger(s.shots) || s.shots < 0 || !Number.isSafeInteger(s.score) || s.score < 0) throw Error('Invalid game state.');
          const nextState = { club: s.club, aim: s.aim, target: s.target, shots: s.shots, score: s.score, busy: !!s.busy, finished: !!s.finished, message: String(s.message || '').slice(0, 160), lastDistance: validNumber(s.lastDistance, 0, 1000) ? s.lastDistance : 0 };
          if (s.mode !== undefined) {
            if (!['course', 'putting'].includes(s.mode) || !validNumber(s.toPin, 0, 1000) || !['tee', 'fairway', 'rough', 'bunker', 'fringe', 'green', 'holed'].includes(s.lie)) throw Error('Invalid course state.');
            Object.assign(nextState, { mode: s.mode, toPin: s.toPin, lie: s.lie, holed: !!s.holed });
          }
          if(s.cartMode!==undefined){
            if(typeof s.cartMode!=='boolean'||!validNumber(s.cartDistance,0,2000)||!validNumber(s.cartSpeed,0,120)||(s.cartBoost!==undefined&&!validNumber(s.cartBoost,0,1))||['cartBoosting','cartDrifting','cartSpinning'].some(k=>s[k]!==undefined&&typeof s[k]!=='boolean'))throw Error('Invalid cart state.');
            Object.assign(nextState,{cartMode:s.cartMode,cartDistance:s.cartDistance,cartSpeed:s.cartSpeed,cartArrived:!!s.cartArrived,cartBoost:s.cartBoost??1,cartBoosting:!!s.cartBoosting,cartDrifting:!!s.cartDrifting,cartSpinning:!!s.cartSpinning});
          }
          if(s.testSwing!==undefined&&typeof s.testSwing!=='boolean')throw Error('Invalid test mode.');
          if(s.drill!==undefined&&!Object.hasOwn(PUTTING_DRILLS,s.drill))throw Error('Invalid putting drill.');
          if(s.courseId!==undefined&&!Object.hasOwn(COURSES,s.courseId))throw Error('Invalid course.');
          Object.assign(nextState,{courseId:s.courseId||'bramble',testSwing:!!s.testSwing,drill:s.drill||'standard',puttRead:String(s.puttRead||'').slice(0,160)});
          if(s.standings!==undefined){
            if(!Array.isArray(s.standings)||s.standings.length>8||s.standings.some(p=>!room.players.has(p.id)||!Number.isSafeInteger(p.shots)||p.shots<0||!validNumber(p.toPin,0,1000)||!['tee','fairway','rough','bunker','fringe','green','holed'].includes(p.lie)))throw Error('Invalid player scores.');
            nextState.standings=s.standings.map(({id,shots,toPin,lie,holed})=>({id,shots,toPin,lie,holed:!!holed}));
          }
          if(s.activePlayerId!==undefined){
            if(s.activePlayerId!==null&&!room.players.has(s.activePlayerId))throw Error('Player not found.');
            room.activePlayerId=s.activePlayerId;
          }
          room.state=nextState;states(room);return;
        }
        if (!online(room.host)) throw Error('The computer disconnected. Wait for it to return.');
        if (p.type === 'grip.result') {
          if (!player.gripRequest || player.gripRequest.id !== p.requestId || player.gripRequest.expires < now() || typeof p.ok !== 'boolean' || (p.ok && !isRotation(p.gripScreen))) throw Error('Invalid or expired resting position capture.');
          player.gripRequest = null;
          const packet = { type: 'grip.result', requestId: p.requestId, ok: p.ok, message: p.ok ? 'Resting position set. Ready to swing.' : String(p.message || 'Could not read the phone. Try again.').slice(0, 180) };
          relay(packet); return;
        }
        if (p.type === 'camera.request') {
          if(room.state?.busy&&!room.state?.finished)throw Error('Wait for the ball to stop before aligning.');
          if([...room.players.values()].some(other=>other!==player&&(other.cameraTarget||other.gripRequest?.expires>now())))throw Error('Another player is aligning. Wait for their screen setup to finish.');
          player.alignmentId = null; player.gripRequest = null;
          player.cameraTarget = { requestId: secret().slice(0, 16), markerId: randomInt(250), visible: false };
          const packet = { type: 'camera.target', requestId: player.cameraTarget.requestId, markerId: player.cameraTarget.markerId };
          relay(packet); return;
        }
        if (p.type === 'camera.lock') {
          const target = player.cameraTarget;
          if (!target?.visible || p.requestId !== target.requestId || !validateCalibration(p.calibration) || p.calibration.markerId !== target.markerId) throw Error('Invalid or expired camera alignment. Point at the current target and try again.');
          player.cameraTarget = null;
          player.alignmentId = p.requestId; player.gripRequest = null;
          const packet = { type: 'camera.locked', requestId: p.requestId, calibration: p.calibration };
          relay(packet); return;
        }
        if (p.type === 'lab.status') {
          if (!['countdown', 'recording', 'idle', 'uploading'].includes(p.status) || !validNumber(p.elapsed, 0, 12000)) throw Error('Invalid lab status.');
          send(room.host, { type: 'lab.status', status: p.status, elapsed: p.elapsed, label: String(p.label || 'Swing').slice(0, 80) }); return;
        }
        if(player.id!==room.activePlayerId){
          if(p.type==='motion'||p.type==='action'&&['aim','cancel','calibrated'].includes(p.action))return;
          throw Error('Wait for your turn. The computer can select your player.');
        }
        if (p.type === 'motion') {
          if (!['pitch', 'roll', 'yaw', 'power'].every(k => validNumber(p[k], k === 'power' ? 0 : -180, k === 'power' ? 1 : 180))) throw Error('Invalid motion.');
          if (p.face !== undefined && !validNumber(p.face, -45, 45)) throw Error('Invalid clubface.');
          if(p.shaft!==undefined&&(!Array.isArray(p.shaft)||p.shaft.length!==3||!p.shaft.every(v=>validNumber(v,-1.01,1.01))))throw Error('Invalid shaft pose.');
          send(room.host, { type: 'motion', playerId:player.id, pitch: p.pitch, roll: p.roll, yaw: p.yaw, face: p.face ?? 0, power: p.power, armed: !!p.armed, shaft:p.shaft }); return;
        }
        if(p.type==='drive'){
          if(!room.state?.cartMode||!validNumber(p.steering,-1,1)||!validNumber(p.throttle,-1,1)||typeof p.brake!=='boolean'||['drift','boost'].some(k=>p[k]!==undefined&&typeof p[k]!=='boolean'))throw Error('Invalid cart control.');
          send(room.host,{type:'drive',playerId:player.id,steering:p.steering,throttle:p.throttle,brake:p.brake,drift:!!p.drift,boost:!!p.boost});return;
        }
        if (p.type === 'shot') {
          if(room.state?.cartMode)throw Error('Leave the cart before swinging.');
          if (typeof p.id !== 'string' || !/^[\w-]{1,64}$/.test(p.id) || !validNumber(p.power, .02, 1) || !validNumber(p.curve, -1, 1)) throw Error('Invalid swing.');
          if(p.testSwing!==undefined&&typeof p.testSwing!=='boolean')throw Error('Invalid test swing.');
          if(p.analysis!==undefined&&!validateSwingAnalysis(p.analysis))throw Error('Invalid swing analysis.');
          if (player.seen.has(p.id)) return;
          player.seen.add(p.id); if (player.seen.size > 128) player.seen.delete(player.seen.values().next().value);
          send(room.host, { type: 'shot', playerId:player.id, id: p.id, power: p.power, curve: p.curve, analysis:p.analysis, testSwing:!!p.testSwing }); return;
        }
        if (p.type === 'action') {
          if (!['aim', 'club', 'target', 'mode', 'next', 'reset', 'calibrated', 'cancel', 'test', 'drill', 'course', 'cart'].includes(p.action)) throw Error('Unknown control.');
          if (p.action === 'aim' && !validNumber(p.value, -35, 35)) throw Error('Invalid aim.');
          if (p.action === 'club' && !Object.hasOwn(CLUBS, p.value)) throw Error('Invalid club.');
          if (p.action === 'mode' && !['course', 'putting'].includes(p.value)) throw Error('Invalid play mode.');
          if(p.action==='cart'&&!['enter','exit'].includes(p.value))throw Error('Invalid cart action.');
          if(p.action==='course'&&!Object.hasOwn(COURSES,p.value))throw Error('Invalid course.');
          if(p.action==='test'&&typeof p.value!=='boolean')throw Error('Invalid test mode.');
          if(p.action==='drill'&&!Object.hasOwn(PUTTING_DRILLS,p.value))throw Error('Invalid putting drill.');
          if (p.action === 'target' && ![60, 110, 170].includes(p.value)) throw Error('Invalid target.');
          send(room.host, { type: 'action', playerId:player.id, action: p.action, value: p.value }); return;
        }
        throw Error('Unknown controller message.');
      } catch (error) { send(ws, { type: 'error', message: error instanceof SyntaxError ? 'Invalid message.' : error.message }); }
    });
    ws.on('close', () => {
      clearTimeout(timeout);
      const room = ws.room;
      if(!room)return;
      const player=room.players.get(ws.playerId);
      if(ws.role==='host'&&room.host===ws){room.host=null;for(const p of room.players.values()){p.cameraTarget=null;p.alignmentId=null;p.gripRequest=null;}}
      else if(player?.ws===ws){player.ws=null;player.cameraTarget=null;player.alignmentId=null;player.gripRequest=null;}
      else return;
      room.touched=now();presence(room);
    });
  });
  const maintenance = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }
    for (const [code, room] of rooms) if (!online(room.host) && ![...room.players.values()].some(p=>online(p.ws)) && now() - room.touched > 30 * 60 * 1000) rooms.delete(code);
  }, 15000);
  return {
    setPublicUrl(value) { publicUrl = value; },
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve(server.address())); }),
    close: async () => { clearInterval(maintenance); for (const ws of wss.clients) ws.terminate(); await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve)); },
  };
}

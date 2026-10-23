import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, randomInt, createHash } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { attachRelay } from '../../shared/server/relay.js';
import { InputQueue } from '../../shared/net/inputs.js';
import { createMatch } from '../../shared/matches.js';
import { Ledger } from './ledger.js';
import { createHockeyState, resetHockey, stepHockey, constrainTarget } from '../src/air-hockey/physics.js';
import { validHitStrength, normalizeHockeySettings } from '../src/air-hockey/tuning.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHOICES = ['rock', 'paper', 'scissors'];
const NPCS = [
  { id: 'npc-pierre', name: 'Pierre', x: -4, y: 0.5, personality: 'A dramatic French optimist. Every round is historic.' },
  { id: 'npc-dot', name: 'Dot', x: -1.8, y: -2, personality: 'Small, pink, and delighted by improbable victories.' },
  { id: 'npc-basil', name: 'Basil', x: 1.3, y: -2.3, personality: 'Claims to have invented scissors.' },
  { id: 'npc-nell', name: 'Nell', x: 4, y: 0.8, personality: 'A generous laugh and an extremely competitive streak.' },
];
const hash = value => createHash('sha256').update(value).digest('hex');
const cleanName = value => String(value || 'Guest').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) || 'Guest';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const roomCode = () => Array.from({ length: 6 }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join('');

export function createPubServer({ host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 8787), ledgerPath = process.env.PUB_LEDGER || path.join(ROOT, 'server/data/ledger.json'), roundTimeoutMs = 25000, challengeTimeoutMs = 20000, reconnectGraceMs = 10000, now = () => Date.now() } = {}) {
  const ledger = new Ledger(ledgerPath);
  const rooms = new Map();
  let shuttingDown = false;

  const newTable = (id, teamSize=1) => {
    const spec=createMatch({id,teamSizes:[teamSize,teamSize]});
    const hockey=createHockeyState(undefined, teamSize);
    return {...spec,seats:spec.roster.map(()=>null),targets:hockey.mallets.map(({x,y})=>({x,y})),hockey,restartVotes:new Set(),tick:0,epoch:randomUUID(),inputs:spec.roster.map(()=>new InputQueue())};
  };
  const playing = (room,table) => table.seats.every(id=>id && room.sessions.has(id));
  const resetTable = table => { resetHockey(table.hockey); table.epoch=randomUUID();table.inputs=table.seats.map(()=>new InputQueue());table.targets=table.hockey.mallets.map(({x,y})=>({x,y})); };
  const getRoom = code => {
    if (!ledger.data.rooms[code]) return null;
    if (!rooms.has(code)) rooms.set(code, { code, sessions: new Map(), positions: new Map(), challenges: new Map(), rounds: new Map(), results: [], matches:new Map([["main",newTable("main")]]), disconnected:new Map(), dirty:false });
    return rooms.get(code);
  };
  const account = (room, id) => ledger.account(room.code, id);
  const position = (room, id) => room.positions.get(id) || NPCS.find(npc => npc.id === id) || { x: 0, y: 3.2, yaw: 0 };
  const send = (socket, message) => {
    if(socket.readyState!==WebSocket.OPEN)return;
    if(socket.bufferedAmount>65536){if(message.type==='hockey.state'||message.type==='state')return;socket.close(1013,'Connection too slow; reconnect');return;}
    socket.send(JSON.stringify(message));
  };
  const broadcast = (room, message) => { for (const socket of room.sessions.values()) send(socket, message); };
  const publicRound = round => ({ id: round.id, participants: round.participants, participantIds: round.participants, stake: round.stake, deadline: round.deadline, status: 'choosing', locked: round.choices.map(Boolean) });
  const snapshot = room => ({
    type: 'state', room: room.code, matches:[...room.matches.values()].map(t=>({id:t.id,game:t.game,teamSizes:t.teamSizes,roster:t.roster.map((slot,i)=>({...slot,playerId:t.seats[i]})),playing:playing(room,t)})),
    players: Object.values(ledger.data.rooms[room.code].players).map(player => ({ id: player.id, name: player.name, coins: player.coins, ...position(room, player.id), z: position(room, player.id).y, online: room.sessions.has(player.id), activity: [...room.matches.values()].some(t=>t.seats.includes(player.id)) ? 'air-hockey' : [...room.rounds.values()].some(round => round.participants.includes(player.id)) ? 'rps' : 'pub' })),
    npcs: NPCS.map(npc => ({ ...npc, z: npc.y, coins: account(room, npc.id).coins, online: true, activity: [...room.rounds.values()].some(round => round.participants.includes(npc.id)) ? 'rps' : 'pub' })),
    challenges: [...room.challenges.values()], rounds: [...room.rounds.values()].map(publicRound), results: room.results.slice(-8),
  });
  const publish = room => { broadcast(room, snapshot(room)); room.dirty = false; };
  const hockeyPacket = (room, table, socket) => ({type:'hockey.state',tableId:table.id,matchId:table.id,epoch:table.epoch,inputEpoch:socket?.inputEpoch,seats:table.seats,teamSizes:table.teamSizes,state:table.hockey,tick:table.tick,acks:table.inputs.map(q=>q.snapshot()),playing:playing(room,table),restartVotes:[...table.restartVotes]});
  const hockeyPublish = (room, table=room.matches.get('main')) => {for(const socket of room.sessions.values())if(socket.matchId===table.id)send(socket,hockeyPacket(room,table,socket));};
  const busy = (room,id) => [...room.matches.values()].some(t=>t.seats.includes(id)) || [...room.rounds.values()].some(r=>r.participants.includes(id)) || [...room.challenges.values()].some(c=>c.participants.includes(id));
  const near = (room, a, b) => Math.hypot(position(room, a).x - position(room, b).x, position(room, a).y - position(room, b).y) <= 2.3;

  function finishRound(room, round, winnerId, reason) {
    if (!room.rounds.has(round.id)) return;
    const result = { ...ledger.settle(round.id, winnerId, reason), type: 'rps.result', choices: reason === 'played' ? [...round.choices] : [null, null] };
    room.rounds.delete(round.id);
    room.results.push(result);
    if (room.results.length > 8) room.results.shift();
    broadcast(room, result);
    publish(room);
  }

  function acceptChallenge(room, challenge) {
    // Reservation precedes publication; no client can enter an unfunded round.
    ledger.reserve(room.code, challenge.id, challenge.participants, challenge.stake);
    room.challenges.delete(challenge.id);
    const round = { id: challenge.id, participants: challenge.participants, stake: challenge.stake, deadline: now() + roundTimeoutMs, choices: [null, null] };
    // Pick before receiving the human's gesture. Never inspect the human's choice.
    round.participants.forEach((id, index) => { if (id.startsWith('npc-')) round.choices[index] = CHOICES[randomInt(CHOICES.length)]; });
    room.rounds.set(round.id, round);
    broadcast(room, { type: 'rps.round', ...publicRound(round) });
    publish(room);
  }

  function leaveHockey(room,id) {
    for(const table of room.matches.values()) {
      const seat=table.seats.indexOf(id);if(seat<0)continue;
      table.seats[seat]=null;table.inputs[seat]=new InputQueue();table.restartVotes.clear();hockeyPublish(room,table);room.dirty=true;
    }
    room.disconnected.delete(id);
  }

  function disconnected(socket, code) {
    const room = socket.room;
    if (!room || room.sessions.get(socket.playerId) !== socket) return;
    room.sessions.delete(socket.playerId);
    for (const challenge of room.challenges.values()) if (challenge.participants.includes(socket.playerId)) {
      room.challenges.delete(challenge.id);
      broadcast(room, { type: 'rps.cancelled', challengeId: challenge.id, reason: 'disconnect' });
    }
    for (const round of [...room.rounds.values()]) if (round.participants.includes(socket.playerId)) finishRound(room, round, null, 'disconnect');
    if(code===1000||code===1001)leaveHockey(room,socket.playerId);
    else {room.disconnected.set(socket.playerId,now()+reconnectGraceMs);for(const table of room.matches.values())hockeyPublish(room,table);}
    publish(room);
  }

  function hello(socket, packet) {
    if (socket.room) throw new Error('Already joined a room.');
    let code = typeof packet.room === 'string' ? packet.room.trim().toUpperCase() : '';
    if (packet.create === true) {
      if (Object.keys(ledger.data.rooms).length >= 1000) throw new Error('This server has reached its room limit.');
      do { code = roomCode(); } while (ledger.data.rooms[code]);
      ledger.transaction(() => { ledger.data.rooms[code] = { code, createdAt: now(), players: {}, npcs: Object.fromEntries(NPCS.map(npc => [npc.id, { id: npc.id, name: npc.name, coins: 1000 }])) }; });
    }
    if (!/^[A-Z2-9]{6}$/.test(code) || !ledger.data.rooms[code]) throw new Error('That room does not exist. Check the six-character code.');
    const room = getRoom(code);
    let player;
    let token = packet.token;
    if (typeof token === 'string' && token.length > 0) {
      if (token.length > 200) throw new Error('Invalid saved room identity.');
      const digest = hash(token);
      player = Object.values(ledger.data.rooms[code].players).find(value => value.tokenHash === digest);
      if (!player) throw new Error('Your saved identity is not valid for this room.');
    } else {
      if(room.sessions.size>=24)throw Error('This room is full.');
      token = randomBytes(32).toString('hex');
      player = { id: `player-${randomUUID()}`, name: cleanName(packet.name), tokenHash: hash(token), coins: 250 };
      ledger.transaction(() => { ledger.data.rooms[code].players[player.id] = player; });
    }
    if(room.sessions.size>=24&&!room.sessions.has(player.id))throw Error('This room is full.');
    socket.playerId = player.id; socket.matchId=String(packet.matchId||'main'); if(!room.matches.has(socket.matchId))socket.matchId='main'; socket.inputEpoch=randomUUID();
    room.disconnected.delete(player.id);
    for(const table of room.matches.values()){const seat=table.seats.indexOf(player.id);if(seat>=0){socket.matchId=table.id;table.inputs[seat]=new InputQueue();table.targets[seat]={x:table.hockey.mallets[seat].x,y:table.hockey.mallets[seat].y};}}
    socket.room = room;
    socket.lastMoveAt = now();
    socket.moveBudget = 0.25;
    if (!room.positions.has(player.id)) room.positions.set(player.id, { x: 0, y: 3.2, yaw: 0 });
    const previous = room.sessions.get(player.id);
    room.sessions.set(player.id, socket);
    if (previous && previous !== socket) { send(previous, { type: 'error', code: 'SESSION_REPLACED', message: 'This Muppet joined from another tab. This tab has released control.' }); previous.close(4001, 'Identity opened in another tab'); }
    send(socket, { type: 'welcome', id: player.id, room: code, token, state: snapshot(room) });
    send(socket, hockeyPacket(room,room.matches.get(socket.matchId),socket));
    publish(room);
  }

  function handle(socket, packet) {
    if (!packet || typeof packet !== 'object' || Array.isArray(packet) || typeof packet.type !== 'string') throw new Error('Invalid message.');
    if (packet.type === 'hello') return hello(socket, packet);
    const room = socket.room;
    const id = socket.playerId;
    if (!room || room.sessions.get(id) !== socket) throw new Error('Join a room first.');
    const table=room.matches.get(socket.matchId);
    switch (packet.type) {
      case 'ping': return send(socket, { type: 'pong', sent:packet.sent, time: now() });
      case 'match.create': {
        if(room.matches.size>=12)throw Error('This lobby already has twelve matches.');
        if(![1,2,3,4].includes(packet.teamSize))throw Error('Choose teams of one to four.');
        const id=randomBytes(6).toString('hex');room.matches.set(id,newTable(id,packet.teamSize));
        send(socket,{type:'match.created',matchId:id});publish(room);break;
      }
      case 'match.watch': {
        if(!room.matches.has(packet.matchId))throw Error('Unknown match');
        leaveHockey(room,id);socket.matchId=packet.matchId;socket.inputEpoch=randomUUID();
        send(socket,hockeyPacket(room,room.matches.get(socket.matchId),socket));publish(room);break;
      }
      case 'move': {
        const x = packet.x, y = packet.y ?? packet.z, yaw = packet.yaw ?? 0;
        if (![x, y, yaw].every(Number.isFinite)) throw new Error('Position must contain finite numbers.');
        const current = position(room, id);
        const elapsed = Math.min(1, Math.max(0, (now() - socket.lastMoveAt) / 1000));
        const distance = Math.hypot(x - current.x, y - current.y);
        const maxDistance = Math.min(1.25, socket.moveBudget + elapsed * 4);
        const ratio = distance > maxDistance ? maxDistance / distance : 1;
        room.positions.set(id, { x: clamp(current.x + (x - current.x) * ratio, -7, 7), y: clamp(current.y + (y - current.y) * ratio, -4.5, 4.5), yaw: ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) });
        socket.moveBudget = Math.max(0, maxDistance - Math.min(distance, maxDistance));
        socket.lastMoveAt = now();
        room.dirty = true;
        break;
      }
      case 'name': {
        ledger.transaction(() => { account(room, id).name = cleanName(packet.name); });
        publish(room);
        break;
      }
      case 'rps.challenge': {
        const targetId = packet.targetId;
        if (typeof targetId !== 'string' || !account(room, targetId) || targetId === id) throw new Error('Choose another Muppet.');
        if (!targetId.startsWith('npc-') && !room.sessions.has(targetId)) throw new Error('That player has left the room.');
        if (busy(room, id) || busy(room, targetId)) throw new Error('One of these Muppets is already playing.');
        if (!near(room, id, targetId)) throw new Error('Walk closer to that Muppet before challenging them.');
        if (!Number.isSafeInteger(packet.stake) || packet.stake < 1 || packet.stake > 1000) throw new Error('Choose a whole stake between 1 and 1,000 coins.');
        if (account(room, id).coins < packet.stake || account(room, targetId).coins < packet.stake) throw new Error('Both players need enough coins for that stake.');
        const challenge = { id: randomUUID(), challengeId: null, fromId: id, targetId, participants: [id, targetId], stake: packet.stake, deadline: now() + challengeTimeoutMs };
        challenge.challengeId = challenge.id;
        room.challenges.set(challenge.id, challenge);
        broadcast(room, { type: 'rps.challenge', ...challenge });
        if (targetId.startsWith('npc-')) acceptChallenge(room, challenge);
        else publish(room);
        break;
      }
      case 'rps.accept': {
        const challenge = room.challenges.get(packet.challengeId);
        if (!challenge || challenge.targetId !== id) throw new Error('This challenge is no longer available.');
        if (now() > challenge.deadline) {
          room.challenges.delete(challenge.id);
          broadcast(room, { type: 'rps.cancelled', challengeId: challenge.id, reason: 'timeout' });
          publish(room); throw new Error('This challenge has expired.');
        }
        if (!near(room, challenge.fromId, id)) throw new Error('Your challenger has moved too far away.');
        acceptChallenge(room, challenge);
        break;
      }
      case 'rps.decline': {
        const challenge = room.challenges.get(packet.challengeId);
        if (!challenge || !challenge.participants.includes(id)) throw new Error('This challenge is no longer available.');
        room.challenges.delete(challenge.id);
        broadcast(room, { type: 'rps.cancelled', challengeId: challenge.id, reason: 'declined' });
        publish(room);
        break;
      }
      case 'rps.choose': {
        const round = room.rounds.get(packet.roundId);
        if (!round || !round.participants.includes(id)) throw new Error('This round is no longer available.');
        if (!CHOICES.includes(packet.choice)) throw new Error('Choose rock, paper, or scissors.');
        const index = round.participants.indexOf(id);
        if (round.choices[index] !== null) throw new Error('Your gesture is already locked.');
        if (now() > round.deadline) { finishRound(room, round, null, 'timeout'); break; }
        round.choices[index] = packet.choice;
        if (round.choices.every(Boolean)) {
          const a = CHOICES.indexOf(round.choices[0]), b = CHOICES.indexOf(round.choices[1]);
          const winnerId = a === b ? null : round.participants[(a - b + 3) % 3 === 1 ? 0 : 1];
          finishRound(room, round, winnerId, 'played');
        } else {
          broadcast(room, { type: 'rps.round', ...publicRound(round) });
          publish(room);
        }
        break;
      }
      case 'hockey.join': {
        if (table.seats.includes(id)) { send(socket, hockeyPacket(room,table,socket)); break; }
        if (busy(room, id)) throw new Error('Finish your current game before taking a seat.');
        const seat = packet.seat === undefined ? table.seats.indexOf(null) : packet.seat;
        if (!Number.isInteger(seat)||seat<0||seat>=table.seats.length) throw new Error('No playing seat is available. You can spectate.');
        if (table.seats[seat]) throw new Error('That seat is occupied.');
        table.seats[seat] = id;
        table.restartVotes.clear();
        if (table.seats.every(Boolean)) {
          resetTable(table);
        }
        hockeyPublish(room,table);
        publish(room);
        break;
      }
      case 'hockey.leave': leaveHockey(room, id); publish(room); break;
      case 'hockey.input': {
        const seat = table.seats.indexOf(id);
        if (seat === -1) throw new Error('Take a seat before moving a mallet.');
        if(packet.epoch!==undefined&&packet.epoch!==table.epoch)break;
        if(packet.inputEpoch!==undefined&&packet.inputEpoch!==socket.inputEpoch)break;
        if(packet.commands){table.inputs[seat].push(packet.commands);break;}
        if (![packet.x, packet.y].every(Number.isFinite)) throw new Error('Mallet position must contain finite numbers.');
        table.targets[seat] = constrainTarget({ x: packet.x, y: packet.y }, seat);
        break;
      }
      case 'hockey.settings': {
        if (table.seats[0] !== id) throw new Error('Only the Sun player can set the shared hit strength.');
        if (table.seats.every(Boolean) && table.hockey.status === 'playing') throw new Error('Change hit strength between points or while waiting for a player.');
        if (!validHitStrength(packet.hitStrength)) throw new Error('Hit strength must be a number between 0.20 and 1.00.');
        // Room opponents are both human. A client cannot claim a CPU power
        // multiplier or privately change its own mallet's strike strength.
        if (Object.keys(packet).some(key => !['type', 'hitStrength'].includes(key))) throw new Error('Only shared hit strength can be changed.');
        table.hockey.settings = normalizeHockeySettings({ hitStrength: packet.hitStrength, seatPower: [1, 1] });
        hockeyPublish(room,table);
        break;
      }
      case 'hockey.restart': {
        if (!table.seats.includes(id)) throw new Error('Only seated players can ask for a rematch.');
        table.restartVotes.add(id);
        if (table.seats.filter(Boolean).every(playerId => table.restartVotes.has(playerId))) {
          resetTable(table);
          table.restartVotes.clear();
        }
        hockeyPublish(room,table);
        break;
      }
      default: throw new Error('Unknown room message.');
    }
  }

  const httpServer = http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400).end('Invalid URL'); return; }
    if (pathname === '/health') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: true, rooms: rooms.size, protocol: 1 })); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end('Method not allowed'); return; }
    const dist = path.join(ROOT, 'dist');
    const filename = path.resolve(dist, `.${pathname === '/' ? '/pub.html' : pathname}`);
    if (!filename.startsWith(`${dist}${path.sep}`)) { response.writeHead(403).end('Forbidden'); return; }
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Page not found. For development open Vite on port 5173; for one-server hosting run npm run build first.');
      return;
    }
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json' };
    response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': pathname.endsWith('.html') ? 'no-cache' : 'public, max-age=3600' });
    if (request.method === 'HEAD') response.end(); else fs.createReadStream(filename).pipe(response);
  });
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  const relayServer=new WebSocketServer({noServer:true,maxPayload:65536});
  const stopRelay=attachRelay(relayServer);
  httpServer.on('upgrade', (request, socket, head) => {
    let allowed = true;
    try {
      if (!['/ws','/live'].includes(new URL(request.url, 'http://localhost').pathname)) allowed = false;
      if (request.headers.origin) {
        const originHost = new URL(request.headers.origin).hostname;
        const requestHost = new URL(`http://${request.headers.host}`).hostname;
        const local = value => ['127.0.0.1', 'localhost', '[::1]'].includes(value);
        if (originHost !== requestHost && !(local(originHost) && local(requestHost)) && !(process.env.GAME_ALLOWED_ORIGINS||'').split(',').includes(request.headers.origin)) allowed = false;
      }
    } catch { allowed = false; }
    if (!allowed) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    const target=new URL(request.url,'http://localhost').pathname==='/live'?relayServer:websocketServer;
    target.handleUpgrade(request,socket,head,ws=>target.emit('connection',ws,request));
  });
  websocketServer.on('connection', socket => {
    socket.packetWindow = now(); socket.packetCount = 0; socket.alive = true;
    const helloTimeout = setTimeout(() => { if (!socket.room) socket.close(1008, 'Join a room to continue'); }, 10000);
    socket.on('pong', () => { socket.alive = true; });
    socket.on('message', data => {
      if (shuttingDown) return;
      try {
        if (now() - socket.packetWindow > 1000) { socket.packetWindow = now(); socket.packetCount = 0; }
        if (++socket.packetCount > 180) { socket.close(1008, 'Too many messages'); return; }
        handle(socket, JSON.parse(data.toString()));
      } catch (error) { send(socket, { type: 'error', code: 'INVALID_ACTION', message: error instanceof SyntaxError ? 'Invalid JSON message.' : error.message }); }
    });
    socket.on('close', code => { clearTimeout(helloTimeout); disconnected(socket,code); });
    socket.on('error', () => {});
  });

  let previousSimulationTime = performance.now();
  let simulationBudget = 0;
  const simulation = setInterval(() => {
    const currentTime = performance.now();
    simulationBudget += Math.min(0.1, (currentTime - previousSimulationTime) / 1000);
    previousSimulationTime = currentTime;
    while (simulationBudget >= 1 / 120) {
      for(const room of rooms.values())for(const table of room.matches.values())if(playing(room,table)){
        const targets=table.inputs.map((q,i)=>q.target(table.targets[i]));
        stepHockey(table.hockey,targets,1/120);table.targets=targets.map(({x,y})=>({x,y}));
        table.inputs.forEach(q=>q.stepped());table.tick++;
      }
      simulationBudget -= 1 / 120;
    }
  }, 8);
  const snapshots = setInterval(() => { for(const room of rooms.values())if(room.sessions.size)for(const table of room.matches.values())hockeyPublish(room,table); }, 40);
  const maintenance = setInterval(() => {
    for (const room of rooms.values()) {
      for(const [id,deadline] of room.disconnected)if(deadline<now())leaveHockey(room,id);
      for (const challenge of room.challenges.values()) if (challenge.deadline < now()) { room.challenges.delete(challenge.id); broadcast(room, { type: 'rps.cancelled', challengeId: challenge.id, reason: 'timeout' }); room.dirty = true; }
      for (const round of [...room.rounds.values()]) if (round.deadline < now()) finishRound(room, round, null, 'timeout');
      if (room.dirty) publish(room);
    }
  }, 65);
  const heartbeat = setInterval(() => {
    for (const socket of websocketServer.clients) {
      if (!socket.alive) { socket.terminate(); continue; }
      socket.alive = false; socket.ping();
    }
  }, 2500);
  return {
    httpServer, ledger,
    listen: () => new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(port, host, () => { httpServer.off('error', reject); resolve(httpServer.address()); }); }),
    close: async () => {
      shuttingDown = true;stopRelay();await new Promise(resolve=>relayServer.close(resolve));
      for (const timer of [simulation, snapshots, maintenance, heartbeat]) clearInterval(timer);
      for (const room of rooms.values()) for (const round of [...room.rounds.values()]) finishRound(room, round, null, 'server-shutdown');
      for (const socket of websocketServer.clients) socket.terminate();
      await new Promise(resolve => websocketServer.close(resolve));
      if (httpServer.listening) await new Promise(resolve => httpServer.close(resolve));
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createPubServer();
  const address = await server.listen();
  console.log(`Muppet pub server: http://${address.address}:${address.port}/pub.html`);
  console.log('Pub coins are fictional. Room balances persist in server/data/ledger.json.');
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await server.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

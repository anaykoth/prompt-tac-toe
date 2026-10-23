import './style.css';
import { HockeyScene } from './scene.js';
import { HOCKEY, createHockeyState, stepHockey, constrainTarget } from './physics.js';
import { HockeyNetwork } from './network.js';
import { HOCKEY_PRESETS, HOCKEY_CPU_POWER, hockeyPresetFor, normalizeHockeySettings } from './tuning.js';
import { RoomClient } from '../room/client.js';

const $ = (id) => document.getElementById(id);
const canvas = $('rink');
const view = new HockeyScene(canvas);
const CPU = {
  friendly: { name: 'BARRY', speed: 1.45, reaction: .19, error: .15 },
  pub: { name: 'DOT', speed: 2.5, reaction: .11, error: .065 },
  shark: { name: 'THE SHARK', speed: 3.8, reaction: .07, error: .018 },
};
let practiceStrength = HOCKEY_PRESETS.pub;
let state = createHockeyState({ hitStrength: practiceStrength, seatPower: [1, HOCKEY_CPU_POWER.pub] }), mode = 'practice', paused = false, started = false;
let difficulty = 'pub', ownSeat = 0, seats = [null, null];
let targets = [{ x: 0, y: 1.25 }, { x: 0, y: -1.25 }];
let cpuPlan = { x: 0, y: -1.25 }, cpuClock = 0;
let client = null, connecting = false, onlineReady = false, lastSend = 0;
const netcode = new HockeyNetwork();
let matchId=new URLSearchParams(location.search).get('match')||'main';
let lastTime = performance.now(), animationTime = 0, excitement = 0;
let hitCount = 0, bankCount = 0, goalCount = 0, nextQuote = 0;
let soundEnabled = true;
let drunk = .32;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const roomQuery = new URLSearchParams(location.search).get('room');
const viewerName = (() => { try { return localStorage.getItem('muppet-pub:name') || 'Guest'; } catch { return 'Guest'; } })();

function drawGame(dt) {
  view.update(dt, animationTime, state, { ownSeat, drunk, excitement, reducedMotion });
}
function audioHit(kind, power = .5) { view.react(kind, power); }

function quote(text, who = 'DEREK, TABLE REGULAR') {
  $('crowd-quote').textContent = `“${text}”`; $('commentator').textContent = who;
  nextQuote = animationTime + 5;
}

function noticeEvents() {
  if (state.hits > hitCount) {
    hitCount = state.hits; const speed = Math.hypot(state.puck.vx, state.puck.vy);
    audioHit('hit', speed / 15);
    excitement = Math.min(1, excitement + .08 + state.rally * .012);
    if (state.lastHit === ownSeat) $('touch-readout').textContent = speed > 9 ? 'THUNDER' : speed > 4 ? 'CLEAN' : 'SOFT HANDS';
    if (state.rally >= 8 && animationTime > nextQuote) quote('Nobody breathe. Especially you, Derek.', 'DOT, UNWILLING REFEREE');
  }
  if (state.banks > bankCount) {
    bankCount = state.banks; audioHit('bank', .25);
    if (state.banks % 9 === 0 && animationTime > nextQuote) quote('The wall is a teammate. A very quiet one.');
  }
  if (state.goals > goalCount) {
    goalCount = state.goals; audioHit('goal'); excitement = 1;
    const ours = state.lastGoal === (ownSeat === null ? -1 : ownSeat%2);
    const comments = ours ? ['That counted. I was looking this time.', 'Oh, that was a lovely little angle.', 'I taught them that. Spiritually.'] : ['Excellent. Now you know where the goal is.', 'A setback! Character development!', 'You almost had that. Again.'];
    quote(comments[(state.goals - 1) % comments.length]);
  }
}

function updateCPU(dt) {
  const config = CPU[difficulty], p = state.puck, m = state.mallets[1];
  cpuClock -= dt;
  if (cpuClock <= 0) {
    cpuClock = config.reaction;
    const error = Math.sin(state.time * 2.6 + state.rally * .8) * config.error;
    if (p.y < -.05 && (p.vy <= 1.5 || p.y < -.9)) {
      // Get behind the puck before striking toward the player's goal.
      const behind = m.y < p.y - .12;
      cpuPlan = { x: p.x + error + (behind ? Math.sin(state.time * .8) * .06 : 0), y: p.y + (behind ? .32 : -.28) };
    } else {
      let intercept = p.x;
      if (p.vy < -.15) {
        intercept = p.x + p.vx * ((-1.22 - p.y) / p.vy);
        const limit = 1 - HOCKEY.puckRadius;
        // Mirror expected banks to anticipate the line at our goal.
        for (let i = 0; i < 12 && Math.abs(intercept) > limit; i++) intercept = Math.sign(intercept) * 2 * limit - intercept;
      }
      cpuPlan = { x: Math.max(-.72, Math.min(.72, intercept + error)), y: -1.25 };
    }
    cpuPlan = constrainTarget(cpuPlan, 1);
  }
  const dx = cpuPlan.x - m.x, dy = cpuPlan.y - m.y, d = Math.hypot(dx, dy);
  const travel = Math.min(d, config.speed * dt);
  targets[1] = { x: m.x + (d ? dx / d * travel : 0), y: m.y + (d ? dy / d * travel : 0) };
}

function showMessage(kicker, title, detail, prominent = false, action = false) {
  $('table-message').hidden = false;
  $('table-message').classList.toggle('goal', prominent);
  $('message-kicker').textContent = kicker; $('message-title').textContent = title; $('message-detail').textContent = detail;
  $('overlay-action').hidden = !action;
}

function updateHUD() {
  updateTuningUI();
  $('sun-score').textContent = state.score[0]; $('moon-score').textContent = state.score[1];
  $('best-rally').textContent = String(state.longestRally).padStart(2, '0');
  $('rally-label').textContent = state.rally > 1 ? `${state.rally} TOUCH RALLY` : 'MAKE YOUR MOVE';
  if (mode === 'practice') {
    $('sun-name').textContent = 'YOU'; $('moon-name').textContent = CPU[difficulty].name;
    $('seat-label').textContent = 'YOU ARE SUN';
  } else {
    const players = client?.state?.players || [];
    $('sun-name').textContent = seats.filter((_,i)=>i%2===0).map(id=>players.find(p=>p.id===id)?.name||'OPEN').join(' + ');
    $('moon-name').textContent = seats.filter((_,i)=>i%2===1).map(id=>players.find(p=>p.id===id)?.name||'OPEN').join(' + ');
    $('seat-label').textContent = ownSeat === null ? 'AT THE RAIL' : `YOU ARE ${ownSeat % 2 === 0 ? 'SUN' : 'MOON'}`;
  }
  $('control-label').textContent = ownSeat === null ? '· SPECTATING' : '· MOUSE TO MOVE';
  canvas.setAttribute('aria-label', ownSeat === null ? 'Air hockey table. You are spectating.' : `Air hockey. Move your mouse over your half of the physical table to control the ${ownSeat % 2 === 0 ? 'orange' : 'mint'} mallet. Space pauses practice; R restarts.`);
  $('pause').disabled = mode === 'room';
  $('restart').disabled = mode === 'room' && ownSeat === null;
  $('join-sun').disabled = !onlineReady || seats.every((id,i)=>i%2!==0||id);
  $('join-moon').disabled = !onlineReady || seats.every((id,i)=>i%2!==1||id);
  $('spectate').disabled = !onlineReady || ownSeat === null;
  if (mode === 'room' && (!onlineReady || !seats.every(Boolean) || !netcode.playing)) {
    showMessage(onlineReady ? 'THE ROOM IS OPEN' : 'A SHARED TABLE', onlineReady ? `${seats.filter(id=>!id).length || 'RECONNECTING'} TO JOIN` : 'BRING YOUR TEAM.', ownSeat === null ? 'Choose a team in Table Settings. Share this room and table with your friends.' : 'Waiting for the rest of the table. Share this page’s link with your team.');
  } else if (paused) showMessage('TAKE A BREATH', 'ON THE RAIL.', 'Press Space or Pause to come back.');
  else if (state.status === 'finished') {
    const player = state.winner === 0 ? $('sun-name').textContent : $('moon-name').textContent;
    showMessage('THE ROOM SAW EVERYTHING', `${player} WINS.`, mode === 'room' ? 'Everyone at the table chooses New Game for a rematch.' : 'A good game. A better story. Go again?', true, true);
  } else if (state.status === 'goal') {
    showMessage('THAT ONE COUNTS', state.lastGoal === (ownSeat === null ? -1 : ownSeat%2) ? 'LOVELY TOUCH.' : 'WHAT A SHOT.', `${state.score[0]} — ${state.score[1]} · ${state.servingSeat === (ownSeat === null ? -1 : ownSeat%2) ? 'Your' : 'Their'} serve next.`, true);
  } else if (!started && mode === 'practice') showMessage('THE ROOM IS WATCHING', 'YOUR SERVE.', 'Move onto the table. Push through the puck.');
  else $('table-message').hidden = true;
}

function restart() {
  if (mode === 'room') {
    client?.send('hockey.restart'); quote('Rematch requested. Everyone at the table gets a vote.'); return;
  }
  state = createHockeyState({ hitStrength: practiceStrength, seatPower: [1, HOCKEY_CPU_POWER[difficulty]] }); targets = state.mallets.map(m => ({ x: m.x, y: m.y }));
  started = false; paused = false; hitCount = 0; bankCount = 0; goalCount = 0;
  cpuClock = 0;
  $('pause').innerHTML = 'PAUSE <kbd>SPACE</kbd>'; $('touch-readout').textContent = 'READY';
}

function togglePause() {
  if (mode !== 'practice') return;
  paused = !paused;
  $('pause').innerHTML = paused ? 'RESUME <kbd>SPACE</kbd>' : 'PAUSE <kbd>SPACE</kbd>';
}

function pointer(event) {
  if (ownSeat === null || (mode === 'room' && !onlineReady)) return;
  const desired = view.targetAt(event.clientX, event.clientY, ownSeat);
  if (!desired) return;
  targets[ownSeat] = desired; started = true;
  if (event.type === 'pointerdown') { view.enableSound(soundEnabled); canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true }); }
}
canvas.addEventListener('pointermove', pointer);
canvas.addEventListener('pointerdown', pointer);
canvas.addEventListener('pointerup', e => { if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); });
canvas.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('keydown', event => {
  if (/INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
  if (event.repeat) return;
  if (event.code === 'Space') { event.preventDefault(); togglePause(); }
  if (event.code === 'KeyR') restart();
  if (event.code === 'Escape') $('settings-panel').hidden = !$('settings-panel').hidden;
});
window.addEventListener('blur', () => { if (mode === 'practice' && started && !paused) togglePause(); });
$('pause').onclick = togglePause; $('restart').onclick = restart; $('overlay-action').onclick = restart;
$('difficulty').onchange = event => { difficulty = event.target.value; restart(); quote(difficulty === 'shark' ? 'That one brought their own mallet.' : 'Lovely. A civilised disagreement.'); };
$('sound').onclick = () => {
  soundEnabled = !soundEnabled;
  $('sound').textContent = soundEnabled ? 'SOUND ON' : 'SOUND OFF';
  $('sound').setAttribute('aria-pressed', String(soundEnabled));
  view.enableSound(soundEnabled);
};

function setMode(next) {
  if (mode === next) return;
  if (mode === 'room' && ownSeat !== null) client?.send('hockey.leave');
  mode = next; ownSeat = next === 'practice' ? 0 : null;
  document.body.classList.toggle('room-mode', next === 'room');
  $('practice-mode').classList.toggle('selected', next === 'practice');
  $('room-mode').classList.toggle('selected', next === 'room');
  $('practice-options').hidden = next !== 'practice'; $('room-options').hidden = next !== 'room';
  paused = false;
  if (next === 'practice') {
    restart(); $('network-note').textContent = 'LOCAL TABLE · NO CONNECTION NEEDED';
  } else {
    $('settings-panel').hidden = false;
    state = client?.hockey?.state ? structuredClone(client.hockey.state) : createHockeyState();
    hitCount = state.hits; bankCount = state.banks; goalCount = state.goals;
    $('network-note').textContent = onlineReady ? `ROOM ${client.room} · SHARED TABLE` : 'ROOM TABLE · JOIN WITH A ROOM CODE';
    if ($('room-code').value && !onlineReady) connectRoom();
  }
}
$('practice-mode').onclick = () => setMode('practice'); $('room-mode').onclick = () => setMode('room');

async function connectRoom() {
  const room = $('room-code').value.trim().toUpperCase();
  if (connecting || !room) return;
  connecting = true; onlineReady = false; $('connect-room').disabled = true;
  $('connection-status').textContent = 'Finding your table…';
  client?.close();
  const nextClient = new RoomClient(); client = nextClient;
  nextClient.on(message => {
    if (client !== nextClient) return;
    if(message.type==='welcome'){onlineReady=true;netcode.reset();}
    if(message.type==='state'||message.type==='welcome'){
      const matches=(message.state??message).matches??[];
      const select=$('match-select');select.replaceChildren(...matches.map(m=>new Option(`${m.teamSizes.join('v')} · ${m.id}`,m.id)));
      select.value=matchId;
    }
    if(message.type==='match.created'){matchId=message.matchId;nextClient.send('match.watch',{matchId});}
    if(message.type==='network')$('connection-status').textContent=`${Math.round(message.rttMs)} ms ping · ${Math.round(message.jitterMs)} ms jitter`;
    if (message.type === 'hockey.state') {
      matchId=message.matchId;seats=message.seats||[null,null];$('match-select').value=matchId;
      if(mode!=='room')return;
      const previousSeat=ownSeat;
      ownSeat=seats.indexOf(nextClient.id);if(ownSeat<0)ownSeat=null;
      netcode.absorb(message,ownSeat);
      if(ownSeat!==previousSeat&&ownSeat!==null)targets[ownSeat]={...message.state.mallets[ownSeat]};
      state=netcode.advance(0,targets[ownSeat])||message.state;
      if(state.goals<goalCount||state.hits<hitCount){hitCount=state.hits;goalCount=state.goals;bankCount=state.banks;}
      const url=new URL(location.href);url.searchParams.set('match',matchId);history.replaceState(null,'',url);
    } else if (message.type === 'error') {
      $('connection-status').textContent = message.message || 'Could not join this table.';
    } else if (message.type === 'close' || message.type === 'disconnected') {
      onlineReady = false; $('connection-status').textContent = message.reconnecting?'Reconnecting… your seat is reserved.':'Disconnected. Join again to return to the room.';
      $('network-note').textContent = 'CONNECTION LOST';
    }
  });
  try {
    await nextClient.connect({ room, name: viewerName, matchId });
    if (client !== nextClient) return;
    onlineReady = true;
    $('connection-status').textContent = `Room ${nextClient.room}. Choose a seat or watch.`;
    $('network-note').textContent = `ROOM ${nextClient.room} · SHARED TABLE`;
    $('pub-link').href = `/pub.html?room=${encodeURIComponent(nextClient.room)}`;
    $('pool-link').href = `/pool.html?room=${encodeURIComponent(nextClient.room)}`;
    const url = new URL(location.href); url.searchParams.set('room', nextClient.room); history.replaceState(null, '', url);
    if (nextClient.hockey) { seats = nextClient.hockey.seats; if (mode === 'room') state = structuredClone(nextClient.hockey.state); }
  } catch (error) {
    $('connection-status').textContent = error.message || 'Room unavailable. Practice is ready whenever you are.';
  } finally { connecting = false; $('connect-room').disabled = false; }
}
$('connect-room').onclick = connectRoom;
$('room-code').addEventListener('keydown', e => { if (e.key === 'Enter') connectRoom(); });
$('join-sun').onclick = () => { client?.send('hockey.join', { seat:seats.findIndex((id,i)=>!id&&i%2===0) }); $('settings-panel').hidden = true; };
$('join-moon').onclick = () => { client?.send('hockey.join', { seat:seats.findIndex((id,i)=>!id&&i%2===1) }); $('settings-panel').hidden = true; };
$('new-match').onclick=()=>client?.send('match.create',{teamSize:Number($('team-size').value)});
$('match-select').onchange=e=>{matchId=e.target.value;client?.send('match.watch',{matchId});};
$('spectate').onclick = () => client?.send('hockey.leave');
window.addEventListener('pagehide', () => { if (ownSeat !== null && mode === 'room') client?.send('hockey.leave'); client?.close(); });

function frame(now) {
  const dt = Math.min(.04, Math.max(0, (now - lastTime) / 1000)); lastTime = now; animationTime += dt;
  excitement = Math.max(0, excitement - dt * .24);
  if (mode === 'practice' && started && !paused) { updateCPU(dt); stepHockey(state, targets, dt); }
  if (mode === 'room' && onlineReady) {
    state=netcode.advance(dt,targets[ownSeat])||state;
    if(ownSeat!==null&&now-lastSend>25){lastSend=now;const commands=netcode.batch();if(commands.length&&client.send('hockey.input',{commands,epoch:netcode.epoch,inputEpoch:netcode.inputEpoch}))netcode.markSent(commands);}
    if(netcode.metrics.stalled)$('connection-status').textContent='Waiting for the server…';
  }
  noticeEvents(); updateHUD(); drawGame(dt); requestAnimationFrame(frame);
}
if (roomQuery) { $('room-code').value = roomQuery.toUpperCase(); $('pub-link').href = `/pub.html?room=${encodeURIComponent(roomQuery)}`; $('pool-link').href = `/pool.html?room=${encodeURIComponent(roomQuery)}`; setMode('room'); }
requestAnimationFrame(frame);

$('settings-toggle').onclick = () => { $('settings-panel').hidden = !$('settings-panel').hidden; };
$('close-settings').onclick = () => { $('settings-panel').hidden = true; };
$('drunk').oninput = event => { drunk = Number(event.target.value) / 100; $('drunk-label').textContent = drunk < .05 ? 'SOBER' : drunk < .45 ? 'A LITTLE MERRY' : drunk < .8 ? 'WOBBLY' : 'LAST ORDERS'; };
$('sober').onclick = () => { drunk = 0; $('drunk').value = '0'; $('drunk-label').textContent = 'SOBER'; };
$('visual-style').onchange = event => view.setStyle(event.target.value);

function updateTuningUI() {
  const settings = normalizeHockeySettings(state.settings);
  const canEdit = mode === 'practice' || (onlineReady && ownSeat === 0 && (!seats.every(Boolean) || state.status !== 'playing'));
  $('hit-preset').disabled = !canEdit;
  $('hit-strength').disabled = !canEdit;
  $('hit-strength-value').textContent = `${settings.hitStrength.toFixed(2)}×`;
  $('hit-preset').value = hockeyPresetFor(settings.hitStrength);
  if (document.activeElement !== $('hit-strength') || !canEdit) $('hit-strength').value = String(settings.hitStrength * 100);
  $('opponent-power').textContent = `Your strike 1.00× · ${CPU[difficulty].name} ${HOCKEY_CPU_POWER[difficulty].toFixed(2)}× · effective ${(settings.hitStrength * HOCKEY_CPU_POWER[difficulty]).toFixed(2)}×`;
  $('hit-settings-note').textContent = mode === 'practice'
    ? 'Less punch, same quick hands. Incoming shots still rebound.'
    : canEdit
      ? 'Shared by every player, each at 1.00×. The Sun captain can tune between points.'
      : 'Same strength for every player. The Sun captain can tune between points.';
}

function changeHitStrength(value) {
  if (mode === 'room') {
    client?.send('hockey.settings', { hitStrength: value });
    // Do not apply speculative settings. The server snapshot changes both ends.
    return;
  }
  practiceStrength = normalizeHockeySettings({ hitStrength: value }).hitStrength;
  state.settings = normalizeHockeySettings({ hitStrength: practiceStrength, seatPower: [1, HOCKEY_CPU_POWER[difficulty]] });
}
$('hit-preset').onchange = event => { const value = HOCKEY_PRESETS[event.target.value]; if (Number.isFinite(value)) changeHitStrength(value); };
$('hit-strength').oninput = event => { if (mode === 'practice') changeHitStrength(Number(event.target.value) / 100); };
$('hit-strength').onchange = event => changeHitStrength(Number(event.target.value) / 100);

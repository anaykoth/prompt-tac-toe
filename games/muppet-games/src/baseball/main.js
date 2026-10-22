import { BaseballGame } from './model.js';
import { BaseballScene } from './scene.js';
import { BatGesture, PitchGesture } from './input.js';
import { DirectBatControl, directBatHeight } from './direct-input.js';
import { drawBatGuide } from './bat-guide.js';

const $ = id => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const canvas = $('ballpark');
const scene = new BaseballScene(canvas);
const batGesture = new BatGesture(), pitchGesture = new PitchGesture();
const directBat = new DirectBatControl();
const keys = new Set();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let game = new BaseballGame({ mode: 'batting', seed: 17 });
let started = false, paused = false, sound = true, held = false;
let clock = 0, phaseAt = 0, lastPhase = 'ready', lastRole = 'batting', excitement = 0;
let pitchKind = 'fastball', aim = { x: 0, y: 1.05 }, lastMouse = null;
let gestureNote = '', gesturePower = 0, gestureAt = -10;
let directConnected = false, directButtons = 0, lastContact = null;
const preferencesKey = 'baseball:bat-controls:v1';
try {
  const saved = JSON.parse(localStorage.getItem(preferencesKey) || 'null');
  if (saved?.mode === 'classic') $('bat-controls').value = 'classic';
  if (Number.isFinite(saved?.sensitivity)) $('bat-sensitivity').value = clamp(saved.sensitivity * 100, 40, 200);
} catch { /* Controls work even when storage is unavailable. */ }
const direct = () => game.state.role === 'batting' && $('bat-controls').value === 'direct';
function applyControls() {
  game.setBatControl($('bat-controls').value);
  directBat.setSensitivity(Number($('bat-sensitivity').value) / 100);
  $('bat-sensitivity-value').textContent = `${directBat.sensitivity.toFixed(2)}×`;
  const connected = $('bat-controls').value === 'direct';
  $('bat-sensitivity').disabled = !connected;
  $('bat-settings-help').textContent = connected
    ? 'Move right to draw back, left to sweep. Mouse back opens the wrist; forward closes it and reaches out. Left/right buttons raise/lower. C resets between pitches.'
    : 'Hold left mouse and flick left to start the original automatic swing. WASD positions the barrel.';
  $('welcome-swing').textContent = connected ? 'MOVE RIGHT TO DRAW BACK · LEFT TO SWEEP' : 'HOLD LEFT MOUSE + FLICK LEFT';
  $('welcome-detail').textContent = connected ? 'Left/right mouse raises/lowers. Stop your hand to hold a bunt. Practice freely, then press Space for a pitch.' : 'WASD places the bat. Mouse speed supplies power. Space calls a pitch.';
  try { localStorage.setItem(preferencesKey, JSON.stringify({ mode: $('bat-controls').value, sensitivity: directBat.sensitivity })); } catch { /* Optional. */ }
}
applyControls();
document.body.classList.add('intro');
const room = new URLSearchParams(location.search).get('room');
if (room) for (const id of ['pub-link', 'hockey-link', 'recorder-link']) $(id).href += `?room=${encodeURIComponent(room)}`;

function cancelGesture(disconnect = true, clearTrace = true) {
  held = false; lastMouse = null; batGesture.cancel(); pitchGesture.cancel(); keys.clear();
  directButtons = 0;
  if (disconnect) directConnected = false;
  if (clearTrace) directBat.clearMotion(performance.now());
}
function connectBat() {
  directConnected = true; lastMouse = null; canvas.focus();
  try { canvas.requestPointerLock()?.catch(() => {}); } catch { /* Bounded canvas input remains available. */ }
}
function unlock() { if (document.pointerLockElement === canvas) document.exitPointerLock(); }
function openDugout(open) {
  $('dugout').hidden = !open;
  cancelGesture();
  if (open) unlock();
  else canvas.focus();
}
function start(mode = $('game-mode').value) {
  game = new BaseballGame({ mode, innings: 3, seed: Date.now() % 0xFFFFFFFF });
  game.setPitchMix($('pitch-mix').value);
  directBat.reset(performance.now()); applyControls(); lastContact = null;
  $('game-mode').value = mode;
  started = true; paused = false; phaseAt = clock; lastPhase = 'ready'; lastRole = game.state.role;
  aim = { x: 0, y: 1.05 }; excitement = 0; gestureNote = ''; gesturePower = 0;
  cancelGesture(); openDugout(false);
  document.body.classList.remove('intro'); document.body.classList.add('playing');
  scene.enableSound(sound);
  if (direct()) connectBat();
  $('commentary').textContent = '“That fence is mostly a suggestion.” — Derek';
}
function advance() {
  if (!started) return start();
  if (paused) { paused = false; openDugout(false); return; }
  if (game.state.phase === 'finished') return start();
  if (['ready', 'result'].includes(game.state.phase)) {
    cancelGesture(false, game.state.phase !== 'ready'); game.next(); phaseAt = clock;
  }
}
function selectPitch(kind) {
  pitchKind = kind;
  document.querySelectorAll('[data-pitch]').forEach(b => b.classList.toggle('selected', b.dataset.pitch === kind));
}
$('start').onclick = () => start('batting');
$('start-pitching').onclick = () => start('pitching');
$('start-match').onclick = () => start('match');
$('new-game').onclick = () => start();
$('next-play').onclick = advance;
$('settings-toggle').onclick = () => openDugout($('dugout').hidden);
$('close-settings').onclick = () => openDugout(false);
$('pause-button').onclick = () => { paused = !paused; openDugout(false); };
$('pitch-mix').onchange = () => game.setPitchMix($('pitch-mix').value);
$('bat-controls').onchange = () => {
  cancelGesture(); directBat.reset(performance.now()); lastContact = null; applyControls();
  // Reattach to the restored pose when comparing modes, without a fast reset
  // through a live pitch on the first frame after closing the dugout.
  directBat.angle = game.state.bat.angle; directBat.reach = game.state.bat.reach;
};
$('bat-sensitivity').oninput = applyControls;
$('vision').oninput = () => { $('vision-value').textContent = `${$('vision').value}%`; };
$('sound').onclick = () => {
  sound = !sound; scene.enableSound(sound);
  $('sound').textContent = sound ? 'SOUND ON' : 'SOUND OFF';
  $('sound').setAttribute('aria-pressed', String(sound));
};
document.querySelectorAll('[data-pitch]').forEach(b => b.onclick = () => selectPitch(b.dataset.pitch));
window.addEventListener('keydown', e => {
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.code === 'Escape') { e.preventDefault(); openDugout($('dugout').hidden); return; }
  if (e.code === 'Space') { e.preventDefault(); if ($('dugout').hidden && !e.repeat) advance(); return; }
  if (!started || !$('dugout').hidden) return;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) { e.preventDefault(); keys.add(e.code); }
  if (e.code === 'Digit1') selectPitch('fastball');
  if (e.code === 'Digit2') selectPitch('curve');
  if (e.code === 'Digit3') selectPitch('changeup');
  if (e.code === 'KeyC' && (game.state.role === 'pitching' || ['ready', 'result'].includes(game.state.phase))) {
    aim = { x: 0, y: 1.05 }; directBat.reset(performance.now());
  }
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => {
  cancelGesture();
  if (started) { paused = true; unlock(); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && started) { paused = true; cancelGesture(); unlock(); }
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && started && $('dugout').hidden) openDugout(true);
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  if (!started || paused || !$('dugout').hidden) return;
  if (direct() && [0, 2].includes(e.button)) {
    e.preventDefault(); scene.enableSound(sound);
    if (!directConnected) { connectBat(); return; }
    if (document.pointerLockElement !== canvas) {
      try { canvas.requestPointerLock()?.catch(() => {}); } catch { /* Keep bounded movement available. */ }
    }
    directButtons |= e.button === 0 ? 1 : 2;
    return;
  }
  if (e.button !== 0) return;
  const s = game.state;
  if (!['ready', 'pitch'].includes(s.phase)) return;
  e.preventDefault(); canvas.focus(); held = true; lastMouse = { x: e.clientX, y: e.clientY };
  scene.enableSound(sound);
  (s.role === 'batting' ? batGesture : pitchGesture).begin(performance.now());
  // A full desktop mouse stroke can continue beyond the canvas edge.
  try { canvas.requestPointerLock()?.catch(() => {}); } catch { /* Drag input still works without locking. */ }
});
window.addEventListener('mousemove', e => {
  if (!started || paused || !$('dugout').hidden) return;
  const connected = direct() && directConnected;
  if (!held && !connected) return;
  const locked = document.pointerLockElement === canvas;
  if (connected && !locked && e.target !== canvas) { lastMouse = null; directButtons = 0; return; }
  const dx = locked ? e.movementX : e.clientX - (lastMouse?.x ?? e.clientX);
  const dy = locked ? e.movementY : e.clientY - (lastMouse?.y ?? e.clientY);
  lastMouse = { x: e.clientX, y: e.clientY };
  if (connected) { directBat.move(dx, dy, performance.now()); return; }
  if (game.state.role === 'batting') {
    // Do not consume the swing before the pitcher has released the ball.
    if (game.state.phase !== 'pitch') return;
    const shot = batGesture.move(dx, dy, performance.now());
    if (shot && game.swing(shot)) {
      gestureNote = `${Math.round(shot.speed)} px/s · YOUR SWING`; gesturePower = shot.speed / 3500; gestureAt = clock;
    }
  } else if (game.state.phase === 'ready') pitchGesture.move(dx, dy, performance.now());
});
window.addEventListener('mouseup', e => {
  if (e.button === 0) directButtons &= ~1;
  if (e.button === 2) directButtons &= ~2;
  if (e.button !== 0 || !held) return;
  held = false;
  if (game.state.role === 'pitching' && game.state.phase === 'ready' && !paused && $('dugout').hidden) {
    const release = pitchGesture.release(performance.now());
    if (release) {
      let { speed, curve } = release, drop = 0;
      if (pitchKind === 'curve') { speed *= .86; curve = (Math.sign(curve) || 1) * clamp(.55 + Math.abs(curve) * .45, 0, 1); drop = .65; }
      if (pitchKind === 'changeup') { speed *= .75; curve *= .3; drop = .12; }
      speed = clamp(speed, 18, 40);
      if (game.pitch({ targetX: aim.x, targetY: aim.y, speed, curve, drop })) {
        gestureNote = `${Math.round(speed * 2.237)} MPH · ${pitchKind.toUpperCase()}`;
        gesturePower = speed / 40; gestureAt = clock;
        $('commentary').textContent = `Your release: ${Math.round(speed * 2.237)} mph · ${Math.abs(curve) < .1 ? 'straight' : `${Math.round(Math.abs(curve) * 100)}% ${curve > 0 ? 'left' : 'right'} hook`}.`;
      }
    } else {
      gestureNote = 'RESET YOUR THROW'; gesturePower = 0; gestureAt = clock;
      $('commentary').textContent = 'Hold left mouse. Draw down, push up, then release while moving.';
    }
  }
  batGesture.cancel(); pitchGesture.cancel();
});

function updateHud() {
  const s = game.state, pitching = s.role === 'pitching', connected = direct();
  const set = (id, text) => { if ($(id).textContent !== text) $(id).textContent = text; };
  const canvasHelp = pitching ? 'First-person Muppet baseball. WASD aims the pitch. Hold left mouse, draw down, push up, then release.' : connected ? 'First-person Muppet baseball. Move the mouse to move the bat. Left mouse raises it; right mouse lowers it. Space calls a pitch.' : 'First-person Muppet baseball. WASD positions the bat. Hold left mouse and flick left to swing. Space calls a pitch.';
  if (canvas.getAttribute('aria-label') !== canvasHelp) canvas.setAttribute('aria-label', canvasHelp);
  set('cpu-score', String(s.score[0])); set('player-score', String(s.score[1]));
  set('inning', s.mode === 'match' ? `${s.half === 'top' ? '▲' : '▼'} INNING ${Math.min(s.inning, s.innings)} / ${s.innings}` : pitching ? 'PITCHING PRACTICE' : 'BATTING CAGE');
  set('count', `${s.counts.balls} BALLS · ${s.counts.strikes} STRIKES`); set('outs', `${s.counts.outs} OUT${s.counts.outs === 1 ? '' : 'S'}`);
  set('role-label', pitching ? "YOU'RE ON THE MOUND" : "YOU'RE AT THE PLATE");
  set('controls-help', pitching ? 'WASD AIM · HOLD, DRAW DOWN, PUSH UP, RELEASE · 1/2/3 PITCH' : connected ? 'MOUSE MOVES BAT · L/R BUTTONS HIGH/LOW · SPACE PITCH · ESC DUGOUT' : 'WASD PLACE · HOLD & FLICK LEFT · SPACE NEXT · ESC DUGOUT');
  set('zone-heading', pitching ? 'YOUR TARGET' : 'YOUR BAT');
  set('height-readout', `${aim.y.toFixed(2)} m`);
  set('placement-help', pitching ? 'WASD AIM · C CENTER' : connected ? 'L/R MOUSE OR W/S: HIGH–LOW' : 'W/S HIGH–LOW · A/D IN–OUT');
  $('pitch-choices').hidden = !pitching;
  $('zone-card').hidden = !$('zone-visible').checked;
  const sx = x => clamp(75 + (pitching ? -x : x) * 64 / .84, 7, 143);
  const sy = y => clamp(125 - (y - .5) * 91 / 1.2, 7, 133);
  $('bat-marker').setAttribute('d', `M${sx(aim.x) - 18} ${sy(aim.y)}H${sx(aim.x) + 18}`);
  $('bat-marker').style.display = pitching ? 'none' : '';
  $('aim-marker').setAttribute('cx', sx(aim.x)); $('aim-marker').setAttribute('cy', sy(aim.y));
  $('ball-marker').setAttribute('visibility', s.phase === 'pitch' ? 'visible' : 'hidden');
  $('ball-marker').setAttribute('cx', sx(s.ball.x)); $('ball-marker').setAttribute('cy', sy(s.ball.y));
  $('ball-marker').setAttribute('opacity', .3 + .7 * clamp((s.pitch?.elapsed || 0) / (s.pitch?.duration || 1), 0, 1));
  s.bases.forEach((occupied, i) => $('base-' + (i + 1)).classList.toggle('occupied', occupied));
  document.body.classList.toggle('fielding', s.phase === 'inplay');
  set('gesture-label', pitching ? 'THE THROW' : connected ? 'THE CONNECTED BAT' : 'THE CLASSIC SWING');
  $('bat-guide').hidden = !connected;
  let status = pitching ? 'DRAW ↓ · THROW ↑' : 'HOLD · FLICK LEFT ←';
  let detail = pitching ? 'Hold left mouse, draw down, push up. Release while moving. Hook sideways for curve.' : 'Let the ball travel. WASD places the barrel; your leftward flick supplies the swing.';
  let power = 0;
  if (connected) {
    const pose = directBat.snapshot(performance.now());
    const speed = s.bat.contactSpeed || 0;
    status = !directConnected ? 'CLICK THE FIELD TO CONNECT' : s.phase === 'ready' ? 'PRACTICE · SPACE TO PITCH' : s.phase === 'pitch' ? 'YOUR HAND IS THE BAT' : s.phase === 'inplay' ? 'FOLLOW IT THROUGH' : 'SPACE FOR THE NEXT PITCH';
    detail = directConnected ? 'Right draws back · left sweeps. Forward/back changes the wrist. Hold the barrel out for a bunt.' : 'Click once, then move freely. No held button needed to swing.';
    if (directConnected && document.pointerLockElement !== canvas) detail = 'Mouse capture unavailable: movement works inside the field. Click again to try capture.';
    power = speed / 40;
    set('bat-angle-readout', `${Math.round(s.bat.angle * 180 / Math.PI)}° BAT`);
    set('bat-speed-readout', `${speed.toFixed(1)} m/s`);
    set('bat-wrist-readout', Math.abs(pose.wrist) < .035 ? 'WRIST NEUTRAL' : `${Math.abs(pose.wrist * 180 / Math.PI).toFixed(0)}° ${pose.wrist > 0 ? 'OPEN' : 'CLOSED'}`);
    set('last-contact', lastContact
      ? `${lastContact.kind === 'bunt' ? 'BUNT' : 'CONTACT'} · bat ${lastContact.contact.barrelSpeed.toFixed(1)} m/s · ball ${Math.round(lastContact.exitSpeed * 2.237)} mph · ${Math.abs(lastContact.spray) < .07 ? 'CENTER' : lastContact.spray > 0 ? 'RIGHT' : 'LEFT'}`
      : 'Contact speed and direction will appear here.');
    drawBatGuide($('bat-guide-canvas'), s, directBat);
  } else if (pitching && pitchGesture.active) {
    const preview = pitchGesture.preview();
    status = preview ? 'RELEASE TO THROW' : pitchGesture.armed ? 'PUSH UP ↑' : 'DRAW BACK ↓';
    power = preview ? preview.speed / 40 : clamp(pitchGesture.back / 60, 0, .35);
    if (preview) detail = `${Math.round(preview.speed * 2.237)} mph hand delivery · ${Math.round(Math.abs(preview.curve) * 100)}% hook`;
  } else if (clock - gestureAt < 2.4) { status = gestureNote; power = gesturePower; }
  else if (s.phase === 'inplay') { status = 'RUN, YOU BEAUTY!'; detail = 'The fielders and runners take it from here.'; }
  else if (s.phase === 'pitch' && !pitching) { status = 'WATCH IT IN…'; }
  set('gesture-status', status); set('gesture-detail', detail); $('gesture-fill').style.width = `${clamp(power, 0, 1) * 100}%`;
  const show = started && (paused || ['result', 'finished'].includes(s.phase) || (s.phase === 'ready' && clock - phaseAt < 2.5));
  $('announcement').hidden = !show || !$('dugout').hidden;
  if (show) {
    set('announcement-label', paused ? 'TAKE A BREATHER' : s.phase === 'finished' ? 'THAT’S THE BALL GAME' : s.phase === 'ready' ? (pitching ? 'THE BALL IS IN YOUR HAND' : 'SET YOUR FEET') : 'FROM THE UMPIRE');
    set('announcement-title', paused ? 'TIME OUT' : s.phase === 'ready' ? (pitching ? 'YOUR PITCH' : $('auto-next').checked ? 'HERE IT COMES' : 'FIND YOUR SWING') : s.feedback.title);
    let detail = paused ? 'Press Space to resume.' : s.phase === 'ready' ? (pitching ? 'WASD sets the target. Hold left mouse, draw down, push up, release.' : connected ? 'Move the mouse to feel the bat. Left/right buttons raise/lower. Space calls a pitch.' : 'WASD places the bat. Hold left mouse and flick left as the pitch arrives.') : s.feedback.detail;
    if (!paused && s.phase !== 'ready' && s.feedback.timingMs != null) detail += `  ${Math.abs(s.feedback.timingMs).toFixed(0)} ms ${s.feedback.timingMs < 0 ? 'early' : 'late'}.`;
    if (!paused && s.feedback.distance > 0) detail += `  ${Math.round(s.feedback.distance)} m.`;
    set('announcement-copy', detail);
    $('next-play').hidden = !paused && s.phase === 'ready';
    $('next-play').innerHTML = `${paused ? 'RESUME' : s.phase === 'finished' ? 'PLAY AGAIN' : 'NEXT PITCH'} <kbd>SPACE</kbd>`;
  }
}
let previous = performance.now();
function frame(now) {
  const dt = Math.min((now - previous) / 1000, .04); previous = now;
  const active = started && !paused && $('dugout').hidden;
  if (active) {
    clock += dt;
    const pitching = game.state.role === 'pitching';
    const horizontal = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const vertical = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    aim.x = clamp(aim.x + horizontal * dt * .8 * (pitching ? -1 : 1), pitching ? -1.2 : -.65, pitching ? 1.2 : .65);
    aim.y = direct() ? directBatHeight(aim.y, { buttons: directButtons, keys, dt }) : clamp(aim.y + vertical * dt * .85, pitching ? .2 : .35, pitching ? 2.4 : 2.05);
    if (direct()) game.setBatPose({ angle: directBat.angle, reach: directBat.reach, x: aim.x, y: aim.y });
    else if (!pitching) game.setBatAim(aim.x, aim.y);
    if (game.state.phase === 'ready' && !pitching && $('auto-next').checked && (!direct() || directConnected) && clock - phaseAt > 2.5) game.next();
    if (game.state.phase === 'result' && $('auto-next').checked && clock - phaseAt > 3.2) advance();
    game.update(dt);
    for (const event of game.drainEvents()) {
      if (event.type === 'contact') {
        excitement = .7; $('commentary').textContent = game.state.feedback.detail;
        if (direct() && game.state.hit?.contact) lastContact = structuredClone(game.state.hit);
      }
      if (event.runs > 0) { excitement = 1; scene.react('run'); }
      if (event.type === 'out') $('commentary').textContent = '“Plenty of innings left in those arms.” — Dot';
    }
    if (game.state.role !== lastRole) {
      lastRole = game.state.role; aim = { x: 0, y: 1.05 }; cancelGesture(); directBat.reset(performance.now());
    }
    if (game.state.phase !== lastPhase) {
      lastPhase = game.state.phase; phaseAt = clock;
      if (lastPhase === 'pitch' && held && game.state.role === 'batting' && !direct()) batGesture.begin(performance.now());
      if (['result', 'finished'].includes(lastPhase)) cancelGesture(false, false);
    }
    excitement = Math.max(0, excitement - dt * .12);
  }
  scene.update(dt, now / 1000, game.state, { drunk: Number($('vision').value) / 100, excitement, aim,
    reducedMotion, showZone: $('zone-visible').checked, showAim: started && $('zone-visible').checked,
    delivery: { active: pitchGesture.active, back: pitchGesture.back || 0, forward: pitchGesture.forward || 0 } });
  updateHud(); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.addEventListener('pagehide', () => { cancelGesture(); scene.dispose(); });

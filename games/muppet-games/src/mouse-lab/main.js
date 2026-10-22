import { MovementRecording, MAX_TAKES, MAX_SAMPLES, MAX_DURATION, positionAt, recordingMetrics, recordingBundle, loadRecordings, inputStateAt, addMarker } from './recording.js';

const $ = id => document.getElementById(id);
const pad = $('motion-pad'), graph = $('speed-graph');
const STORAGE = 'mouse-lab:recordings:v1';
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const seconds = n => `${(n / 1000).toFixed(2)} s`;
let takes = [], selected = null, session = null, countdown = null, lastMouse = null;
let playing = false, playhead = 0, lastFrame = performance.now(), dirty = true, selectedMetrics = null;
let storageOkay = true;
const heldKeys = new Map();
let heldButtons = 0;
const modifiers = e => ({ alt: e.altKey, ctrl: e.ctrlKey, shift: e.shiftKey, meta: e.metaKey });
const keyValue = e => ({ code: e.code, key: e.key, location: e.location, repeat: e.repeat, modifiers: modifiers(e) });
const keyLabel = code => code.replace(/^Key/, '').replace(/^Digit/, '').replace(/Left$/, ' L').replace(/Right$/, ' R');
const buttonNames = { 0: 'LEFT', 1: 'MIDDLE', 2: 'RIGHT', 3: 'BACK', 4: 'FORWARD' };
try { takes = loadRecordings(localStorage.getItem(STORAGE)); } catch { storageOkay = false; }
const room = new URLSearchParams(location.search).get('room');
if (room) $('back-to-baseball').href += `?room=${encodeURIComponent(room)}`;

function json() { return JSON.stringify(recordingBundle(takes), null, 2); }
function save() {
  const data = json(); $('recording-json').value = data;
  try { localStorage.setItem(STORAGE, data); storageOkay = true; }
  catch { storageOkay = false; }
  $('save-status').textContent = storageOkay ? `${takes.length} take${takes.length === 1 ? '' : 's'} saved in this browser. Download a copy to keep separately.` : 'Browser storage is unavailable or full. Download the JSON before leaving this tab.';
  $('download').disabled = $('done').disabled = !takes.length;
  $('take-count').textContent = `${takes.length} / ${MAX_TAKES}`;
  $('record').disabled = takes.length >= MAX_TAKES;
  if (takes.length >= MAX_TAKES) $('capture-hint').textContent = '12 takes saved. Download them, or remove a take to record another.';
}
function renderTakes() {
  $('takes').replaceChildren();
  if (!takes.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Your movements will appear here.'; $('takes').append(p); }
  for (const [i, take] of takes.entries()) {
    const b = document.createElement('button'); b.className = 'take' + (take === selected ? ' selected' : ''); b.setAttribute('aria-pressed', String(take === selected));
    const text = document.createElement('span'); text.textContent = `TAKE ${String(i + 1).padStart(2, '0')} · ${take.label}`;
    const sub = document.createElement('small'); sub.textContent = `${take.samples.length} samples · ${take.events.length} events · ${take.input === 'pointer-lock-relative' ? 'relative' : 'cursor'}${take.endReason !== 'finished' && take.endReason !== 'time-limit' ? ` · ${take.endReason}` : ''}`;
    text.append(sub); const duration = document.createElement('b'); duration.textContent = seconds(take.duration); b.append(text, duration);
    b.onclick = () => { if (!session && countdown === null) select(take); }; $('takes').append(b);
  }
}
function select(take) {
  selected = take; selectedMetrics = take ? recordingMetrics(take) : null;
  playing = false; playhead = take?.duration || 0; $('replay').textContent = '▶ REPLAY';
  $('take-detail').hidden = !take; $('take-notes').value = take?.notes || '';
  $('replay').disabled = $('scrub').disabled = !take;
  $('ready-message').hidden = true; renderTakes(); renderMarkers(); renderEvents(); dirty = true;
}
function setBusy(busy) {
  document.body.classList.toggle('capturing', busy);
  $('record').hidden = busy; $('stop').hidden = !busy;
  for (const id of ['take-label', 'handedness', 'capture-pointer', 'download', 'done', 'remove-take', 'take-notes', 'replay-rate', 'marker-note', 'add-marker']) $(id).disabled = busy || (['download', 'done'].includes(id) && !takes.length);
  $('replay').disabled = $('scrub').disabled = busy || !selected;
}
function unlock() { if (document.pointerLockElement === pad) document.exitPointerLock(); }
function beginCount() {
  if (session || countdown !== null || takes.length >= MAX_TAKES) return;
  playing = false; lastMouse = null; countdown = performance.now() + 2000;
  $('ready-message').hidden = true; $('recording-data').open = false; setBusy(true); pad.focus({ preventScroll: true });
  if ($('capture-pointer').checked) {
    try { pad.requestPointerLock()?.catch(() => { $('capture-hint').textContent = 'Using the visible cursor. Keep your motion inside this window.'; }); }
    catch { $('capture-hint').textContent = 'Using the visible cursor. Keep your motion inside this window.'; }
  }
  dirty = true;
}
function beginCapture(now) {
  countdown = null;
  session = new MovementRecording(now, { label: $('take-label').value.trim() || `Movement ${takes.length + 1}`, mouseHand: $('handedness').value,
    input: document.pointerLockElement === pad ? 'pointer-lock-relative' : 'cursor',
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }, initialKeys: [...heldKeys.values()], initialButtons: heldButtons });
  lastMouse = null;
  $('capture-status').textContent = 'RECORDING · MOVE NATURALLY';
  $('capture-hint').textContent = `${session.take.input === 'cursor' ? 'Cursor mode: stay inside this window. ' : 'Relative mode: unrestricted movement. '}Esc / F8 finishes · F6 marks a moment`; $('input-events').replaceChildren(); dirty = true;
}
function finish(reason = 'finished') {
  if (countdown !== null) {
    countdown = null; setBusy(false); unlock(); $('capture-status').textContent = 'COUNT-IN CANCELLED'; dirty = true; return;
  }
  if (!session) return;
  const take = session.finish(performance.now(), reason); session = null; lastMouse = null;
  takes.push(take); setBusy(false); unlock(); select(take); save();
  $('capture-status').textContent = `TAKE ${String(takes.length).padStart(2, '0')} SAVED`;
  if (takes.length < MAX_TAKES) $('capture-hint').textContent = 'Saved. Replay, explain what you meant, or record another.';
}
$('record').onclick = beginCount; $('stop').onclick = () => finish();
window.addEventListener('pointermove', e => {
  if (!session || e.pointerType !== 'mouse') return;
  const locked = document.pointerLockElement === pad;
  const dx = locked ? e.movementX : lastMouse ? e.clientX - lastMouse.x : e.movementX;
  const dy = locked ? e.movementY : lastMouse ? e.clientY - lastMouse.y : e.movementY;
  lastMouse = { x: e.clientX, y: e.clientY };
  heldButtons = e.buttons;
  if (session.move(dx, dy, performance.now(), e.buttons, modifiers(e)) && session.take.samples.length >= MAX_SAMPLES) finish('sample-limit');
  dirty = true;
});
for (const [event, kind] of [['pointerdown', 'button-down'], ['pointerup', 'button-up']]) window.addEventListener(event, e => {
  if (e.pointerType !== 'mouse') return;
  heldButtons = e.buttons;
  if (session) { e.preventDefault(); session.event(kind, { button: e.button, buttons: e.buttons, modifiers: modifiers(e) }, performance.now()); }
});
window.addEventListener('auxclick', e => { if (session || countdown !== null) e.preventDefault(); });
window.addEventListener('contextmenu', e => { if (session || countdown !== null) e.preventDefault(); });
window.addEventListener('wheel', e => {
  if (!session) return;
  e.preventDefault(); session.event('wheel', { deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode, modifiers: modifiers(e) }, performance.now()); dirty = true;
}, { passive: false });
window.addEventListener('keydown', e => {
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.code === 'F8' && !e.repeat) { e.preventDefault(); session || countdown !== null ? finish() : beginCount(); return; }
  if (e.code === 'Escape') { if (session || countdown !== null) { e.preventDefault(); finish('escape'); } return; }
  if (e.code === 'F6') { if (session && !e.repeat) { e.preventDefault(); session.event('marker', `Moment ${session.take.markers.length + 1}`, performance.now()); } return; }
  if (!session && countdown === null) { heldKeys.set(e.code, keyValue(e)); return; }
  e.preventDefault();
  heldKeys.set(e.code, keyValue(e));
  if (session) session.event('key-down', keyValue(e), performance.now());
});
window.addEventListener('keyup', e => {
  heldKeys.delete(e.code);
  if (session && !['F8', 'F6', 'Escape'].includes(e.code)) { e.preventDefault(); session.event('key-up', keyValue(e), performance.now()); }
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && (session?.take.input === 'pointer-lock-relative' || (countdown !== null && $('capture-pointer').checked))) finish('pointer-released');
});
window.addEventListener('blur', () => { finish('focus-lost'); heldKeys.clear(); heldButtons = 0; });
document.addEventListener('visibilitychange', () => { if (document.hidden) finish('tab-hidden'); });
window.addEventListener('pagehide', () => { finish('page-left'); });
$('take-notes').addEventListener('input', () => { if (selected) { selected.notes = $('take-notes').value; save(); } });
$('add-marker').onclick = () => {
  const label = $('marker-note').value.trim(); if (!selected || !label || selected.markers.length >= 100) return;
  addMarker(selected, playhead, label); $('marker-note').value = ''; renderMarkers(); save(); dirty = true;
};
function renderMarkers() {
  $('markers').replaceChildren();
  if (!selected) return;
  for (const marker of selected.markers) {
    const row = document.createElement('div'); row.className = 'marker-row';
    const jump = document.createElement('button'); jump.className = 'marker-jump'; jump.textContent = `${seconds(marker.t)} · ${marker.label}`;
    jump.onclick = () => { playing = false; playhead = marker.t; $('replay').textContent = '▶ REPLAY'; dirty = true; };
    const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label', `Remove note at ${seconds(marker.t)}`);
    remove.onclick = () => { selected.markers = selected.markers.filter(m => m !== marker); renderMarkers(); save(); dirty = true; };
    row.append(jump, remove); $('markers').append(row);
  }
}
function renderEvents() {
  $('input-events').replaceChildren(); if (!selected) return;
  for (const event of selected.events.slice(0, 100)) {
    let label;
    if (event.kind.startsWith('key-')) label = `${keyLabel(event.value.code)} ${event.kind === 'key-down' ? '↓' : '↑'}${event.value.repeat ? ' repeat' : ''}`;
    else if (event.kind.startsWith('button-')) label = `${buttonNames[event.value.button] || 'BUTTON'} ${event.kind === 'button-down' ? '↓' : '↑'}`;
    else if (event.kind === 'wheel') label = `SCROLL ${event.value.deltaX}, ${event.value.deltaY}`;
    else label = 'MARK';
    const button = document.createElement('button'); button.textContent = `${seconds(event.t)} ${label}`;
    button.onclick = () => { playing = false; playhead = event.t; $('replay').textContent = '▶ REPLAY'; dirty = true; }; $('input-events').append(button);
  }
  if (selected.events.length > 100) { const more = document.createElement('span'); more.textContent = `+ ${selected.events.length - 100} events in the JSON`; $('input-events').append(more); }
}
$('remove-take').onclick = () => {
  if (!selected || session) return;
  const index = takes.indexOf(selected); takes.splice(index, 1); select(takes[Math.min(index, takes.length - 1)] || null); save();
  $('capture-status').textContent = takes.length ? 'TAKE REMOVED · READY TO RECORD' : 'READY WHEN YOU ARE';
  $('capture-hint').textContent = 'Two-second count-in · up to 12 seconds per take';
};
$('replay').onclick = () => {
  if (!selected) return;
  if (!playing && playhead >= selected.duration) playhead = 0;
  playing = !playing; $('replay').textContent = playing ? 'Ⅱ PAUSE' : '▶ REPLAY'; dirty = true;
};
$('scrub').oninput = () => { if (selected) { playing = false; playhead = selected.duration * Number($('scrub').value) / 1000; $('replay').textContent = '▶ REPLAY'; dirty = true; } };
$('download').onclick = () => {
  if (!takes.length) return;
  const url = URL.createObjectURL(new Blob([json()], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `mouse-lab-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
};
$('done').onclick = () => {
  if (!takes.length) return;
  playing = false; save(); $('ready-message').hidden = false;
  $('ready-copy').textContent = `${takes.length} take${takes.length === 1 ? '' : 's'} · ${seconds(takes.reduce((sum, t) => sum + t.duration, 0))} of movement · ${takes.reduce((n, t) => n + t.events.length, 0)} input events · ${takes.reduce((n, t) => n + t.markers.length, 0)} moment notes.`;
  $('capture-status').textContent = 'SAVED · READY FOR CODEX'; $('replay').textContent = '▶ REPLAY';
  $('ready-message').scrollIntoView({ behavior: 'smooth', block: 'center' });
};

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) { canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
  return { ctx, w: rect.width, h: rect.height };
}
function drawPath(take, metrics, time) {
  const { ctx, w, h } = setupCanvas(pad);
  const m = metrics || { minX: -250, maxX: 250, minY: -120, maxY: 120 };
  const scale = Math.min((w - 80) / Math.max(500, m.maxX - m.minX), (h - 72) / Math.max(240, m.maxY - m.minY));
  const cx = (m.minX + m.maxX) / 2, cy = (m.minY + m.maxY) / 2;
  const x = v => w / 2 + (v - cx) * scale, y = v => h / 2 + (v - cy) * scale;
  const grid = Math.max(100, Math.ceil(30 / scale / 100) * 100);
  ctx.lineWidth = 1; ctx.strokeStyle = '#92b49716'; ctx.beginPath();
  for (let px = x(0) % (grid * scale); px < w; px += grid * scale) { ctx.moveTo(px, 0); ctx.lineTo(px, h); }
  for (let py = y(0) % (grid * scale); py < h; py += grid * scale) { ctx.moveTo(0, py); ctx.lineTo(w, py); }
  ctx.stroke(); $('path-scale').textContent = `1 grid square = ${grid} px`;
  if (!take) return;
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#b9cdbc36'; ctx.beginPath(); take.samples.forEach((p, i) => i ? ctx.lineTo(x(p.x), y(p.y)) : ctx.moveTo(x(p.x), y(p.y))); ctx.stroke();
  let previous = take.samples[0];
  for (let i = 1; i < take.samples.length; i++) {
    const raw = take.samples[i]; if (previous.t > time) break;
    const p = raw.t > time ? positionAt(take, time) : raw;
    ctx.strokeStyle = take.markers.length && p.t >= take.markers[0].t ? '#f3c76a' : '#80bdc6'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x(previous.x), y(previous.y)); ctx.lineTo(x(p.x), y(p.y)); ctx.stroke();
    previous = raw; if (raw.t >= time) break;
  }
  ctx.font = '9px sans-serif'; ctx.fillStyle = '#b6c8b6'; ctx.fillText('START', x(0) + 8, y(0) - 9);
  ctx.strokeStyle = '#d9e1c6'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x(0), y(0), 4, 0, Math.PI * 2); ctx.stroke();
  for (const [i, marker] of take.markers.entries()) {
    const point = positionAt(take, marker.t); ctx.strokeStyle = '#f3c76a'; ctx.beginPath(); ctx.arc(x(point.x), y(point.y), 8, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#f3c76a'; ctx.fillText(`${i + 1}. ${marker.label.slice(0, 28)}`, x(point.x) + 12, y(point.y) - 10);
  }
  const point = positionAt(take, time); ctx.fillStyle = '#f7d281'; ctx.beginPath(); ctx.arc(x(point.x), y(point.y), 4.5, 0, Math.PI * 2); ctx.fill();
}
function drawSpeed(take, metrics, time) {
  const { ctx, w, h } = setupCanvas(graph); if (!take) return;
  const left = 18, right = w - 18, bottom = h - 12, top = 10;
  const x = t => left + t / Math.max(take.duration, 1) * (right - left), y = v => bottom - v / Math.max(metrics.peakSpeed, 100) * (bottom - top);
  ctx.strokeStyle = '#b8cba92b'; ctx.beginPath(); ctx.moveTo(left, bottom); ctx.lineTo(right, bottom); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(left, bottom); for (const p of metrics.speed) ctx.lineTo(x(p.t), y(p.v)); ctx.lineTo(x(take.duration), bottom); ctx.closePath(); ctx.fillStyle = '#80bdc61b'; ctx.fill();
  ctx.strokeStyle = '#80bdc6'; ctx.lineWidth = 1.5; ctx.beginPath(); metrics.speed.forEach((p, i) => i ? ctx.lineTo(x(p.t), y(p.v)) : ctx.moveTo(x(p.t), y(p.v))); ctx.stroke();
  for (const marker of take.markers) { ctx.strokeStyle = '#f3c76a80'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x(marker.t), top); ctx.lineTo(x(marker.t), bottom); ctx.stroke(); ctx.setLineDash([]); }
  ctx.strokeStyle = '#f3c76a'; ctx.beginPath(); ctx.moveTo(x(time), top); ctx.lineTo(x(time), bottom); ctx.stroke();
}
function draw(now) {
  let take = session?.take || selected, metrics = session ? recordingMetrics(session.take) : selectedMetrics;
  const time = session ? session.time(now) : playhead;
  $('pad-message').hidden = !!take && countdown === null;
  if (countdown !== null) {
    $('pad-message').hidden = false; $('pad-kicker').textContent = 'GET COMFORTABLE'; $('pad-title').textContent = String(Math.max(1, Math.ceil((countdown - now) / 1000))); $('pad-copy').textContent = 'Recording starts after the count-in. Then move your way.';
    $('capture-status').textContent = 'COUNTING IN…';
  } else if (!take) { $('pad-kicker').textContent = 'NOTHING TO GET RIGHT'; $('pad-title').textContent = 'Make it feel natural.'; $('pad-copy').textContent = 'Demonstrate a movement. Then explain what you intended to happen.'; }
  if (session) take.duration = time;
  drawPath(take, metrics, time); drawSpeed(take, metrics, time);
  $('record-clock').textContent = `${(session ? time / 1000 : 0).toFixed(2)} / 12 s`;
  $('metric-duration').textContent = take ? seconds(take.duration) : '—';
  $('metric-distance').textContent = take ? `${Math.round(metrics.distance)} px` : '—';
  $('metric-speed').textContent = take ? `${Math.round(metrics.peakSpeed)} px/s` : '—';
  $('metric-events').textContent = take ? String(take.events.length) : '—';
  const state = take ? inputStateAt(take, time) : { keys: [], buttons: 0, wheel: null };
  const buttons = [[1, 'LEFT MOUSE'], [2, 'RIGHT MOUSE'], [4, 'MIDDLE MOUSE'], [8, 'BACK'], [16, 'FORWARD']].filter(([mask]) => state.buttons & mask).map(([, name]) => name);
  $('held-inputs').textContent = [...buttons, ...state.keys.map(keyLabel)].join(' + ') || 'No keys or buttons';
  $('wheel-input').textContent = state.wheel ? `SCROLL x ${state.wheel.deltaX} / y ${state.wheel.deltaY}` : '';
  $('add-marker').textContent = `+ NOTE AT ${seconds(time).toUpperCase()}`;
  $('replay-time').textContent = seconds(time);
  $('scrub').value = take?.duration ? Math.round(time / take.duration * 1000) : 0;
}
new ResizeObserver(() => { dirty = true; }).observe($('drawing-area'));
function frame(now) {
  const dt = Math.min(now - lastFrame, 100); lastFrame = now;
  if (countdown !== null && now >= countdown) beginCapture(now);
  if (session && now - session.origin >= MAX_DURATION) finish('time-limit');
  if (playing && selected) {
    playhead = Math.min(selected.duration, playhead + dt * Number($('replay-rate').value));
    if (playhead >= selected.duration) { playing = false; $('replay').textContent = '▶ REPLAY'; }
    dirty = true;
  }
  if (dirty || session || countdown !== null) { draw(now); dirty = false; }
  requestAnimationFrame(frame);
}
select(takes.at(-1) || null); save(); requestAnimationFrame(frame);

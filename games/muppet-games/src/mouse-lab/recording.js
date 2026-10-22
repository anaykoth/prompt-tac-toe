export const RECORDING_VERSION = 1;
export const MAX_TAKES = 12;
export const MAX_SAMPLES = 8000;
export const MAX_DURATION = 12000;
const finite = Number.isFinite;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Keep unfiltered input and intent separately. No game recognizer runs here.
export class MovementRecording {
  constructor(now, metadata = {}) {
    this.origin = now;
    this.take = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, recordedAt: new Date().toISOString(),
      label: metadata.label || 'Movement', mouseHand: metadata.mouseHand || 'right',
      input: metadata.input || 'cursor', viewport: metadata.viewport || null,
      duration: 0, markers: [], notes: '', endReason: null,
      initialKeys: metadata.initialKeys || [], initialButtons: metadata.initialButtons || 0,
      samples: [{ t: 0, x: 0, y: 0, dx: 0, dy: 0, buttons: metadata.initialButtons || 0 }], events: [] };
    this.closed = false;
  }
  time(now) { return clamp(now - this.origin, 0, MAX_DURATION); }
  move(dx, dy, now, buttons = 0, modifiers = {}) {
    if (this.closed || ![dx, dy, now].every(finite) || this.take.samples.length >= MAX_SAMPLES) return false;
    const previous = this.take.samples.at(-1);
    const t = Math.max(previous.t, this.time(now));
    this.take.samples.push({ t, x: previous.x + dx, y: previous.y + dy, dx, dy, buttons, modifiers });
    this.take.duration = t;
    return true;
  }
  event(kind, value, now) {
    if (this.closed || this.take.events.length >= 3000) return;
    this.take.events.push({ t: this.time(now), kind, value });
    if (kind === 'marker') addMarker(this.take, this.time(now), value);
  }
  finish(now, reason = 'finished') {
    if (!this.closed) {
      this.take.duration = Math.max(this.take.samples.at(-1).t, this.time(now));
      this.take.endReason = reason; this.closed = true;
    }
    return this.take;
  }
}

export function addMarker(take, time, label) {
  const marker = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, t: clamp(time, 0, MAX_DURATION), label: String(label).slice(0, 500) };
  take.markers.push(marker); take.markers.sort((a, b) => a.t - b.t); return marker;
}

export function inputStateAt(take, time) {
  const keys = new Map((take.initialKeys || []).map(key => [key.code, key]));
  let buttons = take.initialButtons || 0, wheel = null;
  for (const event of take.events) {
    if (event.t > time) break;
    if (event.kind === 'key-down') keys.set(event.value.code, event.value);
    if (event.kind === 'key-up') keys.delete(event.value.code);
    if (event.kind === 'button-down' || event.kind === 'button-up') buttons = event.value.buttons;
    if (event.kind === 'wheel' && time - event.t < 250) wheel = event.value;
  }
  return { keys: [...keys.keys()], buttons, wheel };
}

export function positionAt(take, time) {
  const samples = take.samples;
  if (time <= samples[0].t) return { ...samples[0] };
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (samples[mid].t <= time) lo = mid; else hi = mid - 1; }
  const a = samples[lo], b = samples[Math.min(lo + 1, samples.length - 1)];
  const f = b.t > a.t ? clamp((time - a.t) / (b.t - a.t), 0, 1) : 0;
  return { t: time, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, buttons: a.buttons };
}

export function recordingMetrics(take) {
  let distance = 0, peakSpeed = 0, minX = 0, minY = 0, maxX = 0, maxY = 0, start = 0;
  const speed = [];
  for (let i = 0; i < take.samples.length; i++) {
    const p = take.samples[i];
    if (i) distance += Math.hypot(p.dx, p.dy);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    while (start + 1 < i && take.samples[start + 1].t < p.t - 40) start++;
    const q = take.samples[start], dt = p.t - q.t;
    const v = dt > 0 ? Math.hypot(p.x - q.x, p.y - q.y) * 1000 / dt : 0;
    peakSpeed = Math.max(peakSpeed, v); speed.push({ t: p.t, v });
  }
  return { distance, peakSpeed, minX, maxX, minY, maxY, speed };
}

export function recordingBundle(takes) {
  return { format: 'mouse-lab-recordings', version: RECORDING_VERSION, exportedAt: new Date().toISOString(),
    coordinates: 'Browser mouse pixels. +x right, +y down. Each take starts at (0,0). t is milliseconds from recording start. Relative input follows browser/OS mouse settings; not physical hand distance. Keyboard events include code, key and modifiers. Mouse buttons use the browser bitmask (left1, right2, middle4, back8, forward16). Wheel deltaMode is 0 pixels, 1 lines, 2 pages. F8 finishes, F6 marks a moment, Escape stops; these recorder shortcuts are reserved.',
    takes: takes.map(take => { const { speed, ...metrics } = recordingMetrics(take); return { ...take, metrics }; }) };
}

export function loadRecordings(text) {
  try {
    const data = JSON.parse(text);
    if (data.format !== 'mouse-lab-recordings' || data.version !== RECORDING_VERSION || !Array.isArray(data.takes)) return [];
    return data.takes.slice(0, MAX_TAKES).filter(take => {
      if (!take || typeof take.id !== 'string' || !finite(take.duration) || take.duration < 0 || take.duration > MAX_DURATION) return false;
      if (!Array.isArray(take.samples) || !take.samples.length || take.samples.length > MAX_SAMPLES || !Array.isArray(take.events) || take.events.length > 3000 || !Array.isArray(take.markers) || take.markers.length > 100) return false;
      if (!Array.isArray(take.initialKeys) || !take.initialKeys.every(key => key && typeof key.code === 'string') || !Number.isInteger(take.initialButtons)) return false;
      let eventTime = -1;
      if (!take.events.every(e => {
        if (!e || !finite(e.t) || e.t < eventTime || e.t > take.duration) return false;
        eventTime = e.t;
        if (e.kind === 'key-down' || e.kind === 'key-up') return e.value && typeof e.value.code === 'string' && typeof e.value.key === 'string';
        if (e.kind === 'button-down' || e.kind === 'button-up') return e.value && Number.isInteger(e.value.button) && Number.isInteger(e.value.buttons);
        if (e.kind === 'wheel') return e.value && [e.value.deltaX, e.value.deltaY, e.value.deltaZ, e.value.deltaMode].every(finite);
        return e.kind === 'marker' && typeof e.value === 'string';
      })) return false;
      let time = -1;
      return take.samples.every(p => {
        if (!p || ![p.t, p.x, p.y, p.dx, p.dy].every(finite) || p.t < time || p.t > take.duration || Math.abs(p.x) > 1e7 || Math.abs(p.y) > 1e7) return false;
        time = p.t; return true;
      }) && take.markers.every(m => finite(m.t) && m.t >= 0 && m.t <= take.duration && typeof m.label === 'string');
    });
  } catch { return []; }
}

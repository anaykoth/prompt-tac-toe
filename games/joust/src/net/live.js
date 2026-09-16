import { LiveLink as SharedLink, SeenIds, ServerClock } from '../../../shared/net/live.js';
import { IDLE_INPUT } from '../game/spec.js';

/**
 * TILT ALLEY's live tier: the other rider, on your screen, now.
 *
 * Each seat broadcasts its own packed input ticks in small batches while the
 * pass runs, so the remote horse and lance are driven by real input roughly
 * 100 ms behind rather than guessed at. Spectacle only — the verdict comes
 * from the server re-simulating both traces. Everything here may be lost,
 * duplicated or arrive out of order, and RemoteLog is built to expect that.
 */
export const CHANNEL = 'tilt-alley-live';
/**
 * Six ticks a packet is ten packets a second per rider. The Supabase Free
 * plan allows 100 Realtime messages a second across the whole project and
 * disconnects the client above it, so the stream is deliberately kept an
 * order of magnitude below the ceiling; the sim never depends on a packet
 * arriving, only on the batch index it carries.
 */
export const BATCH_TICKS = 6;
/** Both browsers start their sim this far after the server's T0 (200 ms). */
export const LAG_TICKS = 12;

/**
 * A dense copy of a sparse input log, holes held.
 *
 * The shell writes one packed input per FRAME, but the sim can cross several
 * ticks inside that frame, so the log it leaves behind has a hole wherever a
 * tick went by without a frame. `PassSim._sampleTick` fills those by holding
 * the previous raw input; holding it here reproduces exactly what the local
 * sim ran, which is what the wire and the server must be handed. Pure: `log`
 * is never touched.
 */
export function denseLog(log, upto = log?.length ?? 0) {
  const n = Math.max(0, Math.floor(Number(upto) || 0));
  const out = new Array(n);
  let held = IDLE_INPUT;
  for (let i = 0; i < n; i++) {
    const t = log?.[i];
    if (Array.isArray(t) && t.length === 5) held = t;
    out[i] = held;
  }
  return out;
}

export class LiveLink {
  constructor({ seat, onTicks = () => {}, onReady = () => {}, onEnded = () => {}, onPresence = () => {} } = {}) {
    this.seat = seat;
    this.link = new SharedLink({
      channel: CHANNEL,
      seat,
      on: {
        ticks: (p) => onTicks(p),      // {seat, pass, from, ticks:[[..5..], ...]}
        ready: (p) => onReady(p),      // {seat, pass}
        ended: (p) => onEnded(p),      // {seat, pass, ticks}
      },
      rate: {},                        // tick batches are a log, never throttled
      onPresence,
    });
  }

  connect() { this.link.connect(); }
  stop() { this.link.stop(); }
  get up() { return this.link.up; }
  /** Test seam: drive a fake channel, same as the shared layer. */
  _wire(chan) { this.link._wire(chan); }

  /** A batch of packed input ticks starting at absolute tick index `from`. */
  sendTicks(pass, from, ticks) { return this.link.send('ticks', { pass, from, ticks }); }
  sendReady(pass) { return this.link.send('ready', { pass }); }
  sendEnded(pass, ticks = 0) { return this.link.send('ended', { pass, ticks }); }
}

/**
 * Accumulates the other seat's tick batches into a sparse log for one pass.
 *
 * Packets drop and reorder, so gaps are filled by holding the last tick we
 * did receive — a rider whose stream stutters freezes mid-posture instead of
 * snapping to neutral, and catches up the moment the next batch lands.
 */
export class RemoteLog {
  constructor(pass = 0) {
    this.pass = pass;
    this.ticks = [];        // sparse: holes stay undefined
    this.top = -1;          // highest index actually received
    this.received = 0;
  }

  /** Accept a batch; ignores anything from another pass. */
  add({ pass, from, ticks } = {}) {
    if (pass !== undefined && pass !== this.pass) return false;
    if (!Number.isInteger(from) || from < 0 || !Array.isArray(ticks)) return false;
    for (let i = 0; i < ticks.length; i++) {
      const t = ticks[i];
      if (!Array.isArray(t) || t.length !== 5) continue;
      this.ticks[from + i] = t;
      if (from + i > this.top) this.top = from + i;
      this.received++;
    }
    return true;
  }

  /** Highest received index + 1: how far the remote rider has got. */
  get length() { return this.top + 1; }

  /** The tick at `i`, holding the previous one across a gap. */
  at(i) {
    if (!Number.isInteger(i) || i < 0) return [0, 0, 0, 0, 0];
    const hit = this.ticks[i];
    if (hit) return hit;
    for (let j = Math.min(i, this.top); j >= 0; j--) if (this.ticks[j]) return this.ticks[j];
    return [0, 0, 0, 0, 0];
  }

  /** Dense log up to `n` ticks, gaps held — what a local preview replays. */
  toLog(n = this.length) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(this.at(i));
    return out;
  }

  reset(pass = this.pass) { this.pass = pass; this.ticks = []; this.top = -1; this.received = 0; }
}

export { SeenIds, ServerClock };

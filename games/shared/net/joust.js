import { LiveLink, SeenIds, ServerClock } from './live.js';

/**
 * Online jousting session: the pass lifecycle, on the shared clock.
 *
 *   idle ──ready()──▶ (server arms once both are ready)
 *   armed ────────▶ charging ────────▶ contact ────────▶ idle / over
 *         T0 on the          Tc on the           server verdict
 *         ServerClock        fixed timeline      (or the peer's trace, instantly)
 *
 * The game gives this three things: `input()` (sampled at tickHz while
 * charging: the lance and the waist), `resolvePass` (its pure pass sim, the
 * same one the server runs) and callbacks. It never sends an outcome.
 *
 * Two channels, as in darts:
 *  - HTTP (join/state/ready/trace/presence) is authoritative and polled:
 *    3.5 s idle, 650 ms whenever a pass is live.
 *  - The broadcast channel streams our input to the other seat while we
 *    charge ('rider'), and hands them our whole trace the moment we contact
 *    ('trace'). With both traces and the resolver in hand the other browser
 *    computes the same verdict the server is about to, so the impact plays
 *    within a packet of contact instead of a poll later. The server result
 *    then either matches (nothing happens) or wins (`corrected: true`).
 */
const IDLE_MS = 3500;
const ACTIVE_MS = 650;
const HEARTBEAT_MS = 6000;
export const CHANNEL = 'joust-live';

const same = (a, b) => JSON.stringify([a?.hits ?? [], a?.unhorsed ?? null]) === JSON.stringify([b?.hits ?? [], b?.unhorsed ?? null]);

export class JoustSession {
  constructor(opts = {}) {
    this.token = opts.token ?? null;
    this.input = opts.input ?? (() => ({ yaw: 0, pitch: 0, lean: 0, sway: 0 }));
    this.resolvePass = opts.resolvePass ?? null;
    this.on = Object.assign({
      state() {}, presence() {}, armed() {}, charge() {}, rider() {}, contact() {}, result() {}, over() {}, error() {},
    }, opts.on ?? {});
    this._fetch = opts.fetchFn ?? ((...a) => fetch(...a));
    this._timers = opts.timers ?? { setTimeout, clearTimeout, setInterval, clearInterval };
    this._liveFactory = opts.liveFactory ?? ((o) => new LiveLink({ channel: CHANNEL, ...o }));
    this.clock = new ServerClock({ nowFn: opts.nowFn });

    this.seat = null;
    this.name = null;
    this.match = null;
    this.seats = [];
    this.liveSeats = new Set();
    this.timing = { countdownMs: 3000, contactS: 3.0, graceMs: 5000, tickHz: 20, maxSamples: 160 };
    this.phase = 'idle';
    this.pass = null;            // the open pass, as the server describes it
    this.trace = [];             // our samples for the open pass
    this.posted = false;         // our trace has been posted for this.pass
    this.wantReady = false;
    this.drunk = 0;
    this.active = false;
    this.connected = false;
    this.live = null;

    this._lastPass = -1;         // highest pass_no we have absorbed a result for
    this._delivered = new Map(); // passNo -> { result, source }
    this._peerTraces = new Map();// passNo -> trace
    this._seenPeer = new SeenIds();
    this._pollTimer = null;
    this._beat = null;
    this._tick = null;
    this._busy = false;
  }

  get theirSeat() { return this.seat === null ? null : 1 - this.seat; }
  get myTurn() { return false; }   // both ride at once; kept for HUD code shared with darts

  /* ---------------- lifecycle ---------------- */

  async join(spec, { newMatch = false } = {}) {
    const r = await this._post('/api/joust/join', { spec, newMatch, drunk: this.drunk });
    if (!r?.ok) { this.on.error(r?.error ?? 'join-failed'); return null; }
    this.seat = r.seat;
    this.name = r.name;
    this.connected = true;
    this.active = true;
    this._absorb(r);
    this._schedule();
    this._beat = this._timers.setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    this.live?.stop();
    this.live = this._liveFactory({
      seat: this.seat,
      on: { rider: (p) => this._onRider(p), trace: (p) => this._onPeerTrace(p) },
      rate: { rider: 45 },
      onPresence: (s) => { this.liveSeats = s; this.on.presence(s); },
    });
    this.live.connect();
    return r;
  }

  stop() {
    this.active = false;
    this.connected = false;
    this._timers.clearTimeout(this._pollTimer);
    this._timers.clearInterval(this._beat);
    this._timers.clearInterval(this._tick);
    this._pollTimer = this._beat = this._tick = null;
    this.live?.stop();
    this.live = null;
  }

  /** I am ready for the next pass. Safe to call any time; re-sent after a pass closes. */
  async ready() {
    if (!this.active || this.phase === 'over') return null;
    this.wantReady = true;
    const r = await this._post('/api/joust/ready', {});
    if (!r?.ok) { this.on.error(r?.error ?? 'ready-failed'); return null; }
    if (r.pass) this._arm(r.pass);
    this._schedule();
    return r;
  }

  async heartbeat() {
    const r = await this._post('/api/joust/presence', { drunk: this.drunk });
    if (r?.ok) { this.seats = r.seats; this.on.state(this._view()); }
  }

  async poll() {
    if (this._busy || !this.active) return;
    this._busy = true;
    try {
      const url = `/api/joust/state?since=${this._lastPass}${this.token ? `&t=${encodeURIComponent(this.token)}` : ''}`;
      const t0 = this._now();
      const res = await this._fetch(url, { cache: 'no-store' });
      const r = await res.json();
      if (r?.ok) { this.connected = true; if (Number.isFinite(r.now)) this.clock.sync(r.now, this._now() - t0); this._absorb(r); }
    } catch {
      this.connected = false;
    } finally {
      this._busy = false;
      this._schedule();
    }
  }

  /* ---------------- server state ---------------- */

  _absorb(r) {
    if (r.timing) this.timing = r.timing;
    if (r.seats) this.seats = r.seats;
    if (r.match) this.match = r.match;
    for (const p of r.passes ?? []) {
      if (p.result && p.pass_no > this._lastPass) {
        this._lastPass = p.pass_no;
        this._deliver(p.result, 'server');
      }
    }
    if (r.open && (!this.pass || this.pass.pass_no !== r.open.pass_no) && !this._delivered.has(r.open.pass_no)) {
      this._arm(r.open);
    }
    if (this.match?.winner !== null && this.match?.winner !== undefined && this.phase !== 'over') {
      this.phase = 'over';
      this._stopTick();
      this.on.over(this.match);
    }
    this.on.state(this._view());
  }

  _view() {
    return { match: this.match, seats: this.seats, seat: this.seat, phase: this.phase, pass: this.pass, connected: this.connected };
  }

  /* ---------------- the pass ---------------- */

  _arm(pass) {
    if (this.phase === 'over') return;
    this.pass = pass;
    this.trace = [];
    this.posted = false;
    this.wantReady = false;
    this.phase = 'armed';
    this.on.armed(pass);
    this._startTick();
    this._schedule();
  }

  _startTick() {
    this._stopTick();
    this._tick = this._timers.setInterval(() => this._onTick(), Math.round(1000 / (this.timing.tickHz || 20)));
  }
  _stopTick() { this._timers.clearInterval(this._tick); this._tick = null; }

  _onTick() {
    const pass = this.pass;
    if (!pass) { this._stopTick(); return; }
    const t = -this.clock.until(pass.starts_at);          // seconds since T0, negative during the countdown
    if (this.phase === 'armed') {
      if (t < 0) return;
      this.phase = 'charging';
      this.on.charge(pass);
    }
    if (this.phase !== 'charging') return;
    const s = this.input() ?? {};
    const sample = {
      t: Math.max(0, Math.round(t * 1000) / 1000),
      yaw: clamp(s.yaw, -1.5, 1.5), pitch: clamp(s.pitch, -1.5, 1.5), lean: clamp(s.lean, -1, 1), sway: clamp(s.sway ?? 0, -1, 1),
    };
    if (this.trace.length < this.timing.maxSamples) this.trace.push(sample);
    this.live?.send('rider', { passNo: pass.pass_no, ...sample });
    if (t >= this.timing.contactS) this._contact();
  }

  async _contact() {
    if (this.posted) return;
    this.posted = true;
    this.phase = 'contact';
    this._stopTick();
    const pass = this.pass;
    if (!this.trace.length) this.trace.push({ t: 0, yaw: 0, pitch: 0, lean: 0, sway: 0 });
    this.on.contact(pass);
    // hand the other seat our trace first: their verdict is one packet away
    this.live?.send('trace', { passNo: pass.pass_no, trace: this.trace });
    this._tryPeerVerdict(pass.pass_no);
    const r = await this._post('/api/joust/trace', { pass_no: pass.pass_no, trace: this.trace, drunk: this.drunk });
    if (!r?.ok) { this.on.error(r?.error ?? 'trace-failed'); this.poll(); return; }
    if (r.match) this.match = r.match;
    if (r.result) { this._lastPass = Math.max(this._lastPass, pass.pass_no); this._deliver(r.result, 'server'); }
    this._schedule();
  }

  _onRider(p) {
    if (p.seat !== this.theirSeat || !this.pass || p.passNo !== this.pass.pass_no) return;
    this.on.rider(p);
  }

  _onPeerTrace(p) {
    if (p.seat !== this.theirSeat || !Array.isArray(p.trace) || !Number.isInteger(p.passNo)) return;
    if (!this._seenPeer.fresh(`${p.seat}:${p.passNo}`)) return;
    this._peerTraces.set(p.passNo, p.trace);
    this._tryPeerVerdict(p.passNo);
  }

  /** Both traces in hand and a resolver: the verdict now, the server's later. */
  _tryPeerVerdict(passNo) {
    if (!this.resolvePass || !this.pass || this.pass.pass_no !== passNo || !this.posted) return;
    const theirs = this._peerTraces.get(passNo);
    if (!theirs || this._delivered.has(passNo)) return;
    const [a, b] = this.seat === 0 ? [this.trace, theirs] : [theirs, this.trace];
    let verdict;
    try { verdict = this.resolvePass(a, b, this.pass.seed); } catch { return; }
    if (verdict) this._deliver({ ...verdict, passNo }, 'peer');
  }

  _deliver(result, source) {
    const passNo = result.passNo;
    const prev = this._delivered.get(passNo);
    if (!prev) {
      this._delivered.set(passNo, { result, source });
      this.on.result(result, { source, corrected: false });
    } else if (source === 'server' && prev.source === 'peer') {
      this._delivered.set(passNo, { result, source });
      if (!same(prev.result, result)) this.on.result(result, { source, corrected: true });
    }
    if (source === 'server' && this.pass && this.pass.pass_no === passNo) {
      this.pass = null;
      this._stopTick();
      if (this.phase !== 'over') this.phase = 'idle';
      this._peerTraces.delete(passNo);
      if (this.wantReady && this.phase !== 'over') this.ready();
    }
  }

  /* ---------------- plumbing ---------------- */

  _schedule() {
    if (!this.active) return;
    this._timers.clearTimeout(this._pollTimer);
    const hot = !!this.pass || this.wantReady;
    this._pollTimer = this._timers.setTimeout(() => this.poll(), hot ? ACTIVE_MS : IDLE_MS);
  }

  _now() { return this.clock._now(); }

  async _post(path, body) {
    try {
      const t0 = this._now();
      const res = await this._fetch(path, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: this.token, ...body }),
      });
      const r = await res.json();
      if (r && Number.isFinite(r.now)) this.clock.sync(r.now, this._now() - t0);
      return r;
    } catch {
      this.connected = false;
      return null;
    }
  }
}

const clamp = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);

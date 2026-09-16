import { ServerClock, readToken } from '../../../shared/net/live.js';

/**
 * Online jousting against the other seat.
 *
 * Same shape as darts' OnlineSession — polling, because the authoritative
 * tier is token-gated HTTP over an append-only log — with the one difference
 * jousting forces: both riders act at the same moment, so every reply carries
 * the server's `now` and feeds a ServerClock. The countdown, the charge and
 * the contact instant are all read off that clock, never off Date.now().
 *
 * The wire unit is a *trace*: this seat's packed 60 Hz input log for one pass
 * ([leanX, leanY, aimX, aimY, flags] per tick, spec.js packInput). The server
 * re-simulates both traces with the same pass.js the browser previews with.
 */

const IDLE_MS = 3500;       // nobody is ready, nothing is armed
const ACTIVE_MS = 650;      // a pass is armed, running, or waiting on their trace
const HEARTBEAT_MS = 6000;

export class JoustSession {
  constructor(opts = {}) {
    this.token = opts.token ?? null;
    this.onState = opts.onState ?? (() => {});
    this.onPassArmed = opts.onPassArmed ?? (() => {});
    this.onPassResolved = opts.onPassResolved ?? (() => {});
    this.onError = opts.onError ?? (() => {});

    this.clock = new ServerClock();
    this.seat = null;
    this.name = null;
    this.seats = [];
    this.match = null;
    this.open = null;           // {pass_no, seed, starts_at} while unresolved
    this.version = -1;
    this.lastPass = -1;         // highest resolved pass_no seen
    this.connected = false;
    this.active = false;
    this.pending = 0;           // traces posted but not acknowledged
    this.awaiting = false;      // our trace is in, theirs is not
    this._armed = -1;           // pass_no already announced to the shell
    this._timer = null;
    this._beat = null;
    this._busy = false;
  }

  get theirSeat() { return this.seat === null ? null : 1 - this.seat; }
  /** Seconds until the charge starts; negative once it has. */
  get countdown() { return this.open ? this.clock.until(this.open.starts_at) : null; }

  async join(spec, { newMatch = false } = {}) {
    const r = await this._post('/api/joust/join', { spec, newMatch, drunk: 0 });
    if (!r?.ok) { this.onError(r?.error ?? 'join-failed'); return null; }
    this.seat = r.seat;
    this.name = r.name;
    this.connected = true;
    this.active = true;
    this._absorb(r, { replayAll: true });
    this._schedule();
    this._beat = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
    return r;
  }

  stop() {
    this.active = false;
    clearTimeout(this._timer);
    clearInterval(this._beat);
    this._timer = this._beat = null;
    this.connected = false;
  }

  /** Say we are in the saddle. The pass arms when the other seat agrees. */
  async ready() {
    const r = await this._post('/api/joust/ready', {});
    if (!r?.ok) { this.onError(r?.error ?? 'ready-failed'); return null; }
    this._absorb(r);
    this._schedule();
    return r;
  }

  /**
   * Post this seat's finished trace for a pass. The reply is authoritative:
   * either the resolved pass, or `waiting` on the other rider.
   */
  async submitTrace(passNo, log, drunk = 0) {
    this.pending++;
    const r = await this._post('/api/joust/trace', { pass_no: passNo, trace: log, drunk });
    this.pending--;
    if (!r?.ok) {
      this.onError(r?.error ?? 'trace-failed');
      this.poll();                       // resync; our idea of the pass was stale
      return null;
    }
    this.awaiting = !r.result;
    if (r.result) this._resolved({ pass_no: passNo, result: r.result }, r.match);
    this._schedule();
    return r;
  }

  async heartbeat(drunk = this.drunk ?? 0) {
    const r = await this._post('/api/joust/presence', { drunk });
    if (r?.ok) {
      this.seats = r.seats;
      this._sync(r);
      this.onState(this._view());
    }
  }

  async poll() {
    if (this._busy || !this.active) return;
    this._busy = true;
    const t0 = Date.now();
    try {
      const url = `/api/joust/state?since=${this.lastPass}${this.token ? `&t=${encodeURIComponent(this.token)}` : ''}`;
      const res = await fetch(url, { cache: 'no-store' });
      const r = await res.json();
      if (r?.ok) { this.connected = true; this._absorb(r, { rtt: Date.now() - t0 }); }
    } catch {
      this.connected = false;
    } finally {
      this._busy = false;
      this._schedule();
    }
  }

  _sync(r, rtt = 0) {
    if (Number.isFinite(r?.now)) this.clock.sync(r.now, rtt);
  }

  _view(extra = {}) {
    return {
      match: this.match, seats: this.seats, seat: this.seat,
      open: this.open, passes: this.passes ?? [], ...extra,
    };
  }

  _resolved(row, match) {
    if (match) this.match = match;
    if (row.pass_no > this.lastPass) this.lastPass = row.pass_no;
    this.open = null;
    this.awaiting = false;
    this.onPassResolved(row);
    this.onState(this._view());
  }

  _absorb(r, { replayAll = false, rtt = 0 } = {}) {
    this._sync(r, rtt);
    this.seats = r.seats ?? this.seats;
    this.match = r.match ?? this.match;
    this.version = r.version ?? this.version;
    this.passes = r.passes ?? this.passes ?? [];

    const fresh = [];
    for (const p of r.passes ?? []) {
      if (!p.result || p.pass_no <= this.lastPass) continue;
      this.lastPass = p.pass_no;
      fresh.push(p);
    }

    // `ready` replies carry the armed pass as `pass`; state/join carry `open`
    const open = r.open ?? r.pass ?? null;
    this.open = open && !open.result ? open : null;
    if (this.open && this.open.pass_no !== this._armed) {
      this._armed = this.open.pass_no;
      this.awaiting = false;
      this.onPassArmed(this.open);
    }

    this.onState(this._view({ replayAll }));
    for (const p of fresh) this.onPassResolved(p, { replayAll });
  }

  /** Poll hard while a pass is live or their trace is outstanding. */
  _schedule() {
    if (!this.active) return;
    clearTimeout(this._timer);
    const hot = this.open !== null || this.awaiting || this.pending > 0;
    this._timer = setTimeout(() => this.poll(), hot ? ACTIVE_MS : IDLE_MS);
  }

  async _post(path, body) {
    const t0 = Date.now();
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: this.token, ...body }),
      });
      const r = await res.json();
      this._sync(r, Date.now() - t0);
      return r;
    } catch {
      this.connected = false;
      return null;
    }
  }
}

export { readToken };

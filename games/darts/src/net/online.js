/**
 * Online play against the other seat.
 *
 * Deliberately polling rather than sockets. Darts is turn-based — a visit is
 * three darts over about fifteen seconds — and the deployment this lives in
 * reaches Postgres through a transaction-mode pooler (no LISTEN/NOTIFY) with
 * RLS shut to the anon key, so both of the obvious push routes would mean new
 * infrastructure or reopening a door someone deliberately closed. Instead the
 * poll simply speeds up when it matters. Because the throw log is the source
 * of truth, swapping in SSE later changes nothing above this file.
 */

const IDLE_MS = 3500;      // nothing is happening
const ACTIVE_MS = 650;     // it is their turn and a dart could land any moment
const HEARTBEAT_MS = 6000;

export class OnlineSession {
  constructor(opts = {}) {
    this.token = opts.token ?? null;
    this.onState = opts.onState ?? (() => {});
    this.onThrow = opts.onThrow ?? (() => {});
    this.onError = opts.onError ?? (() => {});

    this.seat = null;
    this.name = null;
    this.seats = [];
    this.version = -1;
    this.lastSeq = -1;
    this.connected = false;
    this.active = false;
    this.pending = 0;          // throws posted but not yet acknowledged
    this._timer = null;
    this._beat = null;
    this._busy = false;
  }

  get myTurn() { return this.seat !== null && this.currentSeat === this.seat; }
  get currentSeat() { return this.match ? this.match.current : null; }

  async join(spec, { newLeg = false } = {}) {
    const r = await this._post('/api/darts/join', { spec, newLeg, drunk: 0 });
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

  /** Send a dart. The reply is authoritative; the local flight is just a view. */
  async submit(launch, drunk = 0) {
    this.pending++;
    const r = await this._post('/api/darts/throw', { launch, drunk });
    this.pending--;
    if (!r?.ok) {
      this.onError(r?.error ?? 'throw-failed');
      this.poll();               // resync — our idea of the turn was probably stale
      return null;
    }
    // our own throw is already on screen; take the authoritative match state
    if (r.match) {
      this.match = r.match;
      this.lastSeq = Math.max(this.lastSeq, r.seq);
      this.onState({ match: r.match, seats: this.seats, seat: this.seat, self: true });
    }
    this._schedule();
    return r;
  }

  async heartbeat(drunk = this.drunk ?? 0) {
    const r = await this._post('/api/darts/presence', { drunk });
    if (r?.ok) { this.seats = r.seats; this.onState({ match: this.match, seats: r.seats, seat: this.seat }); }
  }

  async poll() {
    if (this._busy || !this.active) return;
    this._busy = true;
    try {
      const url = `/api/darts/state?since=${this.lastSeq}${this.token ? `&t=${encodeURIComponent(this.token)}` : ''}`;
      const res = await fetch(url, { cache: 'no-store' });
      const r = await res.json();
      if (r?.ok) { this.connected = true; this._absorb(r); }
    } catch {
      this.connected = false;
    } finally {
      this._busy = false;
      this._schedule();
    }
  }

  _absorb(r, { replayAll = false } = {}) {
    this.seats = r.seats ?? this.seats;
    const fresh = [];
    for (const t of r.throws ?? []) {
      if (t.seq <= this.lastSeq) continue;
      this.lastSeq = t.seq;
      // our own darts already flew locally unless we are rebuilding from scratch
      if (!replayAll && t.seat === this.seat) continue;
      fresh.push(t);
    }
    this.match = r.match ?? this.match;
    this.version = r.version ?? this.version;
    this.onState({ match: this.match, seats: this.seats, seat: this.seat, replayAll });
    for (const t of fresh) this.onThrow(t, { replayAll });
  }

  /** Poll hard while we are waiting on their dart, gently the rest of the time. */
  _schedule() {
    if (!this.active) return;
    clearTimeout(this._timer);
    const waitingOnThem = this.seat !== null && this.currentSeat !== null && this.currentSeat !== this.seat;
    const delay = waitingOnThem || this.pending > 0 ? ACTIVE_MS : IDLE_MS;
    this._timer = setTimeout(() => this.poll(), delay);
  }

  async _post(path, body) {
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: this.token, ...body }),
      });
      return await res.json();
    } catch {
      this.connected = false;
      return null;
    }
  }
}

/** Token comes from ?t= once, then sticks — same convention as tic-tac-toe. */
export function readToken() {
  try {
    const url = new URL(window.location.href);
    const t = url.searchParams.get('t');
    if (t) {
      localStorage.setItem('ttt-token', t);
      url.searchParams.delete('t');
      history.replaceState({}, '', url.pathname + url.search);
      return t;
    }
    return localStorage.getItem('ttt-token');
  } catch {
    return null;
  }
}

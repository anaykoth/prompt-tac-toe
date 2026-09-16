import { RealtimeClient } from '@supabase/realtime-js';

/**
 * Game-agnostic live layer: one Supabase Realtime broadcast channel per game,
 * carrying whatever low-latency spectacle the game needs (a darts aim stream,
 * a jouster's lance and lean at 22 Hz, the instant a dart or a charge leaves
 * the hand) plus presence of the two seats.
 *
 * Same rules as the darts original this was lifted from: the channel is
 * spectacle only. Anything authoritative goes through the token-gated HTTP
 * API and its append-only log; everything here may be lost, duplicated or
 * spoofed and the match stays correct. Publishable key is public by design,
 * the database behind it is RLS-locked shut, and the channel never touches it.
 */
export const RT_URL = 'wss://iibtglstfscurtiqpeuc.supabase.co/realtime/v1';
export const RT_KEY = 'sb_publishable_H6nX-vay6dp5nXVXJ3vp2w__pPHfQ_e';

export class LiveLink {
  /**
   * @param {object} o
   * @param {string} o.channel   unique per game, e.g. 'splinter-alley-live', 'joust-live'
   * @param {number} o.seat      0 or 1; packets from our own seat are ignored
   * @param {Record<string, (payload:any)=>void>} o.on   handlers by event name
   * @param {Record<string, number>} [o.rate]  per-event send ceiling in ms (stream events)
   * @param {(seats:Set<number>)=>void} [o.onPresence]
   */
  constructor({ channel, seat, on = {}, rate = {}, onPresence = () => {} }) {
    if (!channel) throw new Error('LiveLink needs a channel name');
    this.channel = channel;
    this.seat = seat;
    this.on = on;
    this.rate = rate;
    this.onPresence = onPresence;
    this.up = false;
    this._last = new Map();
    this._client = null;
    this._chan = null;
  }

  connect() {
    if (this._client) return;
    this._client = new RealtimeClient(RT_URL, { params: { apikey: RT_KEY } });
    this._wire(this._client.channel(this.channel, {
      config: { broadcast: { self: false }, presence: { key: `seat-${this.seat}` } },
    }));
  }

  /** Split from connect() so tests can drive a fake channel. */
  _wire(chan) {
    this._chan = chan;
    for (const [event, fn] of Object.entries(this.on)) {
      chan.on('broadcast', { event }, ({ payload }) => {
        if (payload && payload.seat !== this.seat) fn(payload);
      });
    }
    chan.on('presence', { event: 'sync' }, () => {
      const seats = new Set();
      for (const metas of Object.values(chan.presenceState?.() ?? {})) {
        for (const m of metas) if (m.seat !== undefined) seats.add(m.seat);
      }
      this.onPresence(seats);
    });
    chan.subscribe((status) => {
      this.up = status === 'SUBSCRIBED';
      if (this.up) chan.track({ seat: this.seat });
    });
  }

  /**
   * Fire-and-forget. Events with a rate ceiling are throttled (a stream: loss
   * is fine, the next packet supersedes); events without one always go out.
   */
  send(event, payload) {
    if (!this.up) return false;
    const cap = this.rate[event];
    if (cap) {
      const now = Date.now();
      if (now - (this._last.get(event) ?? 0) < cap) return false;
      this._last.set(event, now);
    }
    this._chan.send({ type: 'broadcast', event, payload: { seat: this.seat, ...payload } });
    return true;
  }

  stop() {
    this.up = false;
    try { this._client?.disconnect(); } catch { /* already down */ }
    this._client = this._chan = null;
  }
}

/** Remembers ids so the live echo and the poll act on each thing exactly once. */
export class SeenIds {
  constructor(cap = 64) { this.cap = cap; this._set = new Set(); }
  fresh(id) {
    const k = typeof id === 'number' ? id >>> 0 : String(id ?? '');
    if (!k || this._set.has(k)) return false;
    this._set.add(k);
    if (this._set.size > this.cap) this._set.delete(this._set.values().next().value);
    return true;
  }
}

/**
 * Shared wall clock for simultaneous games. Every authoritative API reply
 * carries the server's `now` (ms); feeding it here with the request's round
 * trip keeps an offset so both browsers count the same pass down to the same
 * instant regardless of their own clocks. The lowest-rtt sample of the recent
 * window wins (a cold-started function can take a second to answer and would
 * otherwise skew the estimate by half of that). Darts never needs this;
 * jousting cannot work without it.
 */
export class ServerClock {
  constructor({ nowFn = () => Date.now(), window = 8 } = {}) {
    this._now = nowFn;
    this._window = window;
    this._samples = [];      // { est, rtt }
    this.offset = 0;
    this.samples = 0;
  }
  /** @param {number} serverNow ms  @param {number} rttMs round trip of that request */
  sync(serverNow, rttMs = 0) {
    if (!Number.isFinite(serverNow)) return;
    const rtt = Math.max(0, Number(rttMs) || 0);
    this._samples.push({ est: serverNow + rtt / 2 - this._now(), rtt });
    if (this._samples.length > this._window) this._samples.shift();
    this.offset = this._samples.reduce((b, s) => (s.rtt < b.rtt ? s : b)).est;
    this.samples++;
  }
  now() { return this._now() + this.offset; }
  /** seconds until a server timestamp; negative once it has passed */
  until(serverMs) { return (serverMs - this.now()) / 1000; }
}

/** Token comes from ?t= once, then sticks — the tic-tac-toe convention. */
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

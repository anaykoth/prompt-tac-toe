import { RealtimeClient } from '@supabase/realtime-js';

/**
 * The live layer over the polled OnlineSession: a realtime broadcast channel
 * that streams the thrower's aim while they line up and echoes each launch the
 * moment it leaves the hand, so the other seat watches the throw as it
 * happens instead of on the next poll tick.
 *
 * The channel is spectacle only. Scoring stays with the token-gated HTTP API
 * and the append-only throw log; everything here can be lost, duplicated or
 * spoofed and the match state stays correct — launches are deduped by seed
 * against the polled log (SeenSeeds), and aim ghosts decay when packets stop.
 *
 * Rides the Realtime service of a Supabase project whose publishable key we
 * already ship elsewhere (publishable keys are public by design; the database
 * behind this one is RLS-locked shut, and this channel never touches it).
 */
const RT_URL = 'wss://iibtglstfscurtiqpeuc.supabase.co/realtime/v1';
const RT_KEY = 'sb_publishable_H6nX-vay6dp5nXVXJ3vp2w__pPHfQ_e';
const CHANNEL = 'splinter-alley-live';

export const AIM_MS = 45;            // aim stream ceiling, ~22 packets/s

export class LiveLink {
  constructor({ seat, onAim = () => {}, onLaunch = () => {}, onPresence = () => {} } = {}) {
    this.seat = seat;
    this.onAim = onAim;
    this.onLaunch = onLaunch;
    this.onPresence = onPresence;
    this.up = false;
    this._lastAim = 0;
    this._client = null;
    this._chan = null;
  }

  connect() {
    if (this._client) return;
    this._client = new RealtimeClient(RT_URL, { params: { apikey: RT_KEY } });
    this._wire(this._client.channel(CHANNEL, {
      config: { broadcast: { self: false }, presence: { key: `seat-${this.seat}` } },
    }));
  }

  /** Split from connect() so the test suite can drive a fake channel. */
  _wire(chan) {
    this._chan = chan;
    chan.on('broadcast', { event: 'aim' }, ({ payload }) => {
      if (payload && payload.seat !== this.seat) this.onAim(payload);
    });
    chan.on('broadcast', { event: 'launch' }, ({ payload }) => {
      if (payload && payload.seat !== this.seat) this.onLaunch(payload);
    });
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

  /** Fire-and-forget, throttled. Loss is fine — the next packet supersedes. */
  sendAim(p) {
    const now = Date.now();
    if (!this.up || now - this._lastAim < AIM_MS) return;
    this._lastAim = now;
    this._chan.send({ type: 'broadcast', event: 'aim', payload: { seat: this.seat, ...p } });
  }

  sendLaunch(launch) {
    if (!this.up) return;
    this._chan.send({ type: 'broadcast', event: 'launch', payload: { seat: this.seat, launch } });
  }

  stop() {
    this.up = false;
    try { this._client?.disconnect(); } catch { /* already down */ }
    this._client = this._chan = null;
  }
}

/**
 * Remembers launch seeds so the live echo and the poll fly each dart exactly
 * once, whichever arrives first.
 */
export class SeenSeeds {
  constructor(cap = 64) { this.cap = cap; this._set = new Set(); }
  /** True the first time a seed is offered, false on repeats. */
  fresh(seed) {
    const s = seed >>> 0;
    if (!s || this._set.has(s)) return false;
    this._set.add(s);
    if (this._set.size > this.cap) this._set.delete(this._set.values().next().value);
    return true;
  }
}

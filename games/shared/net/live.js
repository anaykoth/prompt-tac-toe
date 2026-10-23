export class LiveLink {
  /**
   * @param {object} o
   * @param {string} o.channel   unique per game, e.g. 'splinter-alley-live', 'joust-live'
   * @param {number} o.seat      0 or 1; packets from our own seat are ignored
   * @param {Record<string, (payload:any)=>void>} o.on   handlers by event name
   * @param {Record<string, number>} [o.rate]  per-event send ceiling in ms (stream events)
   * @param {(seats:Set<number>)=>void} [o.onPresence]
   */
  constructor({
    channel,
    seat,
    on = {},
    rate = {},
    onPresence = () => {},
    onStatus = () => {},
    token,
    room = readRoom(),
  }) {
    if (!channel) throw new Error('LiveLink needs a channel name');
    this.channel = channel;
    this.token = token;
    this.room = room;
    this.onStatus = onStatus;
    this._generation = 0;
    this.seat = seat;
    this.on = on;
    this.rate = rate;
    this.onPresence = onPresence;
    this.up = false;
    this._last = new Map();
    this._client = null;
    this._chan = null;
  }

  async connect() {
    const generation = ++this._generation;
    this._stopped = false;
    clearTimeout(this._retry);
    clearInterval(this._beat);
    this.up = false;
    this._socket?.close(1000);
    try {
      const res = await fetch('/api/live', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: this.token ?? readToken(),
          room: this.room,
          game: /joust|tilt/.test(this.channel) ? 'joust' : 'darts',
        }),
        signal: AbortSignal.timeout(8000),
      });
      const r = await res.json();
      if (generation !== this._generation) return false;
      if (!r.ok) throw Error(r.error || 'Live connection unavailable');
      return await new Promise((resolve) => {
        const ws = (this._socket = new WebSocket(r.url));
        let joined = false;
        const timeout = setTimeout(() => {
          resolve(false);
          ws.close(4000, 'Join timed out');
        }, 8000);
        ws.onopen = () => ws.send(JSON.stringify({ type: 'join', ticket: r.ticket }));
        ws.onmessage = (event) => {
          if (generation !== this._generation) return;
          let m;
          try {
            m = JSON.parse(event.data);
          } catch {
            return;
          }
          this._lastMessage = performance.now();
          if (m.type === 'joined') {
            clearTimeout(timeout);
            joined = true;
            this.up = true;
            this._retries = 0;
            this._chan = { send: (packet) => ws.send(JSON.stringify(packet)) };
            this.onStatus({ up: true });
            resolve(true);
            clearInterval(this._beat);
            this._beat = setInterval(() => {
              if (performance.now() - this._lastMessage > 5000) ws.close(4000, 'Connection stalled');
              else if (ws.readyState === 1)
                ws.send(JSON.stringify({ type: 'ping', sent: performance.now() }));
            }, 1000);
          } else if (m.type === 'presence') this.onPresence(new Set(m.seats));
          else if (m.type === 'broadcast' && m.payload?.seat !== this.seat) this.on[m.event]?.(m.payload);
          else if (m.type === 'pong') this.onStatus({ up: true, rttMs: performance.now() - m.sent });
        };
        ws.onerror = () => {
          clearTimeout(timeout);
          resolve(false);
        };
        ws.onclose = (e) => {
          clearTimeout(timeout);
          resolve(false);
          if (generation !== this._generation) return;
          clearInterval(this._beat);
          this.up = false;
          this.onPresence(new Set());
          this.onStatus({ up: false, error: e.reason });
          if (![1000, 1008, 4001].includes(e.code)) this._scheduleRetry(generation);
        };
      });
    } catch (e) {
      if (generation === this._generation) {
        this.onStatus({ up: false, error: e.message });
        this._scheduleRetry(generation);
      }
      return false;
    }
  }

  _scheduleRetry(generation) {
    if (this._stopped || generation !== this._generation) return;
    clearTimeout(this._retry);
    const delay = Math.min(4000, 250 * 2 ** (this._retries ?? 0));
    this._retries = (this._retries ?? 0) + 1;
    this._retry = setTimeout(() => this.connect(), delay);
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
    if (!this.up || (this._socket && this._socket.readyState !== 1) || this._socket?.bufferedAmount > 65536)
      return false;
    const cap = this.rate[event];
    if (cap) {
      const now = Date.now();
      if (now - (this._last.get(event) ?? 0) < cap) return false;
      this._last.set(event, now);
    }
    this._chan.send({ type: 'broadcast', event, payload: { ...payload, seat: this.seat } });
    return true;
  }

  stop() {
    this.up = false;
    this._stopped = true;
    this._generation++;
    clearTimeout(this._retry);
    clearInterval(this._beat);
    this._socket?.close(1000);
    this._socket = null;
    try {
      this._client?.disconnect();
    } catch {
      /* already down */
    }
    this._client = this._chan = null;
  }
}

/** Remembers ids so the live echo and the poll act on each thing exactly once. */
export class SeenIds {
  constructor(cap = 64) {
    this.cap = cap;
    this._set = new Set();
  }
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
    this._samples = []; // { est, rtt }
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
  now() {
    return this._now() + this.offset;
  }
  /** seconds until a server timestamp; negative once it has passed */
  until(serverMs) {
    return (serverMs - this.now()) / 1000;
  }
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

export function readRoom() {
  try {
    const room = new URL(window.location.href).searchParams.get('room') || 'live';
    return /^[a-zA-Z0-9_-]{1,48}$/.test(room) ? room : 'live';
  } catch {
    return 'live';
  }
}

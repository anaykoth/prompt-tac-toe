/** Shared lobby connection. Resume only our identity; never fight a newer tab. */
export class RoomClient {
  constructor(endpoint) {
    this.endpoint = endpoint || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
    this.handlers = new Set();
    this.connected = false;
    this.id = null;
    this.room = null;
    this.state = null;
    this.hockey = null;
    this.socket = null;
    this.retry = 0;
    this.stopped = true;
    this.metrics = { rttMs: null, jitterMs: 0, reconnects: 0 };
  }
  on(fn) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }
  emit(m) {
    for (const fn of this.handlers) {
      try {
        fn(m);
      } catch (e) {
        console.error(e);
      }
    }
  }
  connect({ room, name = 'Guest', create = false, matchId = 'main' } = {}) {
    this.close();
    this.stopped = false;
    this.retry = 0;
    const code = String(room || '')
      .trim()
      .toUpperCase();
    let token;
    try {
      token = localStorage.getItem(`muppet-room-token:${code}`);
    } catch {}
    this.hello = { type: 'hello', room: code, name, create: create || !code, token, matchId };
    return this._open();
  }
  _open() {
    return new Promise((resolve, reject) => {
      if (this.stopped) {
        reject(Error('Connection cancelled'));
        return;
      }
      const socket = (this.socket = new WebSocket(this.endpoint));
      let settled = false;
      const finish = (error, message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        error ? reject(error) : resolve(message);
      };
      const timeout = setTimeout(() => {
        finish(Error('The pub server did not answer.'));
        socket.close(4000, 'Join timed out');
      }, 10000);
      this._cancel = () => finish(Error('Connection cancelled'));
      socket.onopen = () => socket.send(JSON.stringify(this.hello));
      socket.onmessage = (event) => {
        if (this.socket !== socket) return;
        let m;
        try {
          m = JSON.parse(event.data);
        } catch {
          return;
        }
        this.lastMessage = performance.now();
        if (m.type === 'welcome') {
          this.id = m.id;
          this.room = m.room;
          this.state = m.state;
          this.connected = true;
          this.retry = 0;
          this.hello = { ...this.hello, room: m.room, token: m.token, create: false };
          try {
            localStorage.setItem(`muppet-room-token:${m.room}`, m.token);
            localStorage.setItem('muppet-room-name', this.hello.name);
          } catch {}
          clearInterval(this.beat);
          this.beat = setInterval(() => {
            if (performance.now() - this.lastMessage > 5000) {
              socket.close(4000, 'Connection stalled');
              return;
            }
            this.send('ping', { sent: performance.now() });
          }, 1000);
          finish(null, m);
        } else if (m.type === 'state') this.state = m;
        else if (m.type === 'hockey.state') {
          this.hockey = m;
          this.hello.matchId = m.matchId;
        } else if (m.type === 'pong' && Number.isFinite(m.sent)) {
          const rtt = Math.max(0, performance.now() - m.sent),
            old = this.metrics.rttMs;
          this.metrics.jitterMs = old === null ? 0 : this.metrics.jitterMs * 0.8 + Math.abs(rtt - old) * 0.2;
          this.metrics.rttMs = rtt;
          this.emit({ type: 'network', ...this.metrics });
        } else if (m.type === 'error' && !settled) {
          this.stopped = true;
          finish(Error(m.message));
          socket.close();
        }
        this.emit(m);
      };
      socket.onerror = () => finish(Error('Cannot reach the pub server.'));
      socket.onclose = (event) => {
        if (this.socket !== socket) return;
        clearInterval(this.beat);
        this.connected = false;
        finish(Error(event.reason || 'Connection closed'));
        const resume = !this.stopped && this.hello.token && ![1000, 4001, 1008].includes(event.code);
        this.emit({ type: 'disconnected', code: event.code, reconnecting: !!resume, message: event.reason });
        if (resume) {
          const delay = Math.min(4000, 250 * 2 ** this.retry++) + Math.random() * 100;
          this.metrics.reconnects++;
          this.retryTimer = setTimeout(() => this._open().catch(() => {}), delay);
        }
      };
    });
  }
  send(type, payload = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.connected || this.socket.bufferedAmount > 65536)
      return false;
    this.socket.send(JSON.stringify({ ...payload, type }));
    return true;
  }
  close() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.beat);
    this._cancel?.();
    this._cancel = null;
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    socket?.close(1000, 'Leaving the room');
  }
}

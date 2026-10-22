/** Shared room connection for the pub and table pages. Balances belong to the server. */
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
  }

  on(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  emit(message) { for (const fn of this.handlers) { try { fn(message); } catch (error) { console.error(error); } } }

  connect({ room, name = 'Guest', create = false } = {}) {
    this.close();
    const code = String(room || '').trim().toUpperCase();
    let token;
    try { token = localStorage.getItem(`muppet-room-token:${code}`); } catch { /* Private browsing may disable storage. */ }
    return new Promise((resolve, reject) => {
      const socket = this.socket = new WebSocket(this.endpoint);
      let settled = false;
      const timeout = setTimeout(() => { socket.close(); finish(new Error('The pub server did not answer. Start npm run server and try again.')); }, 10000);
      const finish = (error, message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error); else resolve(message);
      };
      socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', create: create || !code, room: code, name, token }));
      socket.onmessage = event => {
        if (this.socket !== socket) return;
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'welcome') {
          this.id = message.id;
          this.room = message.room;
          this.state = message.state;
          this.connected = true;
          try {
            localStorage.setItem(`muppet-room-token:${message.room}`, message.token);
            localStorage.setItem('muppet-room-name', name);
          } catch { /* Storage is optional. */ }
          finish(null, message);
        } else if (message.type === 'state') this.state = message;
        else if (message.type === 'hockey.state') this.hockey = message;
        else if (message.type === 'error' && !settled) finish(new Error(message.message));
        this.emit(message);
      };
      socket.onerror = () => finish(new Error('Cannot reach the pub server. Start npm run server, then reconnect.'));
      socket.onclose = event => {
        if (this.socket !== socket) return;
        this.connected = false;
        finish(new Error(event.reason || 'The pub connection closed.'));
        this.emit({ type: 'disconnected', code: event.code, message: event.reason || 'Connection closed. Rejoin to resume your coins.' });
      };
    });
  }

  send(type, payload = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.connected) return false;
    this.socket.send(JSON.stringify({ ...payload, type }));
    return true;
  }

  close() {
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    if (socket) socket.close(1000, 'Leaving the room');
  }
}

/** Phone and display have separate identities, including across reconnects. */
export class PhoneLink {
  constructor(role, onMessage) {
    this.role = role; this.onMessage = onMessage; this.connected = false; this.stopped = false; this.attempt = 0;
    this.timer = setInterval(() => this.send({ type: 'ping', sent: Date.now() }), 2000);
  }
  connect(credentials = {}) {
    this.credentials = credentials; this.stopped = false; this.open();
  }
  open() {
    clearTimeout(this.retry);
    const ws = this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/phone-ws`);
    const timeout = setTimeout(() => ws.close(), 10000);
    ws.onopen = () => ws.send(JSON.stringify({ type: this.role === 'host' ? 'host' : 'join', ...this.credentials }));
    ws.onmessage = event => {
      if (this.ws !== ws) return;
      let packet; try { packet = JSON.parse(event.data); } catch { return; }
      if (packet.type === 'welcome') {
        clearTimeout(timeout); this.connected = true; this.attempt = 0;
        this.credentials = { room: packet.room, token: packet.token };
      }
      if (packet.type === 'error' && !this.connected) { this.stopped = true; ws.close(); }
      if (packet.type === 'pong') packet.latency = Date.now() - packet.sent;
      this.onMessage(packet);
    };
    ws.onerror = () => {};
    ws.onclose = event => {
      clearTimeout(timeout); if (this.ws !== ws) return;
      this.connected = false;
      if (event.code === 4001) this.stopped = true;
      this.onMessage({ type: 'disconnected', message: event.reason || 'Reconnecting…', terminal: this.stopped });
      if (!this.stopped) this.retry = setTimeout(() => this.open(), Math.min(5000, 500 * 2 ** this.attempt++));
    };
  }
  send(packet) {
    if (!this.connected || this.ws.readyState !== WebSocket.OPEN || this.ws.bufferedAmount > 32768) return false;
    this.ws.send(JSON.stringify(packet)); return true;
  }
  close() { this.stopped = true; clearTimeout(this.retry); clearInterval(this.timer); this.ws?.close(); }
}

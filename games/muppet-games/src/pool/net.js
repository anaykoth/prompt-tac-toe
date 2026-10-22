/**
 * The seam for online play.
 *
 * The sim is deterministic and the whole game state is reachable from
 * (rack seed, ordered list of shots), so a match only ever needs to send a
 * handful of floats per turn — never ball positions. Today the only transport
 * is the local one, which loops messages straight back; a websocket transport
 * implements the same three methods and nothing above it changes.
 */

export const PROTOCOL = 1;

/** Everything needed to reproduce a shot exactly, on any machine. */
export function encodeShot(shot) {
  return {
    t: 'shot',
    yaw: +shot.yaw.toFixed(6),
    speed: +shot.speed.toFixed(6),
    tipX: +shot.tipX.toFixed(6),
    tipY: +shot.tipY.toFixed(6),
    elev: +(shot.elevation ?? 0).toFixed(6),
  };
}

export const decodeShot = (m) => ({
  yaw: m.yaw, speed: m.speed, tipX: m.tipX, tipY: m.tipY, elevation: m.elev,
});

export const encodePlacement = (x, z) => ({ t: 'place', x: +x.toFixed(6), z: +z.toFixed(6) });

/** Chaos is seeded, so the crowd's crimes replay identically on both clients. */
export const encodeRack = (seed, breaker) => ({ t: 'rack', seed, breaker, protocol: PROTOCOL });

class Transport {
  constructor() { this.handlers = new Set(); }
  on(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  _emit(msg) { for (const h of this.handlers) h(msg); }
  send() { throw new Error('not implemented'); }
  close() {}
}

/** Hot-seat: both seats are this machine, so a send is just a local dispatch. */
export class LocalTransport extends Transport {
  constructor() {
    super();
    this.seat = 0;
    this.online = false;
  }

  send(msg) {
    // queued to the next task so local play has the same async shape as the wire
    Promise.resolve().then(() => this._emit({ ...msg, seat: this.seat }));
  }
}

/**
 * Sketch of the online transport. Kept here so the shape is committed to:
 * the server is authoritative over the shot list, not over the physics.
 *
 *   const net = new SocketTransport('wss://…/table/AB12');
 *   net.on((msg) => game.applyRemote(msg));
 *   net.send(encodeShot(shot));
 */
export class SocketTransport extends Transport {
  constructor(url) {
    super();
    this.online = true;
    this.seat = -1;
    this.queue = [];
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      for (const m of this.queue) this.ws.send(JSON.stringify(m));
      this.queue.length = 0;
    };
    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'seat') { this.seat = msg.seat; return; }
      this._emit(msg);
    };
  }

  send(msg) {
    const packet = { ...msg, seat: this.seat };
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(packet));
    else this.queue.push(packet);
  }

  close() { this.ws.close(); }
}

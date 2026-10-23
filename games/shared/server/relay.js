import { verifyTicket } from './tickets.js';

/** Authenticated game traffic on the persistent game host. Tickets are minted
 * by Next; no player token or unrelated service credential reaches the relay. */
export function attachRelay(wss, { secret = process.env.GAME_LIVE_SECRET } = {}) {
  const rooms = new Map();
  const send = (ws, m) => {
    if (ws.readyState === 1) {
      if (ws.bufferedAmount > 65536) {
        ws.close(1013, 'Slow connection');
        return;
      }
      ws.send(JSON.stringify(m));
    }
  };
  const presence = (room) => {
    for (const ws of room.values()) send(ws, { type: 'presence', seats: [...room.keys()] });
  };
  wss.on('connection', (ws) => {
    let room,
      key,
      seat,
      window = Date.now(),
      count = 0;
    const timeout = setTimeout(() => ws.close(1008, 'Join required'), 5000);
    ws.alive = true;
    ws.on('pong', () => {
      ws.alive = true;
    });
    ws.on('message', (raw) => {
      try {
        if (Date.now() - window >= 1000) {
          window = Date.now();
          count = 0;
        }
        if (++count > 90) throw Error('Rate limit');
        const m = JSON.parse(raw);
        if (!room) {
          const p = verifyTicket(m.ticket, secret);
          if (m.type !== 'join' || !p) throw Error('Invalid ticket');
          key = `${p.game}:${p.room}`;
          seat = p.seat;
          if (!rooms.has(key)) {
            if (rooms.size >= 1000) throw Error('Server full');
            rooms.set(key, new Map());
          }
          room = rooms.get(key);
          const old = room.get(seat);
          room.set(seat, ws);
          old?.close(4001, 'Seat opened elsewhere');
          clearTimeout(timeout);
          send(ws, { type: 'joined', seat });
          presence(room);
          return;
        }
        if (room.get(seat) !== ws) return;
        if (m.type === 'ping') {
          send(ws, { type: 'pong', sent: m.sent });
          return;
        }
        const allowed = key.startsWith('darts:') ? ['aim', 'launch', 'changed'] : ['ticks', 'ready', 'ended'];
        if (
          m.type !== 'broadcast' ||
          !allowed.includes(m.event) ||
          !m.payload ||
          typeof m.payload !== 'object'
        )
          throw Error('Invalid event');
        if (m.event === 'ticks' && (!Array.isArray(m.payload.ticks) || m.payload.ticks.length > 542))
          throw Error('Invalid ticks');
        for (const other of room.values())
          if (other !== ws)
            send(other, { type: 'broadcast', event: m.event, payload: { ...m.payload, seat } });
      } catch {
        ws.close(1008, 'Invalid game traffic');
      }
    });
    ws.on('close', () => {
      clearTimeout(timeout);
      if (room?.get(seat) === ws) {
        room.delete(seat);
        presence(room);
        if (!room.size) rooms.delete(key);
      }
    });
    ws.on('error', () => {});
  });
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) ws.terminate();
      else {
        ws.alive = false;
        ws.ping();
      }
    }
  }, 2500);
  return () => {
    clearInterval(beat);
    for (const ws of wss.clients) ws.terminate();
  };
}

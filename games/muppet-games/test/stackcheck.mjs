import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createPubServer } from '../server/index.js';
import { RoomClient } from '../src/room/client.js';
import { LiveLink } from '../../shared/net/live.js';
import { signTicket } from '../../shared/server/tickets.js';
process.env.GAME_LIVE_SECRET = 'isolated-test-secret-with-at-least-32-characters';
const server = createPubServer({ port: 0, ledgerPath: null, reconnectGraceMs: 1000 });
const address = await server.listen(),
  base = `ws://127.0.0.1:${address.port}`;
const clients = [],
  apps = [],
  links = [];
const originalFetch = globalThis.fetch;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function connect(path = '/ws') {
  const ws = new WebSocket(base + path),
    messages = [];
  clients.push(ws);
  ws.on('message', (d) => messages.push(JSON.parse(d)));
  await new Promise((r, j) => {
    ws.once('open', r);
    ws.once('error', j);
  });
  return {
    ws,
    messages,
    send: (type, p = {}) => ws.send(JSON.stringify({ type, ...p })),
    async wait(type, pred = () => true) {
      const start = Date.now();
      while (Date.now() - start < 2500) {
        const m = messages.find((m) => m.type === type && pred(m));
        if (m) return m;
        await sleep(5);
      }
      throw Error(`Timeout ${type}`);
    },
    async act(type, p, reply, pred) {
      messages.length = 0;
      this.send(type, p);
      return this.wait(reply, pred);
    },
  };
}
async function player(hello) {
  const c = await connect();
  c.welcome = await c.act('hello', hello, 'welcome');
  c.id = c.welcome.id;
  return c;
}
try {
  const a = await player({ create: true, name: 'A' }),
    room = a.welcome.room;
  const b = await player({ room, name: 'B' }),
    c = await player({ room, name: 'C' }),
    d = await player({ room, name: 'D' }),
    spectator = await player({ room, name: 'Spectator' });
  const created = await a.act('match.create', { teamSize: 2 }, 'match.created');
  const matchId = created.matchId;
  for (const p of [a, b, c, d, spectator]) await p.act('match.watch', { matchId }, 'hockey.state');
  let state;
  for (const [seat, p] of [a, b, c, d].entries())
    state = await p.act('hockey.join', { seat }, 'hockey.state', (m) => m.seats[seat] === p.id);
  assert.equal(state.state.mallets.length, 4);
  assert.equal(state.playing, true);
  const epoch = state.epoch;
  const e = await player({ room, name: 'Elsewhere' });
  e.messages.length = 0;
  for (const [seat, p] of [a, b, c, d].entries()) {
    const own = p.messages.filter((m) => m.type === 'hockey.state').at(-1) ?? (await p.wait('hockey.state'));
    p.send('hockey.input', {
      epoch,
      inputEpoch: own.inputEpoch,
      commands: Array.from({ length: 6 }, (_, i) => ({
        seq: i + 1,
        x: seat < 2 ? -0.5 : 0.5,
        y: seat % 2 ? -1.2 : 1.2,
      })),
    });
  }
  const advanced = await a.wait('hockey.state', (m) => m.acks.every((a) => a.seq === 6));
  assert.equal(advanced.acks.length, 4);
  assert.equal(
    e.messages.some((m) => m.matchId === matchId),
    false,
    'unrelated table receives no gameplay',
  );
  const attack = await spectator.act('hockey.input', { commands: [{ seq: 1, x: 0, y: 1 }] }, 'error');
  assert.match(attack.message, /seat/);
  c.ws.terminate();
  await sleep(50);
  const paused = await a.wait('hockey.state', (m) => !m.playing && m.epoch === epoch);
  assert.equal(paused.seats[2], c.id);
  // Commands already in flight when another player disconnects must survive
  // the pause, or their sequence gap would lock out this player's next input.
  a.send('hockey.input', {
    epoch, inputEpoch: paused.inputEpoch,
    commands: [{seq: 7, x: .2, y: 1}, {seq: 8, x: .3, y: 1}],
  });
  const resumed = await player({ room, token: c.welcome.token });
  const resumedState = await resumed.wait('hockey.state');
  assert.equal(resumedState.seats[2], c.id);
  assert.equal(resumedState.epoch, epoch);
  assert.equal(resumedState.playing, true);
  assert.equal(resumedState.acks[2].seq, 0);
  await a.wait('hockey.state', m => m.acks[0].seq === 8);
  const other = await player({ create: true, name: 'Other room' });
  assert.notEqual(other.welcome.room, room);
  assert.equal(
    other.messages.some((m) => m.matchId === matchId),
    false,
  );
  async function relay(game, room, seat) {
    const p = await connect('/live');
    p.send('join', { ticket: signTicket({ game, room, seat }, process.env.GAME_LIVE_SECRET) });
    await p.wait('joined');
    return p;
  }
  const r0 = await relay('joust', 'one', 0),
    r1 = await relay('joust', 'one', 1),
    r2 = await relay('joust', 'two', 1),
    r3 = await relay('darts', 'one', 1);
  for (const r of [r0, r1, r2, r3]) r.messages.length = 0;
  r0.send('broadcast', {
    event: 'ticks',
    payload: { seat: 1, pass: 's', from: 0, ticks: [[0, 0, 0, 0, 0]] },
  });
  const event = await r1.wait('broadcast');
  assert.equal(event.payload.seat, 0, 'cannot spoof a seat');
  await sleep(50);
  assert.equal(
    r2.messages.some((m) => m.type === 'broadcast'),
    false,
  );
  assert.equal(
    r3.messages.some((m) => m.type === 'broadcast'),
    false,
  );
  const bad = await connect('/live');
  const closed = new Promise((r) => bad.ws.once('close', r));
  bad.send('join', { ticket: 'invalid' });
  assert.equal(await closed, 1008);
  // Run the actual browser connection class over real sockets, with isolated storage.
  globalThis.WebSocket = WebSocket;
  const storage = new Map();
  globalThis.localStorage = { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) };
  const app = new RoomClient(base + '/ws');
  apps.push(app);
  await app.connect({ create: true, name: 'Reconnect client' });
  const identity = app.id;
  app.socket.terminate();
  await sleep(900);
  assert.equal(app.connected, true);
  assert.equal(app.id, identity);
  assert.ok(app.metrics.reconnects >= 1);
  const takeover = new RoomClient(base + '/ws');
  apps.push(takeover);
  await takeover.connect({ room: app.room, name: 'New tab' });
  await sleep(600);
  assert.equal(takeover.id, identity);
  assert.equal(app.connected, false);
  assert.equal(app.retry, 0, 'replaced tab does not fight for the seat');
  // Exercise the real ticket/connect/reconnect path, including a failed renewal.
  let renewals = 0,
    failedRenewals = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/live');
    renewals++;
    if (failedRenewals) {
      failedRenewals--;
      throw Error('Temporary ticket outage');
    }
    const p = JSON.parse(init.body);
    return {
      json: async () => ({
        ok: true,
        url: base + '/live',
        ticket: signTicket(
          { game: p.game, room: p.room, seat: Number(p.token) },
          process.env.GAME_LIVE_SECRET,
        ),
      }),
    };
  };
  const delivered = [],
    statuses = [];
  const left = new LiveLink({
    channel: 'joust-live',
    room: 'client-test',
    seat: 0,
    token: '0',
    onStatus: (s) => statuses.push(s),
  });
  const right = new LiveLink({
    channel: 'joust-live',
    room: 'client-test',
    seat: 1,
    token: '1',
    on: { ticks: (p) => delivered.push(p) },
  });
  links.push(left, right);
  assert.equal(await left.connect(), true);
  assert.equal(await right.connect(), true);
  left.send('ticks', { pass: 'client', from: 0, ticks: [[0, 0, 0, 0, 0]] });
  await sleep(50);
  assert.equal(delivered.length, 1);
  failedRenewals = 1;
  left._socket.terminate();
  const reconnectDeadline = Date.now() + 2500;
  while ((!left.up || renewals < 4) && Date.now() < reconnectDeadline) await sleep(20);
  assert.equal(left.up, true, 'ticket outages must not permanently stop reconnects');
  assert.ok(renewals >= 4);
  left.send('ticks', { pass: 'client', from: 1, ticks: [[0, 0, 0, 0, 0]] });
  await sleep(50);
  assert.equal(delivered.length, 2);
  failedRenewals = 1;
  left._socket.terminate();
  await sleep(25);
  left.stop();
  const stoppedAt = renewals;
  await sleep(600);
  assert.equal(renewals, stoppedAt, 'leaving cancels ticket renewal');
  right.stop();
  globalThis.fetch = originalFetch;
  const crowd = [await player({ create: true, name: 'Load 0' })];
  for (let i = 1; i < 24; i++) crowd.push(await player({ room: crowd[0].welcome.room, name: `Load ${i}` }));
  for (let n = 0; n < 3; n++) {
    const created = await crowd[n * 8].act('match.create', { teamSize: 4 }, 'match.created');
    for (let j = 0; j < 8; j++) {
      const p = crowd[n * 8 + j];
      await p.act('match.watch', { matchId: created.matchId }, 'hockey.state');
      await p.act('hockey.join', { seat: j }, 'hockey.state', (m) => m.seats[j] === p.id);
    }
  }
  const intervals = [],
    arrival = new Map(),
    seqs = crowd.map(() => 0);
  for (const p of crowd) {
    p.messages.length = 0;
    p.ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type === 'hockey.state') {
        const now = performance.now(),
          before = arrival.get(p);
        if (before) intervals.push(now - before);
        arrival.set(p, now);
      }
    });
  }
  const timer = setInterval(
    () =>
      crowd.forEach((p, i) => {
        const st = p.messages.filter((m) => m.type === 'hockey.state').at(-1);
        if (st)
          p.send('hockey.input', {
            epoch: st.epoch,
            inputEpoch: st.inputEpoch,
            commands: [{ seq: ++seqs[i], x: Math.sin(seqs[i] / 20) * 0.6, y: i % 2 ? -1 : 1 }],
          });
      }),
    1000 / 60,
  );
  await sleep(1800);
  clearInterval(timer);
  for (const p of crowd) {
    const packets = p.messages.filter((m) => m.type === 'hockey.state');
    assert.ok(packets.length > 30);
    assert.ok(packets.at(-1).tick - packets[0].tick > 170);
    assert.equal(new Set(packets.map((m) => m.matchId)).size, 1);
    assert.equal(
      p.messages.some((m) => m.type === 'error'),
      false,
    );
  }
  intervals.sort((a, b) => a - b);
  console.log(
    `24 clients / three 4v4 matches: p95 snapshot interval ${intervals[Math.floor(intervals.length * 0.95)].toFixed(1)}ms (target 40ms)`,
  );
  console.log(
    'stackcheck passed: 2v2, acknowledgements, spectators, isolated tables/lobbies, disconnect/resume, authenticated isolated relay',
  );
} finally {
  globalThis.fetch = originalFetch;
  for (const link of links) link.stop();
  for (const app of apps) app.close();
  for (const ws of clients) ws.terminate();
  await server.close();
}

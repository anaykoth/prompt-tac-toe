import assert from 'node:assert/strict';
import { createHockeyState, stepHockey } from '../src/air-hockey/physics.js';
import { HockeyNetwork } from '../src/air-hockey/network.js';
import { InputQueue } from '../../shared/net/inputs.js';
import { matchRoster } from '../../shared/matches.js';
const clone = (x) => structuredClone(x);
const p95 = (a) => a.sort((x, y) => x - y)[Math.floor(a.length * 0.95)];
for (const rtt of [0, 50, 100, 200]) {
  let now = 0,
    server = createHockeyState(),
    q = new InputQueue(),
    net = new HockeyNetwork({ now: () => now });
  let nextFrame = 0,
    nextTick = 0,
    nextSend = 0,
    lastSend = -100,
    tick = 0,
    wire = [],
    lastInputAt = 0,
    lastSnapshotAt = 0;
  let sentFrames = 0,
    corrections = [],
    displaySteps = [],
    previousX = null;
  let target = { x: 0, y: 1.25 };
  function snapshot() {
    return {
      state: clone(server),
      tick,
      epoch: 'match',
      inputEpoch: 'connection',
      playing: true,
      acks: [q.snapshot(), { seq: 0, half: 0 }],
    };
  }
  net.absorb(snapshot(), 0);
  for (now = 0; now < 6000; now++) {
    const due = wire.filter((p) => p.at <= now);
    wire = wire.filter((p) => p.at > now);
    for (const p of due)
      if (p.commands) q.push(p.commands);
      else {
        net.absorb(p.snapshot, 0);
        if (now > 1000) corrections.push(net.metrics.correctionCm);
      }
    if (now >= nextTick) {
      const t = q.target(target);
      stepHockey(server, [t, { x: 0, y: -1.25 }], 1 / 120);
      target = t;
      q.stepped();
      tick++;
      nextTick += 1000 / 120;
    }
    if (now >= nextSend) {
      nextSend += 40;
      // 20ms variable delay, ordered transport, 5% skipped snapshots.
      const jitter = (Math.sin(now * 0.019) + 1) * 10;
      lastSnapshotAt = Math.max(lastSnapshotAt + 1, now + rtt / 2 + jitter);
      if (tick % 19 !== 0) wire.push({ at: lastSnapshotAt, snapshot: snapshot() });
    }
    if (now >= nextFrame) {
      const shown = net.advance(1 / 60, { x: 0.65 * Math.sin(now * 0.002 * Math.PI), y: 1.25 });
      if (previousX !== null && now > 1000) displaySteps.push(Math.abs(shown.mallets[0].x - previousX) * 100);
      previousX = shown.mallets[0].x;
      nextFrame += 1000 / 60;
      if (now - lastSend > 25) {
        const commands = clone(net.batch());
        if (commands.length) {
          lastInputAt = Math.max(lastInputAt + 1, now + rtt / 2 + 10 * (1 + Math.sin(now * 0.013)));
          wire.push({ at: lastInputAt, commands });
          net.markSent(commands);
          sentFrames += commands.length;
        }
        lastSend = now;
      }
      assert.deepEqual(shown.score, net.state.score, 'prediction never invents score');
    }
  }
  assert.ok(sentFrames > 300);
  assert.ok(net.pending.length < 25, 'acknowledgements bound pending history');
  assert.ok(p95(corrections) < 1, 'replay removes stale-snapshot correction');
  assert.ok(p95(displaySteps) < 9, 'no abrupt backwards snapshot teleport');
  console.log(
    `hockey ${rtt}ms RTT + jitter: p95 reconciliation ${p95(corrections).toFixed(1)}cm; frame motion ${p95(displaySteps).toFixed(1)}cm`,
  );
  const count = net.seq;
  now += 1000;
  net.advance(0.1, { x: 0, y: 1 });
  assert.equal(net.seq, count, 'stalled input freezes');
  net.absorb({ ...snapshot(), epoch: 'rematch' }, 0);
  assert.equal(net.pending.length, 0);
  assert.equal(net.seq, 0);
}
const q = new InputQueue();
assert.throws(() => q.push([{ seq: 2, x: 0, y: 1 }]));
q.push([{ seq: 1, x: 0, y: 1 }]);
q.push([{ seq: 1, x: 0, y: 1 }]);
assert.equal(q.queue.length, 1);
q.stepped();
assert.deepEqual(q.snapshot(), { seq: 0, half: 1 });
q.stepped();
assert.equal(q.ack, 1);
for (const size of [1, 2, 3, 4]) {
  const s = createHockeyState(undefined, size);
  assert.equal(s.mallets.length, size * 2);
  stepHockey(
    s,
    s.mallets.map((_, i) => ({ x: 100, y: i % 2 ? -100 : 100 })),
    0.1,
  );
  assert.ok(s.mallets.every((m, i) => (i % 2 ? m.y < 0 : m.y > 0)));
}
assert.equal(matchRoster([4, 4, 4]).length, 12);
assert.throws(() => matchRoster([9, 9]));
console.log('networkcheck passed: delayed input replay, bounded motion, stall/rematch, team geometry');

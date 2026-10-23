import assert from 'node:assert/strict';
import { NetworkPass } from '../src/net/simulation.js';
import { PassSim, simulatePass } from '../src/game/pass.js';
import { packInput, TICK } from '../src/game/spec.js';
const copy = (x) => structuredClone(x);
// Fork a noisy running pass and prove RNG/physics state evolves identically.
const checkpoint = new PassSim({ seed: 42, riders: [{ drunk: 0.7 }, { drunk: 0.9 }] });
checkpoint.logs = [0, 1].map((seat) =>
  Array.from({ length: 540 }, (_, i) =>
    packInput({ leanX: seat ? 0.1 : -0.2, aimX: Math.sin(i / 50) * 0.3, couch: true, fling: i === 250 }),
  ),
);
for (let i = 0; i < 180; i++) checkpoint.step(TICK);
const fork = checkpoint.clone();
while (!checkpoint.done) {
  checkpoint.step(TICK);
  fork.step(TICK);
}
assert.deepEqual(
  fork.result(),
  checkpoint.result(),
  'checkpoint includes PRNG, vectors, noise history and events',
);
let tested = 0,
  slowest = 0;
for (const delay of [0, 25, 50, 100])
  for (let seed = 1; seed <= 20; seed++) {
    const sims = [0, 1].map((seat) => new NetworkPass({ seed, seat, pass: 'test' }));
    let queue = [];
    const sent = [0, 0],
      events = [[], []],
      cursor = [0, 0];
    for (let frame = 0; frame < 800 && !sims.every((s) => s.done); frame++) {
      const time = frame * TICK * 1000;
      const due = queue.filter((p) => p.at <= time);
      queue = queue.filter((p) => p.at > time);
      for (const p of due) {
        sims[p.to].receive(p);
        if (frame % 7 === 0) sims[p.to].receive(p);
      }
      for (let seat = 0; seat < 2; seat++) {
        const s = sims[seat];
        if (!s.done && !s.expired)
          s.capture(
            frame,
            packInput({
              leanX: seat === 0 ? 0.25 : -0.2,
              leanY: seat === 0 ? 0.3 : 0.1,
              aimX: Math.sin(frame / 37) * (seat === 0 ? 0.25 : -0.3),
              aimY: seat === 0 ? 0.06 : -0.04,
              couch: frame > 40,
              guard: seat === 1 && frame > 200,
              spur: seat === 0,
            }),
          );
        const start = performance.now();
        s.advance();
        slowest = Math.max(slowest, performance.now() - start);
        while (cursor[seat] < s.confirmed.events.length)
          events[seat].push(copy(s.confirmed.events[cursor[seat]++]));
        // Full history resend also exercises recovery after a lost batch.
        if (frame % 3 === 0) {
          const from = frame % 30 === 0 ? 0 : Math.max(0, sent[seat] - 3);
          if (frame % 23 !== 0)
            queue.push({
              to: 1 - seat,
              at: time + delay + ((frame * 7) % 21),
              pass: 'test',
              from,
              ticks: copy(s.own.slice(from)),
            });
          sent[seat] = s.own.length;
        }
      }
    }
    assert.ok(
      sims.every((s) => s.done),
      'both clients finish despite jitter, drops and duplicates',
    );
    const authoritative = simulatePass({ seed, logs: sims.map((s) => s.own) });
    for (let seat = 0; seat < 2; seat++) {
      assert.deepEqual(sims[seat].confirmed.result().score, authoritative.score);
      assert.deepEqual(events[seat], authoritative.events, 'only confirmed events reach the UI');
    }
    tested++;
  }
console.log(
  `joust networkcheck: ${tested} delayed/jittered passes, zero confirmed outcome disagreements; slowest replay ${slowest.toFixed(1)}ms`,
);

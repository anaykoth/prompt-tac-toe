/** Determinism: the live sim and the headless replay must never drift apart. */
import { PassSim, simulatePass, newPassSeed } from '../src/game/pass.js';
import { TICK, PASS_MAX_S, F_COUCH, F_SPUR, F_GUARD, F_FLING, packInput, unpackInput, IDLE_INPUT } from '../src/game/spec.js';
import { mulberry32 } from '../../darts/src/game/rng.js';

let pass = 0, fail = 0;
const ok = (n, c, i = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}  ${i}`); } };

/** a scripted, fairly busy pair of riders */
function makeLogs(seed) {
  const r = mulberry32(seed);
  const logs = [[], []];
  for (let t = 0; t < 600; t++) {
    for (const s of [0, 1]) {
      const lean = Math.sin((t + s * 40) / 55) * 0.8;
      const aim = Math.cos((t + s * 17) / 70) * 0.5;
      const flags = F_SPUR | (t >= 80 ? F_COUCH : 0) | (t > 220 && t < 260 ? F_GUARD : 0) | (t >= 150 && t < 170 ? F_FLING : 0);
      logs[s][t] = packInput({ leanX: lean, leanY: aim * 0.3, aimX: aim, aimY: -aim * 0.4, couch: !!(flags & F_COUCH), guard: !!(flags & F_GUARD), spur: true, fling: !!(flags & F_FLING) });
    }
  }
  return logs;
}
const fingerprint = (r) => JSON.stringify({ s: r.score, e: r.events, u: r.unseated, t: r.ticks, r: r.endReason });

{
  const logs = makeLogs(11);
  const a = simulatePass({ seed: 99, logs });
  const b = simulatePass({ seed: 99, logs });
  ok('the same seed and log replays identically', fingerprint(a) === fingerprint(b));
  ok('and it actually did something', a.events.length > 1, JSON.stringify(a.events.map((e) => e.type)));
}
{
  const logs = makeLogs(11);
  const ref = simulatePass({ seed: 99, logs });
  const patterns = [
    { name: '1/60', next: () => 1 / 60 },
    { name: '1/37', next: () => 1 / 37 },
    { name: '1/144 + jitter', next: (() => { const r = mulberry32(5); return () => 1 / 144 + (r() - 0.5) * 0.004; })() },
  ];
  for (const p of patterns) {
    const live = new PassSim({ seed: 99 });
    let guard = 0;
    // 1/60 is the live case: one push per tick, just before the step that eats it.
    // The coarser/finer patterns swallow several ticks per frame, so the log is
    // already in hand — exactly how a spectator or the server replays it.
    const perTick = p.name === '1/60';
    if (!perTick) live.logs = [logs[0].slice(), logs[1].slice()];
    while (!live.done && guard++ < 20000) {
      if (perTick) for (const s of [0, 1]) live.logs[s][live.tick] = logs[s][live.tick] ?? IDLE_INPUT;
      live.step(p.next());
    }
    ok(`a live sim at ${p.name} matches the replay`, fingerprint(live.result()) === fingerprint(ref), `${JSON.stringify(live.result())}\n        vs ${JSON.stringify(ref)}`.slice(0, 400));
  }
}
{
  const logs = makeLogs(11);
  const seen = new Set();
  for (const seed of [1, 2, 3, 4, 5, 6]) seen.add(fingerprint(simulatePass({ seed, logs })));
  ok('different seeds give different passes', seen.size > 1, String(seen.size));
}
{
  const p = packInput({ leanX: -0.333, leanY: 1, aimX: 0.5, aimY: -2, couch: true, guard: false, spur: true, fling: true });
  const back = unpackInput(JSON.parse(JSON.stringify(p)));
  ok('a packed input round-trips through JSON', back.leanX === -0.33 && back.leanY === 1 && back.aimY === -1 && back.couch && !back.guard && back.spur && back.fling, JSON.stringify(back));
}
{
  const logs = makeLogs(7);
  for (const s of [0, 1]) for (let t = 0; t < 600; t++) logs[s][t] = [0, 0, 0, 0, 0];   // nobody spurs: runs long
  const t0 = Date.now();
  const r = simulatePass({ seed: 12, logs });
  const ms = Date.now() - t0;
  ok('a full pass runs in under 300 ms', ms < 300, `${ms} ms, ${r.ticks} ticks, ${r.endReason}`);
  ok('and it is capped at PASS_MAX_S', r.ticks * TICK <= PASS_MAX_S + 1e-6, String(r.ticks * TICK));
}
{
  ok('newPassSeed gives a uint32', Number.isInteger(newPassSeed()) && newPassSeed() >= 0);
}
console.log(`\n${fail ? 'FAIL' : 'ok'}  passcheck  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/** Plays whole matches through the real rules + AI to check the loop terminates. */
import { Match, aiAim, AI_LEVELS, targetPoint, checkout } from '../src/game/match.js';
import { scoreAt } from '../src/world/dartboard.js';

function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function playMatch(levelA, levelB, maxRounds = 200) {
  const m = new Match({ start: 501, doubleOut: true });
  let darts = 0;
  while (!m.finished && m.round <= maxRounds) {
    const level = m.current === 0 ? levelA : levelB;
    const aim = aiAim(m, level);
    const sc = scoreAt(aim.x, aim.y);
    const out = m.applyDart(sc.value > 0 ? sc : null);
    darts++;
    if (out.visitOver && !m.finished) m.endVisit();
    if (darts > 4000) throw new Error('match never terminated');
  }
  return { finished: m.finished, winner: m.winner, rounds: m.round, darts, avg: [m.average(0), m.average(1)] };
}

const stats = {};
for (const lvl of Object.keys(AI_LEVELS)) {
  const runs = [];
  for (let i = 0; i < 60; i++) runs.push(playMatch(lvl, lvl));
  const unfinished = runs.filter((r) => !r.finished).length;
  const avgDarts = runs.reduce((a, r) => a + r.darts, 0) / runs.length;
  const avg3 = runs.reduce((a, r) => a + (r.avg[0] ?? 0), 0) / runs.length;
  stats[AI_LEVELS[lvl].name] = {
    unfinished, avgDartsPerMatch: +avgDarts.toFixed(1), avg3Dart: +avg3.toFixed(1),
  };
}
console.log('--- 60 matches per level (both seats same level) ---');
console.table(stats);

console.log('\n--- checkout coverage 2..170 ---');
const impossible = [];
for (let n = 2; n <= 170; n++) if (!checkout(n, 3, true)) impossible.push(n);
console.log('no 3-dart finish:', impossible.join(', '));

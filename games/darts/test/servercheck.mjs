/**
 * The rules the server enforces, exercised without a database.
 *
 * `lib/darts.mjs` is a thin shell around exactly this: re-simulate the launch,
 * feed the score to Match, end the visit when the visit ends. Everything that
 * can actually go wrong with a leg lives here, so it is worth testing on its
 * own rather than only against Postgres.
 *
 * `node test/servercheck.mjs`
 */
import * as THREE from 'three';
import { Match, targetPoint } from '../src/game/match.js';
import { resolveThrow, launchMessage } from '../src/game/replay.js';
import { solveAim } from '../src/game/physics.js';
import { BOARD_HEIGHT } from '../src/world/dartboard.js';

let pass = 0, fail = 0;
const ok = (n, c, i = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}  ${i}`); } };

const FROM = [
  new THREE.Vector3(-0.16, 1.70, 2.59),
  new THREE.Vector3(0.16, 1.70, 2.59),
];

let seedCounter = 1;
function throwAt(seat, label, speed = 8.2) {
  const t = targetPoint(label);
  const target = new THREE.Vector3(t.x, BOARD_HEIGHT + t.y, 0);
  const vel = solveAim(FROM[seat], target, speed);
  return launchMessage({ from: FROM[seat], vel, wobble: 0.05, roll: 1, magnus: 0, seed: seedCounter++ });
}

/** Mirror of lib/darts.mjs applyThrow, minus the storage. */
function makeServer() {
  const match = new Match({ start: 501, doubleOut: true });
  const log = [];
  return {
    match, log,
    throw(seat, launch) {
      if (match.finished) return { ok: false, error: 'match-over' };
      if (match.current !== seat) return { ok: false, error: 'not-your-turn' };
      const visitStartSeq = log.length - (3 - match.dartsLeft);
      const tips = log
        .filter((r, i) => i >= visitStartSeq && r.result.type === 'stick' && r.result.surface === 'board')
        .map((r) => r.result.point);
      const result = resolveThrow(launch, tips);
      const outcome = match.applyDart(result.score && result.value > 0 ? result.score : null);
      if (outcome.visitOver && !outcome.win) match.endVisit();
      log.push({ seq: log.length, seat, launch, result });
      return { ok: true, result, outcome };
    },
  };
}

console.log('--- turn order ---');
{
  const s = makeServer();
  ok('seat 0 starts', s.match.current === 0);
  ok('seat 1 cannot jump in', s.throw(1, throwAt(1, 'T20')).error === 'not-your-turn');
  s.throw(0, throwAt(0, 'T20'));
  ok('still seat 0 mid-visit', s.match.current === 0 && s.match.dartsLeft === 2);
  s.throw(0, throwAt(0, 'T20'));
  s.throw(0, throwAt(0, 'T20'));
  ok('darts pass over after three', s.match.current === 1 && s.match.dartsLeft === 3);
  ok('seat 0 now locked out', s.throw(0, throwAt(0, 'T20')).error === 'not-your-turn');
}

console.log('\n--- scoring comes from the simulation, not the client ---');
{
  const s = makeServer();
  const r = s.throw(0, throwAt(0, 'T20'));
  ok('a treble 20 is scored as 60', r.result.value === 60 && r.result.label === 'T20', r.result.label);
  ok('and taken off the leg', s.match.score[0] === 441, String(s.match.score[0]));
  // a client claiming a score it did not throw changes nothing: the payload
  // carries no score at all, only the launch
  ok('the wire format cannot express a score', !('value' in throwAt(0, 'T20')));
}

console.log('\n--- the log rebuilds the board ---');
{
  const s = makeServer();
  for (let i = 0; i < 9; i++) s.throw(s.match.current, throwAt(s.match.current, 'T20'));
  const replayed = new Match({ start: 501, doubleOut: true });
  for (const row of s.log) {
    const out = replayed.applyDart(row.result.score && row.result.value > 0 ? row.result.score : null);
    if (out.visitOver && !out.win) replayed.endVisit();
  }
  ok('replaying the log reproduces the leg exactly',
    JSON.stringify(replayed.toJSON()) === JSON.stringify(s.match.toJSON()));
}

console.log('\n--- a leg actually finishes ---');
{
  const s = makeServer();
  let guard = 0;
  while (!s.match.finished && guard++ < 400) {
    const seat = s.match.current;
    const co = s.match.suggestion();
    s.throw(seat, throwAt(seat, co ? co[0] : 'T20'));
  }
  ok('someone checks out', s.match.finished, `after ${guard} darts`);
  ok('winner is a real seat', s.match.winner === 0 || s.match.winner === 1);
  ok('winner is on zero', s.match.score[s.match.winner] === 0);
  ok('no more throws accepted', s.throw(s.match.current, throwAt(0, 'D20')).error === 'match-over');
}

console.log('\n--- bust still works over the wire ---');
{
  const s = makeServer();
  s.match.score[0] = 20; s.match.visitStart[0] = 20;
  const r = s.throw(0, throwAt(0, 'T20'));           // 60 into 20 = bust
  ok('overshooting busts', r.outcome.bust === true, JSON.stringify(r.outcome));
  ok('score is restored', s.match.score[0] === 20, String(s.match.score[0]));
  ok('and the visit ends', s.match.current === 1);
}

console.log('\n--- state serialises for the wire ---');
{
  const s = makeServer();
  s.throw(0, throwAt(0, 'T20'));
  const wire = JSON.parse(JSON.stringify(s.match.toJSON()));
  const back = Match.fromJSON(wire);
  ok('match survives a round trip', JSON.stringify(back.toJSON()) === JSON.stringify(s.match.toJSON()));
  ok('payload stays small', JSON.stringify(wire).length < 1200, `${JSON.stringify(wire).length} bytes`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

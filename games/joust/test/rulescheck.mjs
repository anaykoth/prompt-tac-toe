/** The match wrapper: a series of passes, sudden death, and a JSON round trip. */
import { Match, passSummary } from '../src/game/rules.js';
import { DEFAULT_PASSES } from '../src/game/spec.js';

let pass = 0, fail = 0;
const ok = (n, c, i = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}  ${i}`); } };
const res = (a, b, opts = {}) => ({ score: [a, b], events: opts.events ?? [], unseated: opts.unseated ?? [false, false], ticks: 300, endReason: opts.endReason ?? 'complete' });

{
  const m = new Match();
  ok('best of five by default', m.passes === DEFAULT_PASSES && m.pass === 1 && !m.finished);
  for (let i = 0; i < 5; i++) m.applyPass(res(3, 1));
  ok('five passes finish the match', m.finished, `pass ${m.pass}`);
  ok('and the leader wins', m.winner === 0 && m.score[0] === 15 && m.score[1] === 5, JSON.stringify(m.score));
  const before = JSON.stringify(m.toJSON());
  m.applyPass(res(9, 0));
  ok('a finished match ignores further passes', JSON.stringify(m.toJSON()) === before);
}
{
  const m = new Match();
  for (let i = 0; i < 5; i++) m.applyPass(res(2, 2));
  ok('a tie does not end the match', !m.finished && m.suddenDeath, JSON.stringify(m.score));
  m.applyPass(res(0, 0));
  ok('a drawn sudden-death pass rides again', !m.finished);
  m.applyPass(res(0, 3));
  ok('sudden death ends when someone leads', m.finished && m.winner === 1, JSON.stringify(m.score));
}
{
  const m = new Match({ toUnhorsing: true, passes: 9 });
  m.applyPass(res(1, 1));
  ok('to-the-unhorsing runs on while everyone is mounted', !m.finished);
  m.applyPass(res(10, 0, { unseated: [false, true], endReason: 'unseat', events: [{ type: 'unseat', seat: 0, target: 1 }] }));
  ok('an unseat ends it', m.finished && m.winner === 0, String(m.winner));
  ok('history keeps every pass', m.history.length === 2 && m.history[0].pass === 1);
}
{
  const m = new Match({ names: ['GRIMSBY', 'PERCIVAL'] });
  m.applyPass(res(3, 0, { events: [{ type: 'break', seat: 0 }] }));
  const j = JSON.parse(JSON.stringify(m.toJSON()));
  const back = Match.fromJSON(j);
  ok('JSON round trips', JSON.stringify(back.toJSON()) === JSON.stringify(m.toJSON()), JSON.stringify(j));
  const other = new Match();
  other.adopt(j);
  ok('adopt takes the same state without a new object', other.score[0] === 3 && other.names[0] === 'GRIMSBY');
}
{
  const s = (events) => passSummary({ score: [1, 0], events });
  ok('UNHORSED is the loudest', s([{ type: 'unseat' }]).big === 'UNHORSED' && s([{ type: 'unseat' }]).hype === 1.7);
  ok('a shattered lance reads right', s([{ type: 'break' }]).big === 'LANCE SHATTERED' && s([{ type: 'break' }]).hype === 1.2);
  ok('a helm hit reads right', s([{ type: 'helm' }]).big === 'HELM' && s([{ type: 'helm' }]).hype === 1.0);
  ok('a thrown helmet is a BONK', s([{ type: 'helmet-hit' }]).big === 'BONK' && s([{ type: 'helmet-hit' }]).hype === 1.1);
  ok('a glance is a glance', s([{ type: 'glance' }]).big === 'GLANCE' && s([{ type: 'glance' }]).hype === 0.3);
  ok('a foul is booed', s([{ type: 'foul' }]).big === 'FOUL' && s([{ type: 'foul' }]).hype === -0.85);
  ok('nothing is nothing', s([]).big === 'NOTHING' && s([]).hype === -0.5);
}
console.log(`\n${fail ? 'FAIL' : 'ok'}  rulescheck  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/** The drink economy has to be a real gamble, not free money or a dead end. */
import { Bar, DRINKS } from '../src/game/bar.js';

let pass = 0, fail = 0;
const ok = (n, c, i = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}  ${i}`); } };

{
  const b = new Bar();
  ok('opens with a float so the mechanic is live from dart one', b.points > 0);
  ok('starts sober', b.drunk === 0 && b.multiplier === 1 && b.state === 'SOBER');
}
{
  const b = new Bar();
  b.points = 0;
  ok('cannot buy what you cannot afford', !b.buy(DRINKS[0]) && b.drunk === 0);
}
{
  const b = new Bar();
  b.points = 1000;
  const before = b.points;
  b.buy(DRINKS[1]);
  ok('a round costs points', b.points === before - DRINKS[1].cost);
  ok('and gets you drunk', Math.abs(b.drunk - DRINKS[1].kick) < 1e-9);
  ok('multiplier rises with it', b.multiplier > 1);
}
{
  const b = new Bar();
  b.points = 5000;
  for (const d of DRINKS) { b.buy(d); b.buy(d); }
  ok('drunkenness caps at 1', b.drunk === 1, String(b.drunk));
  ok('multiplier caps at x3', b.multiplier === 3);
}
{
  const b = new Bar();
  b.points = 1000; b.buy(DRINKS[1]);
  const d0 = b.drunk;
  for (let i = 0; i < 60 * 60; i++) b.update(1 / 60);   // one minute
  ok('a pint wears off inside a minute', b.drunk === 0, `${d0} -> ${b.drunk}`);
  ok('and the multiplier comes back down', b.multiplier === 1);
}
{
  const b = new Bar();
  const sober = b.scoreDart(60);
  b.points = 1000; b.buy(DRINKS[3]);
  const drunk = b.scoreDart(60);
  ok('the same dart pays more when drunk', drunk > sober, `${sober} vs ${drunk}`);
  ok('a miss pays nothing', b.scoreDart(0) === 0);
}
{
  // the gamble has to be able to pay for itself, or nobody would ever drink
  const b = new Bar();
  b.points = 1000;
  b.buy(DRINKS[1]);
  let earned = 0;
  // ~3 visits of pub-standard scoring while the pint lasts
  for (let v = 0; v < 9; v++) { earned += b.scoreDart(20); for (let i = 0; i < 60 * 4; i++) b.update(1 / 60); }
  ok('a pint can pay for itself if you keep scoring', earned > DRINKS[1].cost, `earned ${earned} vs cost ${DRINKS[1].cost}`);
}
{
  const b = new Bar();
  const seen = new Set();
  for (let d = 0; d <= 1.001; d += 0.02) { b.drunk = d; seen.add(b.state); }
  ok('every sobriety label is reachable', seen.size === 6, [...seen].join(','));
}
{
  const b = new Bar();
  b.points = 1000; b.buy(DRINKS[2]); b.scoreDart(40);
  b.reset();
  ok('reset clears the tab', b.drunk === 0 && b.rounds === 0 && b.earned === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

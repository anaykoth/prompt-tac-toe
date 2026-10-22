/**
 * Lab systems: wallet, jar scoring and blackjack. `node test/labcheck.mjs`
 */
import { Wallet, today, hashString, STOCK } from '../src/lab/wallet.js';
import { Blackjack, handValue, isBlackjack, buildShoe } from '../src/lab/blackjack.js';
import { mulberry32, PoolSim, makeBall } from '../src/pool/physics.js';
import { Match } from '../src/pool/rules.js';

let pass = 0, fail = 0;
const ok = (n, c, i = '') => { if (c) { pass++; console.log(`  ok   ${n}${i ? '  ' + i : ''}`); } else { fail++; console.log(`  FAIL ${n}  ${i}`); } };

/** localStorage stand-in, so these run in node. */
const memStore = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
};

console.log('\n--- wallet ---');
{
  const w = new Wallet(memStore());
  const start = w.points;
  ok('starts with a float', start > 0, `${start} pts`);
  ok('cannot overspend', !w.spend(start + 1));
  ok('spending works', w.spend(50) && w.points === start - 50);
  w.earn(120);
  ok('earning works', w.points === start - 50 + 120);

  const cue = STOCK.find((s) => s.id === 'cue-straight');
  w.earn(5000);
  ok('buying equips the item', w.buy(cue).ok && w.data.equipped.cue === 'cue-straight');
  ok('cannot buy the same thing twice', !w.buy(cue).ok);

  const drink = STOCK.find((s) => s.id === 'drink-pint');
  const before = w.points;
  w.buy(drink);
  ok('consumables are not added to owned', !w.owns('drink-pint') && w.points === before - drink.cost);
}

console.log('\n--- persistence ---');
{
  const store = memStore();
  const a = new Wallet(store);
  a.earn(777);
  const saved = a.points;
  const b = new Wallet(store);
  ok('a wallet survives a reload', b.points === saved, `${b.points}`);
}

console.log('\n--- the jar ---');
{
  const w = new Wallet(memStore());
  const r = w.submitJarGuess(100, 100);
  ok('an exact guess pays the most', r.ok && r.points === 500, `${r.points} pts`);
  ok('one go a day', !w.submitJarGuess(90, 100).ok);

  // closer must always pay at least as much as further away
  const scores = [0, 1, 4, 10, 25, 60, 200].map((err) => {
    const w2 = new Wallet(memStore());
    return w2.submitJarGuess(200 + err, 200).points;
  });
  const monotonic = scores.every((s, i) => i === 0 || s <= scores[i - 1]);
  ok('closer never pays less than further', monotonic, scores.join(' > '));
}

console.log('\n--- blackjack hands ---');
{
  ok('ace counts high when it fits', handValue([{ r: 'A' }, { r: '9' }]).total === 20);
  ok('ace drops to one to avoid a bust', handValue([{ r: 'A' }, { r: '9' }, { r: '5' }]).total === 15);
  ok('two aces are 12', handValue([{ r: 'A' }, { r: 'A' }]).total === 12);
  ok('face cards are ten', handValue([{ r: 'K' }, { r: 'Q' }]).total === 20);
  ok('blackjack is only two cards', isBlackjack([{ r: 'A' }, { r: 'K' }])
    && !isBlackjack([{ r: '5' }, { r: '6' }, { r: 'K' }]));
  const shoe = buildShoe(mulberry32(1));
  ok('the shoe is six full decks', shoe.length === 312);
}

console.log('\n--- blackjack play ---');
{
  const w = new Wallet(memStore());
  w.earn(10000);
  const g = new Blackjack({ rng: mulberry32(5), wallet: w });
  const before = w.points;
  ok('a bet leaves the wallet', g.deal(100).ok && w.points <= before - 100);
  ok('both sides are dealt', g.hands[0].cards.length === 2 && g.dealer.length === 2);
  ok('cannot deal twice', g.state === 'settled' || !g.deal(100).ok);
}
{
  // play a few hundred hands: the bank must never be created or destroyed
  const w = new Wallet(memStore());
  w.earn(1e6);
  const g = new Blackjack({ rng: mulberry32(11), wallet: w });
  let hands = 0, busts = 0, wins = 0;
  for (let i = 0; i < 400; i++) {
    g.reset();
    if (!g.deal(50).ok) break;
    let guard = 0;
    while (g.state === 'playing' && guard++ < 12) {
      const v = handValue(g.hand.cards).total;
      if (v < 17) g.hit(); else g.stand();
    }
    hands++;
    if (g.hands.some((h) => h.outcome === 'BUST')) busts++;
    if (g.net > 0) wins++;
  }
  ok('400 hands play out without stalling', hands === 400, `${hands} hands`);
  ok('the player sometimes wins and sometimes busts', wins > 40 && busts > 40,
    `${wins} winning hands, ${busts} busts`);
  ok('the wallet never goes negative', w.points >= 0, `${w.points} pts left`);
}
{
  // a settled hand must pay exactly what it says it paid
  const w = new Wallet(memStore());
  w.earn(1000);
  const g = new Blackjack({ rng: mulberry32(3), wallet: w });
  const before = w.points;
  g.deal(100);
  while (g.state === 'playing') g.stand();
  const expected = before - g.hands.reduce((s, h) => s + h.bet, 0)
    + g.hands.reduce((s, h) => s + h.payout, 0);
  ok('the books balance', w.points === expected, `${w.points} vs ${expected}`);
}

console.log('\n--- eight-ball legality ---');
{
  /* Regression: potting your last group ball must not retroactively make the
     shot illegal. This was calling a legal pot "WRONG BALL FIRST". */
  const s = new PoolSim({ rng: mulberry32(2) });
  for (const b of [makeBall(0, -0.4, 0), makeBall(3, 0.2, 0), makeBall(8, 0.6, 0.3), makeBall(11, -0.2, 0.3)]) s.add(b);
  const m = new Match({ names: ['A', 'B'] });
  m.broken = true;
  m.open = false;
  m.group = ['solids', 'stripes'];
  m.current = 0;
  // the 3 is the player's last solid; pretend they potted it cleanly
  const log = { firstContact: 3, railAfterContact: true, cueHitRail: false,
    pocketed: [3], pocketDetail: { 3: 4 }, cueScratch: false, offTable: [], contacts: 1 };
  const three = s.byNum(3);
  three.live = false; three.pocketed = true;
  const res = m.applyShot(s, log);
  ok('potting your last group ball is not a foul', res.foul === null, `foul=${res.foul}`);
  ok('and you keep the table', !res.turnOver);
  ok('you are now on the eight', m.onEight(s, 0));
}
{
  // hitting the other player's ball first is still a foul
  const s = new PoolSim({ rng: mulberry32(2) });
  for (const b of [makeBall(0, -0.4, 0), makeBall(3, 0.2, 0), makeBall(11, 0.6, 0), makeBall(8, 0.9, 0.3)]) s.add(b);
  const m = new Match({ names: ['A', 'B'] });
  m.broken = true; m.open = false; m.group = ['solids', 'stripes']; m.current = 0;
  const log = { firstContact: 11, railAfterContact: true, cueHitRail: false,
    pocketed: [], pocketDetail: {}, cueScratch: false, offTable: [], contacts: 1 };
  const res = m.applyShot(s, log);
  ok('hitting the wrong group first is still a foul', res.foul === 'WRONG BALL FIRST', `foul=${res.foul}`);
}
{
  // clearing your group and the eight in one shot is a loss, not a win
  const s = new PoolSim({ rng: mulberry32(2) });
  for (const b of [makeBall(0, -0.4, 0), makeBall(3, 0.2, 0), makeBall(8, 0.6, 0.2)]) s.add(b);
  const m = new Match({ names: ['A', 'B'] });
  m.broken = true; m.open = false; m.group = ['solids', 'stripes']; m.current = 0;
  s.byNum(3).live = false; s.byNum(8).live = false;
  const log = { firstContact: 3, railAfterContact: true, cueHitRail: false,
    pocketed: [3, 8], pocketDetail: { 3: 4, 8: 5 }, cueScratch: false, offTable: [], contacts: 2 };
  const res = m.applyShot(s, log);
  ok('the eight down too early loses the rack', res.lose === true, `lose=${res.lose} win=${res.win}`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

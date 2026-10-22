import assert from 'node:assert/strict';
import { HOCKEY, createHockeyState, stepHockey, resetHockey, constrainTarget } from '../src/air-hockey/physics.js';
import { predictHockeyMotion } from '../src/air-hockey/prediction.js';
import { HOCKEY_PRESETS, HOCKEY_CPU_POWER, normalizeHockeySettings, validHitStrength } from '../src/air-hockey/tuning.js';

const home = [{ x: .8, y: 1.3 }, { x: .8, y: -1.3 }];
const clear = () => {
  const state = createHockeyState();
  state.mallets.forEach((m, i) => Object.assign(m, home[i]));
  return state;
};
const advance = (state, seconds, targets = home) => {
  for (let n = 0; n < Math.round(seconds * 120); n++) stepHockey(state, targets, 1 / 120);
};
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`  ok   ${name}`); }

check('a puck through the top goal scores once for Sun', () => {
  const s = clear(); Object.assign(s.puck, { x: 0, y: -1.5, vx: 0, vy: -7 });
  advance(s, .2); assert.deepEqual(s.score, [1, 0]); assert.equal(s.status, 'goal');
  advance(s, .5); assert.deepEqual(s.score, [1, 0]);
});
check('the bottom goal scores for Moon and concedes the next serve to Sun', () => {
  const s = clear(); Object.assign(s.puck, { x: .1, y: 1.5, vx: 0, vy: 7 });
  advance(s, .2); assert.deepEqual(s.score, [0, 1]); assert.equal(s.servingSeat, 0);
  advance(s, 1.3); assert.equal(s.status, 'playing'); assert.equal(s.puck.y, .62);
});
check('end rails outside the goal reflect fast shots', () => {
  const s = clear(); Object.assign(s.puck, { x: -.6, y: -1.5, vx: 0, vy: -15 });
  advance(s, .08); assert.equal(s.goals, 0); assert.ok(s.puck.vy > 0); assert.ok(s.banks >= 1);
});
check('the whole puck must fit in the goal mouth', () => {
  const s = clear(); Object.assign(s.puck, { x: HOCKEY.goalHalfWidth - .02, y: -1.5, vx: 0, vy: -10 });
  advance(s, .08); assert.equal(s.goals, 0); assert.ok(s.puck.vy > 0);
});
check('side banks retain speed and stay on the table', () => {
  const s = clear(); Object.assign(s.puck, { x: .8, y: 0, vx: 13, vy: 0 });
  advance(s, .06); assert.ok(s.puck.vx < 0); assert.ok(Math.abs(s.puck.x) <= 1 - HOCKEY.puckRadius);
});
check('high speed puck cannot tunnel through a stationary mallet', () => {
  const s = clear(); Object.assign(s.mallets[0], { x: 0, y: .85 });
  Object.assign(s.puck, { x: 0, y: .35, vx: 0, vy: 15 });
  advance(s, .06, [{ x: 0, y: .85 }, home[1]]);
  assert.ok(s.puck.vy < 0); assert.ok(s.hits > 0); assert.ok(s.puck.y < .85);
});
check('mallet strikes transfer measured hand speed to the puck', () => {
  const s = clear(); Object.assign(s.mallets[0], { x: 0, y: 1.2 });
  Object.assign(s.puck, { x: 0, y: .7, vx: 0, vy: 0 });
  advance(s, .1, [{ x: 0, y: .2 }, home[1]]);
  assert.ok(s.puck.vy < -5); assert.ok(Math.hypot(s.puck.vx, s.puck.vy) <= HOCKEY.puckSpeed + 1e-8);
});
check('arbitrary target jumps cannot teleport a mallet', () => {
  const s = clear(), before = { ...s.mallets[0] };
  stepHockey(s, [{ x: -100000, y: -100000 }, { x: 100000, y: 100000 }], 1 / 120);
  assert.ok(Math.hypot(s.mallets[0].x - before.x, s.mallets[0].y - before.y) <= HOCKEY.malletSpeed / 120 + 1e-9);
  advance(s, 1, [{ x: -100000, y: -100000 }, { x: 100000, y: 100000 }]);
  assert.ok(s.mallets[0].y > 0); assert.ok(s.mallets[1].y < 0);
  assert.ok(s.mallets.every(m => Math.abs(m.x) <= 1 - HOCKEY.malletRadius));
});
check('untrusted missing and nonfinite targets stay finite and on their own half', () => {
  assert.ok(Number.isFinite(constrainTarget({ x: NaN, y: Infinity }, 0).y));
  const s = clear(); advance(s, 1, [null, { x: NaN, y: Infinity }]);
  assert.ok(s.mallets.every(m => Object.values(m).every(Number.isFinite)));
  const previous = structuredClone(s); stepHockey(s, null, NaN); assert.deepEqual(s, previous);
});
check('seven points finishes exactly once; reset creates a clean match', () => {
  const s = clear(); s.score[0] = 6; Object.assign(s.puck, { x: 0, y: -1.5, vx: 0, vy: -12 });
  advance(s, 3); assert.equal(s.status, 'finished'); assert.equal(s.winner, 0); assert.deepEqual(s.score, [7, 0]);
  resetHockey(s); assert.deepEqual(s, createHockeyState());
});
check('identical input produces identical serializable simulations', () => {
  const a = createHockeyState(), b = createHockeyState();
  for (let i = 0; i < 2400; i++) {
    const targets = [{ x: Math.sin(i * .07), y: .25 + Math.abs(Math.cos(i * .03)) }, { x: Math.cos(i * .05), y: -.25 - Math.abs(Math.sin(i * .04)) }];
    stepHockey(a, targets, 1 / 120); stepHockey(b, targets, 1 / 120);
    assert.ok(Object.values(a.puck).every(Number.isFinite));
  }
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
check('online prediction cannot announce a speculative winning goal', () => {
  const s = clear(); s.score[0] = 6;
  Object.assign(s.puck, { x: 0, y: -1.6, vx: 0, vy: -12 });
  const before = structuredClone(s);
  predictHockeyMotion(s, [{ x: -.6, y: 1.2 }, home[1]], .04);
  assert.deepEqual(s.score, [6, 0]); assert.equal(s.status, 'playing');
  assert.equal(s.winner, null); assert.equal(s.goals, 0); assert.equal(s.lastGoal, null);
  assert.deepEqual(s.puck, before.puck);
  assert.notEqual(s.mallets[0].x, before.mallets[0].x, 'local mallet still responds immediately');
});
check('online prediction preserves server event counters and goal countdown', () => {
  const s = clear(); Object.assign(s.puck, { x: .9, y: 0, vx: 15, vy: 0 });
  predictHockeyMotion(s, home, .04);
  assert.ok(s.puck.vx < 0, 'bank motion is predicted');
  assert.equal(s.banks, 0, 'bank sound waits for authoritative event');
  s.status = 'goal'; s.goalTimer = .001;
  const puck = structuredClone(s.puck);
  predictHockeyMotion(s, home, .04);
  assert.equal(s.status, 'goal'); assert.equal(s.goalTimer, .001);
  assert.deepEqual(s.puck, puck, 'the server starts the next serve');
});

function measuredStrike(hitStrength, seatPower = 1) {
  const s = createHockeyState({ hitStrength, seatPower: [seatPower, 1] });
  Object.assign(s.mallets[0], { x: 0, y: 1.2 });
  Object.assign(s.mallets[1], home[1]);
  Object.assign(s.puck, { x: 0, y: .7, vx: 0, vy: 0 });
  advance(s, .1, [{ x: 0, y: .5 }, home[1]]);
  advance(s, .025, [{ x: 0, y: .5 }, home[1]]);
  return s;
}
check('lower transfer produces a slower released puck from the exact same hand path', () => {
  const gentle = measuredStrike(HOCKEY_PRESETS.gentle);
  const pub = measuredStrike(HOCKEY_PRESETS.pub);
  const original = measuredStrike(HOCKEY_PRESETS.original);
  const speed = s => Math.hypot(s.puck.vx, s.puck.vy);
  assert.ok(speed(gentle) < speed(pub) && speed(pub) < speed(original));
  assert.ok(Math.abs(speed(pub) / speed(original) - .5) < .01);
  assert.ok(Math.abs(speed(gentle) / speed(original) - .3) < .01);
  assert.deepEqual(gentle.mallets, original.mallets, 'hand travel remains equally quick');
  assert.equal(gentle.hits, 1, 'a prolonged soft contact cannot inject repeated impulses');
  assert.equal(gentle.contacts[0], false, 'puck releases after the hand stops');
  console.log(`       same sweep: Gentle ${speed(gentle).toFixed(2)}, Pub ${speed(pub).toFixed(2)}, Original ${speed(original).toFixed(2)} m/s`);
});
check('Barry, Dot and Shark transfer visibly distinct strike power with equal hand motion', () => {
  const barry = measuredStrike(.5, HOCKEY_CPU_POWER.friendly);
  const dot = measuredStrike(.5, HOCKEY_CPU_POWER.pub);
  const shark = measuredStrike(.5, HOCKEY_CPU_POWER.shark);
  assert.ok(Math.abs(barry.puck.vy) < Math.abs(dot.puck.vy));
  assert.ok(Math.abs(dot.puck.vy) < Math.abs(shark.puck.vy));
  assert.deepEqual(barry.mallets, shark.mallets);
});
check('gentle settings preserve a stationary mallet rebound without sticking', () => {
  const states = [.2, 1].map(hitStrength => {
    const s = createHockeyState({ hitStrength });
    Object.assign(s.mallets[0], { x: 0, y: .85 });
    Object.assign(s.puck, { x: 0, y: .35, vx: 0, vy: 12 });
    advance(s, .1, [{ x: 0, y: .85 }, home[1]]); return s;
  });
  assert.ok(states[0].puck.vy < -9);
  assert.deepEqual(states[0].puck, states[1].puck);
  assert.equal(states[0].contacts[0], false);
});
check('settings validate malformed input, clamp bounds and survive rematches', () => {
  for (const value of [null, undefined, NaN, Infinity, '0.5', [], {}, 0, -1, 1.01]) assert.equal(validHitStrength(value), false);
  assert.deepEqual(normalizeHockeySettings({ hitStrength: Infinity, seatPower: ['9', NaN] }), { hitStrength: .5, seatPower: [1, 1] });
  assert.deepEqual(normalizeHockeySettings({ hitStrength: -1, seatPower: [-99, 99] }), { hitStrength: .2, seatPower: [.5, 1.25] });
  const s = createHockeyState({ hitStrength: .65, seatPower: [1, .7] });
  s.score = [3, 4]; s.contacts = [true, false]; resetHockey(s);
  assert.deepEqual(s.settings, { hitStrength: .65, seatPower: [1, .7] });
  assert.deepEqual(s.score, [0, 0]); assert.deepEqual(s.contacts, [false, false]);
});
console.log(`\nAir hockey: ${checks} checks passed.`);

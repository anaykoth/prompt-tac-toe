import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SwingGesture } from '../src/phone/motion.js';
import { aimFromYaw } from '../src/phone/address.js';
import { launch } from '../src/golf/model.js';

assert.ok(aimFromYaw(20) < 0, 'leftward heading aims left');
assert.ok(aimFromYaw(-20) > 0, 'rightward heading aims right');
assert.ok(launch({power:.5, aim:aimFromYaw(20)}).vx < 0);
assert.ok(launch({power:.5, aim:aimFromYaw(-20)}).vx > 0);
assert.equal(Math.abs(aimFromYaw(0)), 0);
assert.equal(aimFromYaw(100), -35); assert.equal(aimFromYaw(-100), 35);

// Touching the grip can move a different axis first, or twitch in the opposite
// direction. Neither should decide the axis/sign of the ensuing backswing.
for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
  for (const wrongAxis of [axis, (axis + 1) % 3]) {
    const g = new SwingGesture(); g.begin(0);
    const twitch = [0, 0, 0]; twitch[wrongAxis] = -sign * 150;
    g.sample(twitch, 10);
    assert.equal(g.axis, null, 'a single touch movement cannot choose the swing axis');
    for (let t = 20; t <= 300; t += 10) {
      const rate = [0, 0, 0]; rate[axis] = sign * 130; g.sample(rate, t);
    }
    assert.equal(g.axis, axis); assert.equal(g.sign, sign);
    for (let t = 310; t <= 550; t += 10) {
      const rate = [0, 0, 0]; rate[axis] = -sign * 350; g.sample(rate, t, 12);
    }
    const shots = [];
    for (let t = 560; t <= 1000; t += 10) {
      const shot = g.sample([0, 0, 0], t, 12); if (shot) shots.push(shot);
    }
    assert.equal(shots.length, 1, 'the forward swing fires exactly once without releasing');
    const [shot] = shots;
    assert.ok(shot?.power > .4 && shot.power < .6);
    assert.equal(g.fired, true);
    assert.equal(g.release(), null, 'release cannot commit another shot');
  }
}

const wobble = new SwingGesture(); wobble.begin(0);
for (let t = 10; t <= 1000; t += 10) wobble.sample([t % 20 ? 80 : -80, 0, 0], t);
assert.equal(wobble.axis, null, 'alternating handling must not accumulate into a backswing');
assert.equal(wobble.release(1010), null);
const partial = new SwingGesture(); partial.begin(0);
partial.sample([0, 0, 150], 20); partial.cancel(); partial.begin(100);
partial.sample([0, 0, 150], 120);
assert.equal(partial.axis, null, 'a new grip must not inherit unfinished axis selection');
partial.sample([0, 0, 150], 500);
assert.equal(partial.active, false, 'a sensor interruption still cancels the gesture');

// Real Lab take: no grip events were recorded. Simulate explicit grip windows
// around each swing to test recognition, not to claim live shots were fired.
const { samples } = JSON.parse(fs.readFileSync(new URL('./fixtures/three-phone-swings.json', import.meta.url)));
const windows = [
  { from: 0, to: 200, end: 1750, peakAt:1171, power: .98 },
  { from: 3200, to: 4100, end: 5600, peakAt:5004, power: 1 },
  { from: 6400, to: 7500, end: 8650, peakAt:8220, power: .55 },
];
for (const w of windows) for (let start = w.from; start <= w.to; start += 25) {
  const g = new SwingGesture(); g.begin(start); const shots = [];
  for (const [t, rate] of samples) if (t >= start && t <= w.end) {
    const shot = g.sample(rate, t); if (shot) shots.push({...shot, at:t});
  }
  assert.equal(g.axis, 2, `actual backswing axis at simulated grip time ${start}`);
  assert.equal(g.sign, -1);
  assert.equal(shots.length, 1, `recorded swing auto-hits once at simulated grip time ${start}`);
  const [shot] = shots;
  assert.ok(shot.at > w.peakAt && shot.at - w.peakAt < 220, 'hit follows the real speed peak promptly');
  assert.ok(Math.abs(shot.power - w.power) < .01, 'the gentler third swing retains its lower power');
  assert.equal(g.release(), null, 'a later release is irrelevant to the hit');
}

const untouched = new SwingGesture();
for (const [t, rate] of samples) assert.equal(untouched.sample(rate, t), undefined, 'no grip means no hit');
const held = new SwingGesture(); held.begin(0); const heldShots = [];
for (const [t, rate] of samples) { const shot = held.sample(rate, t); if (shot) heldShots.push(shot); }
assert.equal(heldShots.length, 1, 'continued holding and later swings cannot duplicate the first hit');

for (const interrupt of ['release', 'cancel']) {
  const g = new SwingGesture(); g.begin(0);
  for (const [t, rate] of samples) if (t < 1200) assert.equal(g.sample(rate, t), undefined);
  g[interrupt]();
  for (const [t, rate] of samples) if (t >= 1200) assert.equal(g.sample(rate, t), undefined, `${interrupt} aborts a pending hit`);
}

console.log('motioncheck: left/right aim, held automatic hits, early-release cancellation, no-grip/no-duplicate shots, and three real swings passed');

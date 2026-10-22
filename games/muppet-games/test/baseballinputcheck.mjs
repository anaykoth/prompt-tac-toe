import assert from 'node:assert/strict';
import { BatGesture, PitchGesture } from '../src/baseball/input.js';
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`  ✓ ${name}`); }
check('a horizontal left flick fires once; vertical and rightward motion do not swing', () => {
  const bat = new BatGesture(); bat.begin(0);
  assert.equal(bat.move(0, -100, 30), null);
  assert.equal(bat.move(80, 0, 60), null);
  assert.equal(bat.move(-10, 0, 90), null);
  const swing = bat.move(-100, 0, 120);
  assert.ok(swing.speed > 1000 && swing.speed <= 3500);
  assert.equal(bat.move(-100, 0, 150), null);
});
check('slow placement is not a swing and cancellation disarms a stroke', () => {
  const bat = new BatGesture(); bat.begin(0);
  assert.equal(bat.move(-60, 0, 1000), null);
  bat.cancel(); assert.equal(bat.move(-100, 0, 1020), null);
});
check('pitch requires a draw-back, forward drive, and a moving release', () => {
  const p = new PitchGesture(); p.begin(0); p.move(0, -80, 60);
  assert.equal(p.release(60), null);
  p.begin(100); p.move(0, 45, 160); p.move(0, -90, 220);
  const release = p.release(220);
  assert.ok(release.speed >= 18 && release.speed <= 40); assert.ok(Math.abs(release.curve) < 1e-9);
  assert.equal(p.release(220), null);
});
check('sideways motion at release produces opposite curves and stronger drive adds speed', () => {
  const throwAt = (x, y) => { const p = new PitchGesture(); p.begin(0); p.move(0, 50, 60); p.move(x, -y, 120); return p.release(120); };
  const left = throwAt(-40, 90), right = throwAt(40, 90), soft = throwAt(0, 30), fast = throwAt(0, 120);
  assert.ok(left.curve > 0 && right.curve < 0); assert.equal(left.curve, -right.curve);
  assert.ok(fast.speed > soft.speed);
});
check('holding a loaded throw or cancelling cannot create a delayed pitch', () => {
  const p = new PitchGesture(); p.begin(0); p.move(0, 40, 60); p.move(0, -80, 120);
  assert.equal(p.release(400), null);
  p.begin(500); p.move(0, 40, 560); p.move(0, -80, 620); p.cancel();
  assert.equal(p.release(630), null);
});
console.log(`baseballinputcheck: ${checks} checks passed`);

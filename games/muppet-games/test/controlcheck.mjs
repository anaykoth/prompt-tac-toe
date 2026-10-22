import assert from 'node:assert/strict';
import { ContactStroke, contactShot } from '../src/pool/controls/contact-model.js';
import { resolveStroke, StrokeTrace, directionLabel } from '../src/pool/stroke-feedback.js';
import { PoolSim, rackEight, mulberry32 } from '../src/pool/physics.js';

let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`  ok   ${name}`); };

function constantStroke(hz, speed = 600) {
  const stroke = new ContactStroke();
  stroke.begin(0);
  stroke.move(0, 100, 100);
  let time = 100, hit;
  for (let i = 0; i < 2000 && !hit; i++) {
    time += 1000 / hz;
    hit = stroke.move(0, -speed / hz, time);
  }
  return hit;
}

check('contact happens at the ball plane, without waiting for release', () => {
  const stroke = new ContactStroke();
  stroke.begin(0);
  assert.equal(stroke.move(0, 100, 100), null);
  assert.equal(stroke.move(0, -110, 210), null);
  const hit = stroke.move(0, -10, 220);
  assert.ok(hit);
  assert.equal(hit.time, 214);
  assert.equal(hit.forward, 114, 'overshoot after contact contributes nothing');
  assert.equal(stroke.move(0, -50, 240), null, 'a stroke can only fire once');
});

check('a push with no intentional backswing does not fire', () => {
  const stroke = new ContactStroke();
  stroke.begin(0);
  assert.equal(stroke.move(0, -200, 30), null);
  assert.equal(stroke.armed, false);
  stroke.move(0, 5, 40);
  assert.equal(stroke.move(0, -100, 50), null);
});

check('release / cancellation cannot leave a delayed strike behind', () => {
  const stroke = new ContactStroke();
  stroke.begin(0);
  stroke.move(0, 100, 100);
  stroke.move(0, -80, 180);
  stroke.cancel();
  assert.equal(stroke.move(0, -100, 200), null);
  stroke.begin(250);
  assert.equal(stroke.move(0, -100, 280), null);
});

check('pausing and rehearsing ahead of contact does not auto-fire', () => {
  const stroke = new ContactStroke();
  stroke.begin(0);
  stroke.move(0, 100, 100);
  stroke.move(0, -80, 180);
  assert.equal(stroke.move(0, 0, 1800), null);
  assert.equal(stroke.distance, 34);
  stroke.move(0, 40, 1840);
  assert.equal(stroke.move(0, -70, 1910), null);
  assert.ok(stroke.move(0, -5, 1915));
});

check('the same hand trajectory gives the same speed at 60–1000 Hz', () => {
  const speeds = [60, 90, 125, 240, 1000].map((hz) => constantStroke(hz).speed);
  assert.ok(speeds.every((speed) => Math.abs(speed - 600) < 0.00001), speeds.join(', '));
});

check('a slow contact stays soft after an earlier fast push', () => {
  const stroke = new ContactStroke();
  stroke.begin(0);
  stroke.move(0, 200, 100);
  stroke.move(0, -180, 190); // an early 2000 px/s peak
  let hit;
  for (let t = 200; t <= 310 && !hit; t += 10) hit = stroke.move(0, -3, t);
  assert.ok(hit);
  assert.ok(Math.abs(hit.speed - 300) < 0.00001, `contact speed ${hit.speed}`);
  const shot = contactShot(hit, { yaw: 0, tipX: 0, tipY: 0.15, elevation: 0 });
  assert.ok(shot.speed < 0.4, `ball speed ${shot.speed}`);
});

check('sideways motion at contact affects the shot direction and straightness', () => {
  const base = { yaw: 0, tipX: 0, tipY: 0.15, elevation: 0 };
  const hit = { speed: 600, sideSpeed: 0, lateral: 0, back: 100, forward: 114 };
  const straight = contactShot(hit, base);
  const right = contactShot({ ...hit, sideSpeed: 150, lateral: 20 }, base);
  const left = contactShot({ ...hit, sideSpeed: -150, lateral: -20 }, base);
  assert.ok(right.yaw > straight.yaw && left.yaw < straight.yaw);
  assert.ok(right.straight < straight.straight);
  assert.equal(right.speed, straight.speed, 'sideways travel does not boost power');
});

check('the preview samples the contact window and drops old velocity when the hand stops', () => {
  const stroke = new ContactStroke();
  stroke.begin(0); stroke.move(0, 100, 100); stroke.move(18, -90, 190);
  const live = stroke.motion(190);
  assert.ok(Math.abs(live.speed - 1000) < 1e-8);
  assert.ok(Math.abs(live.sideSpeed - 200) < 1e-8);
  assert.equal(stroke.motion(300).speed, 0);
  const hit = stroke.move(8, -40, 230);
  assert.ok(Math.abs(hit.speed - live.speed) < 1e-8);
  assert.ok(Math.abs(hit.sideSpeed - live.sideSpeed) < 1e-8);
});

check('left/right release signs reach the real ball physics for both control styles', () => {
  for (const mode of ['classic', 'contact']) {
    const bearings = [-1, 0, 1].map(sign => {
      const base = { yaw: 0, tipX: 0, tipY: 0, elevation: 0 };
      const shot = mode === 'contact'
        ? contactShot({ speed: 900, sideSpeed: sign * 250, lateral: sign * 35, back: 100, forward: 114 }, base)
        : { ...base, speed: 1, straight: sign ? .65 : 1, pull: sign * 35 };
      const resolved = resolveStroke(shot);
      const sim = new PoolSim({ rng: mulberry32(42) });
      for (const ball of rackEight(mulberry32(42))) sim.add(ball);
      sim.strike(resolved.yaw, resolved.speed, resolved.tipX, resolved.tipY, resolved.elevation);
      return Math.atan2(sim.cue.vz, sim.cue.vx);
    });
    assert.ok(bearings[0] < 0 && bearings[2] > 0, `${mode}: ${bearings}`);
    assert.equal(bearings[1], 0);
    assert.ok(Math.abs(bearings[0] + bearings[2]) < 1e-10);
  }
});

check('direction labels handle aiming across the angle wrap without swapping left/right', () => {
  assert.match(directionLabel(.02), /RIGHT/);
  assert.match(directionLabel(-.02), /LEFT/);
  assert.match(directionLabel(2 * Math.PI - .02), /LEFT/);
  assert.match(directionLabel(0), /STRAIGHT/);
});

check('long rehearsals keep a bounded trace and preserve its start and newest point', () => {
  const trace = new StrokeTrace(); trace.begin('contact', 0, 14);
  for (let i = 0; i < 5000; i++) trace.add(i, i % 200, i % 2 === 0);
  assert.ok(trace.points.length <= 384);
  assert.deepEqual(trace.points[0], { x: 0, y: 14, push: false });
  assert.equal(trace.points.at(-1).x, 4999);
});

// Exercise the real controller with minimal browser event surfaces. This catches
// duplicate input listeners, unsafe mode changes and stale shots after blur.
class Surface extends EventTarget {
  constructor() { super(); this.listeners = new Map(); }
  addEventListener(type, fn) {
    super.addEventListener(type, fn);
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { super.removeEventListener(type, fn); this.listeners.get(type)?.delete(fn); }
  get count() { return [...this.listeners.values()].reduce((n, entries) => n + entries.size, 0); }
}
globalThis.window = new Surface();
globalThis.document = new Surface();
document.pointerLockElement = null;
const { CueControl } = await import('../src/pool/cue.js');
const canvas = new Surface();
const shots = [];
const control = new CueControl(canvas, { mode: 'contact', onShoot: (shot) => shots.push(shot) });
await control.ready;
control.enabled = true;
control.rearm();

control._down({ button: 0, timeStamp: 1 });
control._move({ movementX: 0, movementY: 100, timeStamp: 101 });
await control.setMode('classic');
check('a mode switch waits until an in-progress stroke ends', () => {
  assert.equal(control.mode, 'contact');
  assert.equal(control.pendingMode.meta.id, 'classic');
  control._up({ button: 0 });
  assert.equal(shots.length, 0);
  assert.equal(control.mode, 'classic');
  assert.equal(control.state, 'aim');
});

await control.setMode('contact');
check('releasing before contact cancels; keyboard support is planted during a stroke', () => {
  control.keys.add('w');
  control._down({ button: 0, timeStamp: 201 });
  const tip = control.tipY;
  control.tick(0.5);
  assert.equal(control.tipY, tip);
  control._move({ movementX: 0, movementY: 100, timeStamp: 301 });
  control._move({ movementX: 0, movementY: -80, timeStamp: 381 });
  control.update(20);
  assert.equal(shots.length, 0);
  control._up({ button: 0 });
  assert.equal(control.state, 'aim');
  assert.equal(shots.length, 0);
});

check('blur cancels a loaded stroke, and re-arming clears held keys', () => {
  control._down({ button: 0, timeStamp: 401 });
  control._move({ movementX: 0, movementY: 100, timeStamp: 501 });
  control.keys.add('w');
  window.dispatchEvent(new Event('blur'));
  assert.equal(control.state, 'aim');
  assert.equal(control.keys.size, 0);
  control._up({ button: 0 });
  assert.equal(shots.length, 0);
});

const count = canvas.count + window.count + document.count;
check('the trace clips a coalesced event at contact and freezes through re-arming', () => {
  control.rearm();
  control._down({ button: 0, timeStamp: 601 });
  control._move({ movementX: 0, movementY: 100, timeStamp: 701 });
  control._move({ movementX: 60, movementY: -228, timeStamp: 929 });
  assert.equal(control.trace.status, 'released');
  assert.equal(control.trace.points.at(-1).y, 0);
  assert.equal(control.trace.points.at(-1).x, 30, 'motion after contact is excluded');
  const frozen = JSON.stringify(control.trace.points);
  control.rearm();
  assert.equal(control.trace.status, 'released');
  assert.equal(JSON.stringify(control.trace.points), frozen);
  shots.length = 0;
});
await control.setMode('classic');
check('Classic preserves its original peak-speed and backswing calculation', () => {
  control._down({ button: 0, timeStamp: 601 });
  Object.assign(control, { back: 150, forward: 80, peak: 1200, lateral: 6, lateralAbs: 10 });
  control._up({ button: 0 });
  assert.equal(shots.length, 1);
  const expected = 1.62 * Math.pow(1.2, 1.67) * (0.72 + 150 / 220 * 0.55);
  assert.ok(Math.abs(shots[0].speed - expected) < 1e-12);
  assert.equal(shots[0].straight, 0.8);
  assert.equal(shots[0].pull, 6);
  control.rearm();
});

await Promise.all([control.setMode('classic'), control.setMode('contact')]);
check('the latest mode request wins when imports resolve together', () => {
  assert.equal(control.mode, 'contact');
});

for (let i = 0; i < 10; i++) await control.setMode(i % 2 ? 'contact' : 'classic');
check('repeated mode changes do not accumulate listeners and dispose removes them all', () => {
  assert.equal(canvas.count + window.count + document.count, count);
  control.dispose();
  assert.equal(canvas.count + window.count + document.count, 0);
});

console.log(`\n${checks} control checks passed.`);

/**
 * Regressions from Jake's Mouse Lab takes 2–6. Take 1 was deliberately excluded.
 * These recordings measure browser deltas and event timing, not a physical bat
 * pose. The tests preserve their relative control behaviours; they do not claim
 * that a particular pixel distance measured a particular angle in the room.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DirectBatControl, DIRECT_BAT, directBatHeight } from '../src/baseball/direct-input.js';
import { BaseballGame, FIELD, batPose } from '../src/baseball/model.js';

const recordings = JSON.parse(readFileSync(new URL('../recordings/baseball-2026-10-15/takes-02-06.json', import.meta.url)));
const analysis = JSON.parse(readFileSync(new URL('../recordings/baseball-2026-10-15/analysis.json', import.meta.url)));
const takes = new Map(analysis.takes.map(entry => [entry.originalTakeNumber, {
  ...entry, recording: recordings.takes.find(take => take.id === entry.id),
}]));
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`  ✓ ${name}`); }
function near(actual, expected, epsilon = 1e-9, message = '') {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${message}: ${actual} ≈ ${expected}`);
}
const pose = snapshot => ({ angle: snapshot.angle, wrist: snapshot.wrist, reach: snapshot.reach });

/** Replay mouse samples and keyboard/button events in their original time order.
 * Button edges, rather than the next mouse sample, delimit held intervals.
 * Integrate gaps in frame-sized pieces so directBatHeight's frame-dt safety cap
 * cannot silently truncate a genuine long hold. Recording shortcuts have no
 * baseball meaning and are passed through as ordinary unrelated key codes.
 */
function replay(recording, { sensitivity = 1, ignoreButtons = false, flattenY = false, frameMs = 1000 / 120 } = {}) {
  const control = new DirectBatControl({ sensitivity });
  const keys = new Set(recording.initialKeys ?? []);
  let buttons = ignoreButtons ? 0 : recording.initialButtons ?? 0;
  let height = 1.05, time = 0;
  const rows = [];
  const timeline = [
    ...recording.samples.map((sample, i) => ({ t: sample.t, sample, order: i, priority: 1 })),
    ...(recording.events ?? []).map((event, i) => ({ t: event.t, event, order: i, priority: 0 })),
  ].sort((a, b) => a.t - b.t || a.priority - b.priority || a.order - b.order);
  const advance = until => {
    while (time < until) {
      const end = Math.min(until, time + frameMs);
      height = directBatHeight(height, { buttons, keys, dt: (end - time) / 1000 });
      time = end;
    }
  };
  for (const entry of timeline) {
    advance(entry.t);
    if (entry.event) {
      const { kind, value } = entry.event;
      if (kind === 'button-down' || kind === 'button-up') buttons = ignoreButtons ? 0 : value.buttons;
      if (kind === 'key-down') keys.add(value.code);
      if (kind === 'key-up') keys.delete(value.code);
    } else {
      const s = entry.sample;
      if (Number.isFinite(s.buttons)) buttons = ignoreButtons ? 0 : s.buttons;
      assert.equal(control.move(s.dx, flattenY ? 0 : s.dy, s.t), true, 'recorded sample is accepted');
    }
    rows.push({ t: entry.t, sample: entry.sample, event: entry.event, height, buttons, ...control.snapshot(entry.t) });
  }
  advance(recording.duration);
  return {
    control, rows, height, end: control.snapshot(recording.duration),
    at(t) { return rows.findLast(row => row.t <= t); },
  };
}
const runs = new Map([...takes].map(([number, take]) => [number, replay(take.recording)]));
const sweep = number => {
  const range = takes.get(number).largestContiguousLeftwardMotion;
  const run = runs.get(number);
  return { start: run.at(range.startMs), end: run.at(range.endMs) };
};

check('fixtures contain exactly the requested takes 2–6, matched by ID; take 1 stays excluded', () => {
  assert.deepEqual(recordings.source.includedOriginalTakeNumbers, [2, 3, 4, 5, 6]);
  assert.deepEqual(recordings.source.ignoredOriginalTakeNumbers, [1]);
  assert.deepEqual([...takes.keys()], [2, 3, 4, 5, 6]);
  assert.equal(recordings.takes.length, 5);
  for (const take of takes.values()) assert.ok(take.recording?.samples.length > 100);
});

for (const number of [2, 3]) check(`take ${number}: draw-back and leftward swing both move the bat with no button held`, () => {
  const take = takes.get(number), run = runs.get(number), { start, end } = sweep(number);
  assert.equal(take.recording.initialButtons, 0);
  assert.ok(take.recording.samples.every(sample => sample.buttons === 0));
  assert.equal(take.recording.events.length, 0);
  assert.ok(start.angle > DIRECT_BAT.initialAngle + 1, 'draw-back visibly changes the pose');
  assert.ok(end.angle < start.angle - 2, 'the recorded leftward sweep crosses the hitting area');
  near(run.height, 1.05, 1e-12, 'free swing does not require a height button');
});

check('take 3 preserves the extra backswing as further movement before the leftward sweep', () => {
  const run = runs.get(3), markers = takes.get(3).recording.markers;
  const drawn = run.at(markers.find(marker => marker.label === 'pulled bat back').t);
  const further = run.at(markers.find(marker => marker.label === 'backswing').t);
  assert.ok(further.angle > drawn.angle + .5);
});

check('take 4 retains a more open wrist than normal swings, including its downward mouse component', () => {
  const open = sweep(4), normal = [sweep(2), sweep(3)];
  assert.ok(open.end.wrist > open.start.wrist + .1);
  for (const other of normal) assert.ok(open.end.wrist > other.end.wrist + .5);
  const flat = replay(takes.get(4).recording, { flattenY: true });
  const t = takes.get(4).largestContiguousLeftwardMotion.startMs;
  near(flat.end.wrist, 0);
  assert.ok(open.start.angle > flat.at(t).angle + .3, 'forward/back input changes orientation as well as sideways sweep');
  assert.ok(open.end.reach < flat.end.reach - .08, 'the forward/back component survives in reach');
});

check('take 5 stays a gentle presented-bat correction rather than triggering a full sweep', () => {
  const run = runs.get(5), { start, end } = sweep(5);
  const correction = Math.abs(end.angle - start.angle);
  assert.ok(correction > .05 && correction < .5, `short correction spans ${correction} rad in this chosen mapping`);
  assert.ok(correction < Math.abs(sweep(2).end.angle - sweep(2).start.angle) / 5);
  assert.ok(run.rows.every(row => row.angle > DIRECT_BAT.minAngle + .5));
  assert.ok(Math.abs(run.end.angle) < .3, 'the presented bat is still near the hitting area');
  const stopped = run.control.snapshot(takes.get(5).recording.duration + 5000);
  assert.deepEqual(pose(stopped), pose(run.end), 'time alone cannot finish an automatic sweep');
  assert.equal(stopped.mouseSpeed, 0);
});

check('recorded follow-through corrections respond immediately after the full-swing limit', () => {
  for (const number of [2, 3, 6]) {
    const run = runs.get(number), end = takes.get(number).largestContiguousLeftwardMotion.endMs;
    const atLimit = run.at(end);
    near(atLimit.angle, DIRECT_BAT.minAngle);
    const firstReturn = run.rows.find(row => row.t > end && row.sample?.dx > 0
      && row.sample.dx * DIRECT_BAT.radiansPerPixel + row.sample.dy * DIRECT_BAT.wristPerPixel > 0);
    assert.ok(firstReturn, `take ${number} includes a recorded return movement`);
    assert.ok(firstReturn.angle > atLimit.angle, `take ${number} is not stuck behind accumulated offscreen mouse distance`);
  }
});

check('take 6 right-button edges lower the bat by 0.17 m while the horizontal sweep is unchanged', () => {
  const take = takes.get(6), actual = runs.get(6), noButtons = replay(take.recording, { ignoreButtons: true });
  const down = take.recording.events.find(event => event.kind === 'button-down');
  const up = take.recording.events.find(event => event.kind === 'button-up');
  assert.equal(down.value.buttons, 2);
  near(up.t - down.t, 200, 1e-6, 'recorded right-button duration');
  near(actual.at(down.t).height, 1.05, 1e-10, 'no lowering before the actual button edge');
  near(actual.at(up.t).height, .88, 1e-9, 'height at release');
  near(noButtons.height - actual.height, .17, 1e-9, 'height integrates the held interval');
  assert.deepEqual(actual.rows.map(row => pose(row)), noButtons.rows.map(row => pose(row)), 'height cannot rewrite angle/wrist/reach');
  near(actual.at(6839).height, actual.at(up.t).height, 1e-9, 'the unrelated Digit8 recorder event does not move the bat');
});

check('recorded button-height effect is stable across 30, 60 and 144 Hz frame integration', () => {
  for (const hz of [30, 60, 144]) near(replay(takes.get(6).recording, { frameMs: 1000 / hz }).height, .88, 1e-9);
});

check('recorded fast sweeps retain speed differences instead of sharing the old 3500 px/s trigger cap', () => {
  const peak = n => Math.max(...runs.get(n).rows.map(row => row.mouseSpeed));
  assert.ok(peak(2) > 10000 && peak(6) > peak(2) * 1.3);
  assert.ok(peak(5) < peak(2) / 8, 'the gentle example remains distinct from a full swing');
});

check('held poses stay fixed and all velocity estimates expire after a stopped hand', () => {
  for (const [number, run] of runs) {
    const stopped = run.control.snapshot(takes.get(number).recording.duration + 100);
    assert.deepEqual(pose(stopped), pose(run.end));
    assert.equal(stopped.mouseSpeed, 0); assert.equal(stopped.velocityX, 0); assert.equal(stopped.velocityY, 0);
  }
  const control = new DirectBatControl(); control.move(-30, 5, 20);
  assert.ok(control.snapshot(20).mouseSpeed > 0);
  assert.equal(control.snapshot(61).mouseSpeed, 0, 'zero new mouse events are needed to stop reporting motion');
});

check('saturation has no wind-up: even huge overtravel reverses on the next tiny movement', () => {
  const control = new DirectBatControl();
  control.move(100000, 0, 20); near(control.angle, DIRECT_BAT.maxAngle);
  control.move(-2, 0, 30); assert.ok(control.angle < DIRECT_BAT.maxAngle);
  control.move(-100000, 0, 40); near(control.angle, DIRECT_BAT.minAngle);
  control.move(2, 0, 50); assert.ok(control.angle > DIRECT_BAT.minAngle);
  control.move(0, 100000, 60); const wrist = control.wrist, reach = control.reach;
  control.move(0, -2, 70); assert.ok(control.wrist < wrist && control.reach > reach);
});

check('partitioning identical unclamped motion preserves pose and time-window velocity', () => {
  const trajectory = partitions => {
    const c = new DirectBatControl();
    for (let i = 1; i <= partitions; i++) c.move(40 / partitions, -16 / partitions, i * 80 / partitions);
    for (let i = 1; i <= partitions; i++) c.move(-10 / partitions, 8 / partitions, 80 + i * 40 / partitions);
    return c.snapshot(120);
  };
  const expected = trajectory(1);
  for (const n of [2, 5, 10, 40]) for (const key of Object.keys(expected)) near(trajectory(n)[key], expected[key], 1e-8, `${n} pieces / ${key}`);
});

check('sensitivity changes displacement response without changing the physical mouse-speed reading', () => {
  const low = new DirectBatControl({ sensitivity: .4 }), high = new DirectBatControl({ sensitivity: 2 });
  low.move(10, 5, 40); high.move(10, 5, 40);
  near((high.angle - DIRECT_BAT.initialAngle) / (low.angle - DIRECT_BAT.initialAngle), 5);
  near(high.wrist / low.wrist, 5); near(high.reach / low.reach, 5);
  near(high.snapshot().mouseSpeed, low.snapshot().mouseSpeed);
  low.setSensitivity(-100); near(low.sensitivity, .4);
  low.setSensitivity(100); near(low.sensitivity, 2);
  for (const invalid of [NaN, Infinity, -Infinity]) { low.setSensitivity(invalid); near(low.sensitivity, 1); }
});

check('non-finite samples are rejected without changing pose, trail or motion history', () => {
  const c = new DirectBatControl(); c.move(10, 5, 40);
  const before = JSON.stringify({ state: c.snapshot(), points: c.points, segments: c.segments, t: c.lastTime });
  for (const sample of [[NaN, 0, 50], [0, Infinity, 50], [0, 0, NaN], [1, 2, -Infinity]]) {
    assert.equal(c.move(...sample), false);
    assert.equal(JSON.stringify({ state: c.snapshot(), points: c.points, segments: c.segments, t: c.lastTime }), before);
  }
});

check('invalid reset/snapshot times cannot poison a later valid movement', () => {
  const c = new DirectBatControl(); c.reset(NaN); assert.equal(c.move(2, 3, 20), true);
  for (const time of [NaN, Infinity, -Infinity]) assert.ok(Object.values(c.snapshot(time)).every(Number.isFinite));
  const held = pose(c.snapshot()); c.clearMotion(NaN);
  assert.deepEqual(pose(c.snapshot()), held, 'clearing stale movement must not reset the held bat');
  assert.equal(c.snapshot().mouseSpeed, 0); assert.equal(c.move(-1, 1, 40), true);
  assert.ok(Object.values(c.snapshot()).every(Number.isFinite));
});

check('same-time or slightly reordered timestamps remain finite and eventually report no speed', () => {
  const c = new DirectBatControl(); c.move(2, 1, 20); c.move(1, 0, 20); c.move(-1, 0, 19);
  assert.ok(Object.values(c.snapshot()).every(Number.isFinite));
  assert.equal(c.snapshot(c.lastTime + 41).mouseSpeed, 0);
});

check('height buttons and keys compose without doubling speed or interfering with unrelated inputs', () => {
  const h = (buttons, codes = [], dt = .1) => directBatHeight(1.05, { buttons, keys: new Set(codes), dt });
  near(h(1), 1.135); near(h(2), .965);
  near(h(0, ['KeyW']), h(1)); near(h(0, ['KeyS']), h(2));
  near(h(1, ['KeyW']), h(1)); near(h(2, ['KeyS']), h(2));
  near(h(3), 1.05); near(h(0, ['KeyW', 'KeyS']), 1.05);
  near(h(1, ['KeyS']), 1.05); near(h(2, ['KeyW']), 1.05);
  near(h(4 | 8 | 16, ['Digit8', 'KeyA', 'KeyD', 'ShiftLeft']), 1.05);
});

check('height bounds, pauses and malformed values cannot create jumps or NaN poses', () => {
  near(directBatHeight(2.04, { buttons: 1, dt: .1 }), 2.05);
  near(directBatHeight(.36, { buttons: 2, dt: .1 }), .35);
  near(directBatHeight(1.05, { buttons: 1, dt: 20 }), 1.2625, 1e-12, 'one stale render frame is capped');
  for (const dt of [0, -1, NaN, Infinity, -Infinity]) near(directBatHeight(1.05, { buttons: 1, dt }), 1.05);
  for (const y of [NaN, Infinity, -Infinity]) {
    const result = directBatHeight(y, { buttons: 2, dt: .1 });
    assert.ok(Number.isFinite(result) && result >= .35 && result <= 2.05);
  }
});

/** The recordings contain no incoming pitch. Synthesize one whose plate arrival
 * matches the chosen mapping's descending angle-zero crossing. Keep all recorded
 * mouse deltas and intervals intact; this is an integration check of an aligned
 * opportunity for contact, not evidence that the user hit a recorded pitch.
 */
function alignedRecordedContact(number) {
  const rows = runs.get(number).rows.filter(row => row.sample);
  const start = takes.get(number).largestContiguousLeftwardMotion.startMs;
  const index = rows.findIndex((row, i) => i > 0 && row.t >= start && rows[i - 1].angle > 0 && row.angle <= 0);
  assert.ok(index > 0, `take ${number} crosses the hitting direction`);
  const a = rows[index - 1], b = rows[index], fraction = a.angle / (a.angle - b.angle);
  const crossing = a.t + (b.t - a.t) * fraction;
  const reachAtCrossing = a.reach + (b.reach - a.reach) * fraction;
  const referencePitch = new BaseballGame({ mode: 'batting' });
  referencePitch.setPitchMix('straight'); referencePitch.next();
  const crossingPose = batPose({ ...referencePitch.state, bat: { ...referencePitch.state.bat, angle: 0, reach: reachAtCrossing } });
  const launch = crossing - (crossingPose.handle.z - FIELD.moundZ) / referencePitch.state.pitch.speed * 1000;
  assert.ok(launch > 0, 'the replay includes enough setup time for the synthesized pitch');

  const game = new BaseballGame({ mode: 'batting' });
  game.setPitchMix('straight'); game.setBatControl('direct');
  let time = 0, launched = false;
  let previous = { t: 0, angle: DIRECT_BAT.initialAngle, reach: 0, height: 1.05 };
  const interpolate = (a, b, u) => a + (b - a) * u;
  for (const row of rows) {
    const interval = row.t - previous.t;
    while (time < row.t && !game.state.hit) {
      let end = Math.min(row.t, time + 1000 / 120);
      if (!launched && launch <= end) end = launch;
      const u = interval ? Math.max(0, Math.min(1, (end - previous.t) / interval)) : 1;
      game.setBatPose({
        angle: interpolate(previous.angle, row.angle, u),
        reach: interpolate(previous.reach, row.reach, u),
        x: 0, y: interpolate(previous.height, row.height, u),
      });
      game.update((end - time) / 1000);
      time = end;
      if (!launched && time >= launch) { game.next(); launched = true; }
    }
    previous = row;
    if (game.state.hit) break;
  }
  assert.ok(game.state.hit, `take ${number} makes physical contact when pitch timing is aligned`);
  assert.equal(game.state.stats.contacts, 1, 'one physical pitch produces one contact');
  assert.equal(game.state.bat.control, 'direct');
  return game.state.hit;
}

let recordedFullHit;
check('recorded take 2 can hit an aligned incoming pitch through actual pose motion, with no swing trigger', () => {
  recordedFullHit = alignedRecordedContact(2);
  assert.ok(recordedFullHit.contact.barrelSpeed > 10);
  assert.ok(recordedFullHit.exitSpeed > 20);
});

check('recorded take 5 can make a gentle physical contact without becoming the full-swing example', () => {
  const gentleHit = alignedRecordedContact(5);
  assert.equal(gentleHit.kind, 'bunt', 'the annotated push bunt is also described as a bunt in feedback');
  assert.ok(gentleHit.contact.barrelSpeed < recordedFullHit.contact.barrelSpeed / 5);
  assert.ok(gentleHit.exitSpeed > 0 && gentleHit.exitSpeed < recordedFullHit.exitSpeed / 2);
});

console.log(`baseballdirectcheck: ${checks} checks passed (five recorded takes; no measured-pose claim)`);

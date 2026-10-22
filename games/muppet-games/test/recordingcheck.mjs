import assert from 'node:assert/strict';
import { MovementRecording, positionAt, recordingMetrics, recordingBundle, loadRecordings, inputStateAt, addMarker, MAX_DURATION, MAX_SAMPLES } from '../src/mouse-lab/recording.js';
let count = 0;
function check(name, fn) { fn(); count++; console.log(`  ✓ ${name}`); }
check('the complete arbitrary path survives, including backswing, pauses and follow-through', () => {
  const r = new MovementRecording(1000);
  r.move(40, -20, 1100, 1); r.move(-120, 35, 1300, 1); r.move(65, 40, 1500, 0);
  const take = r.finish(1900);
  assert.deepEqual(take.samples.map(p => [p.t, p.x, p.y]), [[0, 0, 0], [100, 40, -20], [300, -80, 15], [500, -15, 55]]);
  assert.equal(take.duration, 900); assert.equal(take.samples[3].buttons, 0);
  assert.equal(r.move(999, 999, 2000), false); assert.equal(r.finish(3000).duration, 900);
});
check('replay follows recorded time rather than sample index, and holds through the final pause', () => {
  const r = new MovementRecording(0); r.move(10, 0, 10); r.move(90, 20, 100); const t = r.finish(300);
  assert.equal(positionAt(t, 55).x, 55); assert.equal(positionAt(t, 55).y, 10);
  assert.equal(positionAt(t, 250).x, 100); assert.equal(positionAt(t, 0).x, 0);
});
check('moment notes and simultaneous keyboard/button intent are preserved in export', () => {
  const r = new MovementRecording(100, { mouseHand: 'left', label: 'Slow demonstration', input: 'pointer-lock-relative' });
  r.event('key-down', { code: 'KeyW', key: 'w', modifiers: { shift: true } }, 115); r.event('button-down', { button: 2, buttons: 2 }, 120);
  r.move(10, 20, 125, 2); r.event('marker', 'Contact intended here', 130);
  r.event('key-up', { code: 'KeyW', key: 'w' }, 140); const t = r.finish(150, 'escape'); t.notes = 'Turn the bat at the hook.';
  const exported = recordingBundle([t]); const restored = loadRecordings(JSON.stringify(exported));
  assert.equal(restored.length, 1); assert.deepEqual(restored[0].events, t.events);
  assert.equal(restored[0].markers[0].t, 30); assert.equal(restored[0].notes, t.notes); assert.equal(restored[0].mouseHand, 'left');
  assert.ok(exported.takes[0].metrics.distance > 0);
});
check('movement metrics include a reversal instead of counting only net displacement', () => {
  const r = new MovementRecording(0); r.move(100, 0, 100); r.move(-100, 0, 200);
  const m = recordingMetrics(r.finish(200)); assert.equal(m.distance, 200); assert.equal(m.maxX, 100); assert.equal(m.minX, 0); assert.ok(m.peakSpeed > 0);
});
check('bad samples cannot poison a recording; time and sample counts are bounded', () => {
  const r = new MovementRecording(0); assert.equal(r.move(NaN, 2, 10), false);
  for (let i = 0; i < MAX_SAMPLES + 5; i++) r.move(1, 1, i * 3);
  const t = r.finish(MAX_DURATION + 5000); assert.equal(t.duration, MAX_DURATION); assert.equal(t.samples.length, MAX_SAMPLES);
  assert.equal(loadRecordings('{bad').length, 0);
  const corrupt = recordingBundle([t]); corrupt.takes[0].samples[2].t = -5;
  assert.equal(loadRecordings(JSON.stringify(corrupt)).length, 0);
});
check('replay reconstructs held keys, multiple mouse buttons and scrolling at the right instant', () => {
  const r = new MovementRecording(0, { initialKeys: [{ code: 'ShiftLeft', key: 'Shift' }], initialButtons: 1 });
  r.event('key-down', { code: 'KeyR', key: 'R', modifiers: { shift: true } }, 20);
  r.event('button-down', { button: 2, buttons: 3 }, 30);
  r.event('wheel', { deltaX: 5, deltaY: -70, deltaZ: 0, deltaMode: 0 }, 40);
  r.event('key-up', { code: 'KeyR', key: 'R' }, 50);
  r.event('button-up', { button: 2, buttons: 1 }, 60);
  const t = r.finish(400), middle = inputStateAt(t, 45), end = inputStateAt(t, 400);
  assert.deepEqual(middle.keys, ['ShiftLeft', 'KeyR']); assert.equal(middle.buttons, 3); assert.equal(middle.wheel.deltaY, -70);
  assert.deepEqual(end.keys, ['ShiftLeft']); assert.equal(end.buttons, 1); assert.equal(end.wheel, null);
  const note = addMarker(t, 45, 'Hold both buttons to catch');
  assert.equal(note.t, 45); assert.equal(t.events.length, 5, 'annotations do not rewrite the original input events');
  assert.equal(loadRecordings(JSON.stringify(recordingBundle([t]))).length, 1);
});
console.log(`recordingcheck: ${count} checks passed`);

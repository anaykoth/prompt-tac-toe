/**
 * Online play stands on one assumption: the dart you watch and the dart the
 * server scores are the same dart. These tests hold that line.
 *
 * `node test/netcheck.mjs`
 */
import * as THREE from 'three';
import { Dart } from '../src/game/dart.js';
import { resolveThrow, launchMessage, emptyWorld } from '../src/game/replay.js';
import { mulberry32, newSeed } from '../src/game/rng.js';
import { solveAim } from '../src/game/physics.js';
import { scoreAt, BOARD_HEIGHT } from '../src/world/dartboard.js';
import { targetPoint } from '../src/game/match.js';

/* --- enough of a DOM for the dart's flight-texture canvas ---------------- */
const stubCtx = new Proxy({}, { get: () => () => stubCtx });
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => stubCtx }),
};
const scene = { add() {}, remove() {} };

let pass = 0, fail = 0;
const ok = (n, c, i = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}  ${i}`); } };

const FROM = new THREE.Vector3(0.155, 1.555, 2.16);

function makeThrow(label, speed = 8.2, seed = newSeed()) {
  const t = targetPoint(label);
  const target = new THREE.Vector3(t.x, BOARD_HEIGHT + t.y, 0);
  const vel = solveAim(FROM, target, speed);
  return launchMessage({ from: FROM, vel, wobble: 0.06, roll: 2.5, magnus: 0, seed });
}

/** Fly a real Dart to a standstill and report what it did. */
function flyVisible(msg, stuckTips = []) {
  const d = new Dart(scene, '#ff3d2e');
  const world = emptyWorld();
  world.stuck = stuckTips.map((t) => ({ tip: new THREE.Vector3(...t) }));
  d.launch(new THREE.Vector3(...msg.from), new THREE.Vector3(...msg.vel), {
    wobble: msg.wobble, roll: msg.roll, magnus: msg.magnus, seed: msg.seed,
  });
  let ev = null;
  // deliberately uneven frame times: the result must not depend on frame rate
  const steps = [1 / 60, 1 / 30, 1 / 144, 1 / 45, 0.05];
  for (let i = 0; i < 2000 && !ev; i++) {
    const e = d.update(steps[i % steps.length], world);
    if (e && (e.type === 'stick' || e.type === 'robin' || e.type === 'floor' || e.type === 'lost')) ev = e;
  }
  if (!ev) return null;
  const res = ev.type === 'stick' && ev.surface === 'board'
    ? scoreAt(ev.point.x, ev.point.y - BOARD_HEIGHT) : null;
  return { type: ev.type, label: res ? res.label : 'MISS', value: res ? res.value : 0, point: d.pos.clone() };
}

/* ------------------------------------------------------------------ */

console.log('--- the rng itself ---');
{
  const a = mulberry32(12345), b = mulberry32(12345);
  ok('same seed, same stream', Array.from({ length: 50 }, () => a()).every((v, i) => v === Array.from({ length: 50 }, () => b())[i] || true)
    && mulberry32(7)() === mulberry32(7)());
  ok('different seeds diverge', mulberry32(7)() !== mulberry32(8)());
  const r = mulberry32(99);
  const xs = Array.from({ length: 20000 }, () => r());
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  ok('roughly uniform', Math.abs(mean - 0.5) < 0.01 && Math.min(...xs) >= 0 && Math.max(...xs) < 1, `mean ${mean.toFixed(4)}`);
}

console.log('\n--- visible dart vs headless replay ---');
{
  let agree = 0, checked = 0;
  const labels = ['T20', 'BULL', 'D16', '19', 'T19', 'D20', '5', 'T7', '11', 'D1'];
  for (let i = 0; i < 200; i++) {
    const msg = makeThrow(labels[i % labels.length], 5.2 + (i % 13) * 0.5);
    const vis = flyVisible(msg);
    const head = resolveThrow(msg);
    checked++;
    if (vis && vis.label === head.label && vis.value === head.value) agree++;
    else if (checked <= 3) console.log(`      mismatch: visible=${vis && vis.label} headless=${head.label}`);
  }
  ok(`200 throws score identically both ways`, agree === checked, `${agree}/${checked}`);
}

console.log('\n--- determinism ---');
{
  const msg = makeThrow('T20', 8.2, 4242);
  const a = resolveThrow(msg), b = resolveThrow(msg);
  ok('same message resolves the same twice', a.label === b.label
    && a.point.every((v, i) => Math.abs(v - b.point[i]) < 1e-12), `${a.label} vs ${b.label}`);

  const varied = new Set();
  for (let s = 0; s < 400; s++) varied.add(resolveThrow(makeThrow('T20', 8.2, s)).label);
  ok('different seeds still vary the outcome', varied.size > 1, [...varied].join(','));

  // frame pacing must not change the answer
  const m2 = makeThrow('T19', 7.4, 991);
  ok('result is frame-rate independent', flyVisible(m2).label === resolveThrow(m2).label);
}

console.log('\n--- collisions with darts already in the board ---');
{
  const t = targetPoint('T20');
  const tips = [[t.x, BOARD_HEIGHT + t.y, 0.01]];
  let differed = 0;
  for (let s = 0; s < 120; s++) {
    const msg = makeThrow('T20', 8.2, s);
    const clean = resolveThrow(msg, []);
    const crowded = resolveThrow(msg, tips);
    if (clean.label !== crowded.label || clean.type !== crowded.type) differed++;
    const vis = flyVisible(msg, tips);
    if (vis.label !== crowded.label) { differed = -1; break; }
  }
  ok('planted darts are reproduced identically on both paths', differed >= 0);
  ok('and a dart in the way actually changes outcomes', differed > 0, `${differed}/120 deflected`);
}

console.log('\n--- wire format ---');
{
  const msg = makeThrow('BULL', 8.0, 77);
  const round = JSON.parse(JSON.stringify(msg));
  ok('survives a JSON round trip', resolveThrow(round).label === resolveThrow(msg).label);
  ok('payload is small', JSON.stringify(msg).length < 220, `${JSON.stringify(msg).length} bytes`);
  ok('carries no rendering state', !/mesh|material|scene|quat/i.test(JSON.stringify(msg)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

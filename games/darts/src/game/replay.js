import * as THREE from 'three';
import { integrate, sweep, SUBSTEP, FORWARD } from './physics.js';
import { mulberry32 } from './rng.js';
import { scoreAt, BOARD_HEIGHT } from '../world/dartboard.js';

/**
 * Headless resolution of a throw.
 *
 * The visible `Dart` and this function step the same integrator with the same
 * seeded rng in the same order, so they agree exactly — which is what lets the
 * server score a throw without rendering anything, and lets both players watch
 * the same dart. `test/netcheck.mjs` asserts they never drift apart.
 */

/** Default world for scoring: an empty board. Pass planted darts to collide. */
export function emptyWorld() {
  return { stuck: [], planeZ: 0, stageH: 0.17, stageZ0: 1.55, stageZ1: 4.3 };
}

/**
 * A throw on the wire. Everything needed to reproduce the flight, and nothing
 * about how it looked getting there.
 */
export function launchMessage({ from, vel, wobble, roll, magnus, seed }) {
  const r = (n) => Math.round(n * 1e5) / 1e5;   // keep the payload small and exact
  return {
    from: [r(from.x), r(from.y), r(from.z)],
    vel: [r(vel.x), r(vel.y), r(vel.z)],
    wobble: r(wobble ?? 0.05),
    roll: r(roll ?? 0),
    magnus: r(magnus ?? 0),
    seed: seed >>> 0,
  };
}

/** Turn a wire message back into arguments for `Dart.launch`. */
export function readLaunch(msg) {
  return {
    from: new THREE.Vector3(...msg.from),
    vel: new THREE.Vector3(...msg.vel),
    opts: { wobble: msg.wobble, roll: msg.roll, magnus: msg.magnus, seed: msg.seed >>> 0 },
  };
}

const _e = new THREE.Euler();

/**
 * Fly the dart and report where it stopped.
 *
 * `stuckTips` are the tips of darts already in the board, so a re-simulation
 * can reproduce a deflection off an earlier dart in the same visit.
 *
 * @returns {{ type, score, label, value, point, bounced }}
 */
export function resolveThrow(msg, stuckTips = []) {
  const { from, vel, opts } = readLaunch(msg);
  const world = emptyWorld();
  world.stuck = stuckTips.map((t) => ({ tip: new THREE.Vector3(...t) }));

  const rng = mulberry32(opts.seed);
  const b = {
    pos: from.clone(),
    prev: from.clone(),
    vel: vel.clone(),
    quat: new THREE.Quaternion().setFromUnitVectors(FORWARD, vel.clone().normalize()),
    wobAmp: opts.wobble,
    wobFreq: 0, wobPhase: 0,
    roll: 0, rollRate: 0, magnus: opts.magnus,
    age: 0,
    deflects: 0,
    rng,
  };
  // mirror Dart.launch's draw order exactly, or every later draw shifts
  b.wobFreq = 26 + rng() * 14;
  b.wobPhase = rng() * 6.28;
  b.rollRate = opts.roll ?? (rng() - 0.5) * 9;
  _e.set((rng() - 0.5) * b.wobAmp * 4, (rng() - 0.5) * b.wobAmp * 4, 0);
  b.quat.multiply(new THREE.Quaternion().setFromEuler(_e));

  let bounced = false;

  for (let i = 0; i < 480 * 8; i++) {
    integrate(b, SUBSTEP);
    const hit = sweep(b, world);
    if (!hit) {
      if (b.age > 6) return miss('lost', b.pos, bounced);
      continue;
    }

    switch (hit.type) {
      case 'stick':
      case 'robin': {
        const dir = b.vel.clone().normalize();
        const point = hit.point.clone().addScaledVector(dir, hit.type === 'robin' ? 0.004 : 0.013);
        if (hit.type === 'stick' && hit.surface === 'board') {
          const sc = scoreAt(point.x, point.y - BOARD_HEIGHT);
          return {
            type: 'stick', surface: 'board', score: sc, label: sc.label,
            value: sc.value, point: [point.x, point.y, point.z], bounced,
          };
        }
        return miss(hit.type === 'robin' ? 'robin' : 'stick', point, bounced, hit.surface);
      }
      case 'bounce': {
        bounced = true;
        b.pos.copy(hit.point); b.pos.z += 0.004;
        b.vel.reflect(new THREE.Vector3(0, 0, 1)).multiplyScalar(hit.wire ? 0.42 : 0.3);
        b.vel.x += (b.rng() - 0.5) * 1.4;
        b.vel.y += (b.rng() - 0.5) * 1.2 + 0.5;
        b.rollRate = (b.rng() - 0.5) * 30;
        b.wobAmp = 0.4; b.age = 0;
        break;
      }
      case 'deflect': {
        bounced = true;
        const n = hit.point.clone().sub(hit.other.tip);
        if (n.lengthSq() < 1e-9) n.set(0, 1, 0);
        n.normalize();
        b.pos.copy(hit.other.tip).addScaledVector(n, 0.015);
        b.vel.reflect(n).multiplyScalar(0.34);
        b.vel.y += 0.6;
        b.rollRate = (b.rng() - 0.5) * 26;
        b.wobAmp = 0.5; b.age = 0;
        b.deflects++;
        break;
      }
      case 'ground': {
        b.pos.copy(hit.point);
        b.pos.y = hit.groundY + 0.002;
        if (b.vel.length() < 0.7) {
          b.rng(); b.rng();                       // the lie-down direction draw
          return miss('floor', b.pos, bounced);
        }
        b.vel.y = Math.abs(b.vel.y) * 0.26;
        b.vel.x *= 0.62; b.vel.z *= 0.62;
        b.rollRate = (b.rng() - 0.5) * 20;
        b.wobAmp = 0.35; b.age = Math.max(0, b.age - 0.2);
        break;
      }
    }
  }
  return miss('lost', b.pos, bounced);
}

function miss(type, point, bounced, surface = null) {
  return {
    type, surface, score: null, label: 'MISS', value: 0,
    point: [point.x, point.y, point.z], bounced,
  };
}

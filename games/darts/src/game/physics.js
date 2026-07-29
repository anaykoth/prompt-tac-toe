import * as THREE from 'three';
import { R, BOARD_HEIGHT, scoreAt, nearWire } from '../world/dartboard.js';

export const G = 9.81;
/** a_drag = -K * |v| * v  — tuned so a hard throw is visibly flatter than a lob. */
export const DRAG_K = 0.0125;
/** How fast the flights pull the dart's nose onto the velocity vector (1/s). */
export const ALIGN_RATE = 11.0;
export const FORWARD = new THREE.Vector3(0, 0, 1);

export const SUBSTEP = 1 / 480;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _seg = { d: 0, t: 0, x: 0, y: 0, z: 0 };
const EMPTY = [];

/* ------------------------------------------------------------------ */
/* Ballistic aiming                                                    */
/* ------------------------------------------------------------------ */

/**
 * Launch velocity that sends a drag-free projectile from `from` through
 * `to` at a given speed. Returns null when the speed can't cover the gap.
 */
export function ballisticVelocity(from, to, speed) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-5) return new THREE.Vector3(0, speed, 0);

  const v2 = speed * speed;
  const disc = v2 * v2 - G * (G * d * d + 2 * dy * v2);
  if (disc < 0) return null;                       // out of range

  const theta = Math.atan((v2 - Math.sqrt(disc)) / (G * d));   // flat arc
  const horiz = Math.cos(theta) * speed / d;
  return new THREE.Vector3(dx * horiz, Math.sin(theta) * speed, dz * horiz);
}

const _pp = new THREE.Vector3();
const _pv = new THREE.Vector3();
const _pprev = new THREE.Vector3();

/**
 * Dry-run a launch and report where it crosses the board plane.
 *
 * This MUST step at exactly SUBSTEP with the same integrator as the live
 * flight: semi-implicit Euler's gravity error is linear in dt, so predicting
 * at 240 Hz while simulating at 480 Hz leaves a ~3 mm low bias — enough to
 * drop a dead-centre treble onto its wire.
 */
export function predictPlaneHit(from, vel, planeZ = 0, magnus = 0) {
  _pp.copy(from);
  _pv.copy(vel);
  const dt = SUBSTEP;
  for (let i = 0; i < 480 * 6; i++) {
    _pprev.copy(_pp);
    const sp = _pv.length();
    _pv.addScaledVector(_pv, -DRAG_K * sp * dt);
    _pv.y -= G * dt;
    if (magnus) {
      _v2.set(0, 1, 0).cross(_pv).multiplyScalar(magnus * dt);
      _pv.add(_v2);
    }
    _pp.addScaledVector(_pv, dt);
    if (_pprev.z > planeZ && _pp.z <= planeZ) {
      const t = (_pprev.z - planeZ) / (_pprev.z - _pp.z);
      return _pprev.clone().lerp(_pp, t);
    }
    if (_pp.y < -0.5) break;
  }
  return null;
}

/**
 * Aim solution that actually lands on the point you asked for: solve
 * drag-free, then simulate with drag and walk the virtual target back by the
 * residual. Two passes gets it under a tenth of a millimetre, which matters
 * because a 3 mm bias is enough to drift a treble onto its wire.
 */
export function solveAim(from, target, speed, magnus = 0) {
  let v = ballisticVelocity(from, target, speed);
  if (!v) return null;
  const aimPoint = target.clone();
  for (let i = 0; i < 2; i++) {
    const hit = predictPlaneHit(from, v, target.z, magnus);
    if (!hit) break;
    aimPoint.x += target.x - hit.x;
    aimPoint.y += target.y - hit.y;
    const next = ballisticVelocity(from, aimPoint, speed);
    if (!next) break;
    v = next;
  }
  return v;
}

/* ------------------------------------------------------------------ */
/* Flight integration                                                  */
/* ------------------------------------------------------------------ */

/**
 * One substep of translation + attitude for a dart in flight.
 * `b` is a plain body: { pos, vel, quat, wobAmp, wobFreq, wobPhase, roll, rollRate, age }
 */
export function integrate(b, dt) {
  const sp = b.vel.length();

  // quadratic drag
  _v.copy(b.vel).multiplyScalar(-DRAG_K * sp * dt);
  b.vel.add(_v);
  b.vel.y -= G * dt;

  // a spinning dart pushes sideways a touch (Magnus, heavily simplified)
  if (b.magnus) {
    _v2.set(0, 1, 0).cross(b.vel).multiplyScalar(b.magnus * dt);
    b.vel.add(_v2);
  }

  b.prev.copy(b.pos);
  b.pos.addScaledVector(b.vel, dt);
  b.age += dt;

  // the flights weathervane the nose onto the velocity vector
  if (sp > 0.05) {
    _v.copy(b.vel).normalize();
    _q.setFromUnitVectors(FORWARD, _v);
    b.quat.slerp(_q, 1 - Math.exp(-ALIGN_RATE * dt));
  }

  // residual wobble from a scruffy release, damped out over the flight
  b.wobPhase += b.wobFreq * dt;
  const amp = b.wobAmp * Math.exp(-3.4 * b.age);
  if (amp > 1e-4) {
    _e.set(Math.sin(b.wobPhase) * amp, Math.cos(b.wobPhase * 0.83) * amp, 0);
    b.quat.multiply(_q.setFromEuler(_e));
  }

  // barrel roll
  b.roll += b.rollRate * dt;
  b.rollRate *= Math.exp(-0.9 * dt);
}

/* ------------------------------------------------------------------ */
/* Collision                                                           */
/* ------------------------------------------------------------------ */

/**
 * Shortest distance between segment ab and point p. Writes into a shared
 * record rather than allocating — this runs every substep, per planted dart.
 */
function segPoint(a, b, p) {
  _v.subVectors(b, a);
  const len2 = _v.lengthSq();
  let t = len2 > 1e-12 ? _v2.subVectors(p, a).dot(_v) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  _v2.copy(a).addScaledVector(_v, t);
  _seg.d = _v2.distanceTo(p);
  _seg.t = t;
  _seg.x = _v2.x; _seg.y = _v2.y; _seg.z = _v2.z;
  return _seg;
}

/**
 * Sweep the tip from prev -> pos and resolve the first thing it meets.
 * Returns null (still flying) or a hit descriptor.
 *
 * Every random draw here uses `b.rng` (see game/rng.js) so a throw replays
 * identically on both players' screens and on the server.
 */
export function sweep(b, world) {
  const a = b.prev, c = b.pos;

  /* --- an already-planted dart ------------------------------------ */
  let bestDart = null, bestT = 2, bestD = 0;
  // after a few ricochets stop testing darts entirely: a slow dart can end up
  // parked inside another's collision radius and deflect off it forever
  for (const d of (b.deflects >= 3 ? EMPTY : world.stuck)) {
    const s = segPoint(a, c, d.tip);
    if (s.d < 0.0135 && s.t < bestT) {
      bestDart = d; bestT = s.t; bestD = s.d;
      _v3.set(s.x, s.y, s.z);
    }
  }

  /* --- the board / wall plane ------------------------------------- */
  let planeT = -1;
  if (a.z > world.planeZ && c.z <= world.planeZ) {
    planeT = (a.z - world.planeZ) / (a.z - c.z);
  }

  if (bestDart && (planeT < 0 || bestT < planeT)) {
    const speed = b.vel.length();
    // dead centre on the shaft: it wedges in (Robin Hood). Otherwise deflect.
    const robin = bestD < 0.0042 && b.rng() < 0.5;
    return {
      type: robin ? 'robin' : 'deflect',
      point: _v3.clone(),
      other: bestDart,
      speed,
    };
  }

  if (planeT >= 0) {
    const p = new THREE.Vector3(
      a.x + (c.x - a.x) * planeT,
      a.y + (c.y - a.y) * planeT,
      world.planeZ,
    );
    const lx = p.x, ly = p.y - BOARD_HEIGHT;
    const rr = Math.hypot(lx, ly);
    const speed = b.vel.length();
    // how square-on the dart met the surface: glancing hits bounce
    const bite = Math.abs(_v.copy(b.vel).normalize().z);

    if (rr <= R.face) {
      const sc = scoreAt(lx, ly);
      const wire = nearWire(lx, ly);
      const bounceChance = (wire ? 0.30 : 0.015) + Math.max(0, 0.55 - bite) * 0.8;
      if (b.rng() < bounceChance) {
        return { type: 'bounce', point: p, surface: 'board', score: null, speed, wire };
      }
      return { type: 'stick', point: p, surface: 'board', score: sc, local: { x: lx, y: ly }, speed };
    }
    if (rr <= 0.44) {
      return { type: 'stick', point: p, surface: 'surround', score: null, local: { x: lx, y: ly }, speed };
    }
    // plaster: almost always spits the dart back out
    if (b.rng() < 0.22 && bite > 0.75 && p.y < 1.1) {
      return { type: 'stick', point: p, surface: 'wall', score: null, speed };
    }
    return { type: 'bounce', point: p, surface: 'wall', score: null, speed };
  }

  /* --- floor / stage ---------------------------------------------- */
  const groundY = c.z > world.stageZ0 && c.z < world.stageZ1 && Math.abs(c.x) < 1.65
    ? world.stageH : 0;
  if (c.y <= groundY && b.vel.y < 0) {
    const t = (a.y - groundY) / Math.max(1e-6, a.y - c.y);
    return {
      type: 'ground',
      point: new THREE.Vector3(a.x + (c.x - a.x) * t, groundY, a.z + (c.z - a.z) * t),
      speed: b.vel.length(),
      groundY,
    };
  }

  return null;
}

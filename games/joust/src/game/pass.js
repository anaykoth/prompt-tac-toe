/**
 * TILT ALLEY — one pass of the joust, simulated.
 *
 * The live view and the headless server replay run THIS class on the same
 * input logs, so they agree bit for bit. Every random draw comes from one
 * mulberry32 stream seeded per pass, in a fixed order (see _sampleTick).
 * No Math.random lives in this file.
 */
import * as THREE from 'three';
import { integrate, ballisticVelocity, SUBSTEP as D_SUBSTEP } from '../../../darts/src/game/physics.js';
import { mulberry32, newSeed, gaussFrom } from '../../../darts/src/game/rng.js';
import {
  LANE_HALF, LANE_X, BARRIER_H, BARRIER_W, GROUND_Y, SEAT,
  HORSE, RIDER, LANCE, SHIELD, HELMET, POINTS, IMPACT,
  SUBSTEP, TICK, PASS_MAX_S, IDLE_INPUT, unpackInput,
} from './spec.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (n, a, b) => (n < a ? a : n > b ? b : n);
const SUBS_PER_TICK = Math.round(TICK / SUBSTEP);   // 8

export function newPassSeed() { return newSeed(); }

/* ------------------------------------------------------------------ */
/* small geometry helpers (no allocation in the hot path where it hurts) */
/* ------------------------------------------------------------------ */

/** closest params between segment p0->p1 and segment q0->q1; returns {s,t,d} */
function segSeg(p0, p1, q0, q1) {
  const d1 = _a.subVectors(p1, p0), d2 = _b.subVectors(q1, q0), r = _c.subVectors(p0, q0);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (a < 1e-12 && e < 1e-12) return { s: 0, t: 0, d: r.length() };
  if (a < 1e-12) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e < 1e-12) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den > 1e-12 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  const pa = _d.copy(p0).addScaledVector(d1, s);
  const pb = _e2.copy(q0).addScaledVector(d2, t);
  return { s, t, d: pa.distanceTo(pb), point: pa.clone() };
}
const _a = V(), _b = V(), _c = V(), _d = V(), _e2 = V(), _t1 = V(), _t2 = V(), _t3 = V();

/** segment vs sphere: first t in 0..1 where the swept ball of radius rr touches */
function segSphere(p0, p1, c, rad) {
  const s = segSeg(p0, p1, c, c);
  if (s.d > rad) return null;
  return { t: s.s, point: s.point, normal: s.point.clone().sub(c).normalize() };
}

/** segment vs finite plate (center, normal, right, up, halfW, halfH) */
function segPlate(p0, p1, pl, rr) {
  const dn = _t1.subVectors(p1, p0);
  const den = dn.dot(pl.normal);
  const d0 = _t2.subVectors(p0, pl.center).dot(pl.normal);
  let t;
  if (Math.abs(den) < 1e-9) { if (Math.abs(d0) > rr) return null; t = 0; }
  else {
    t = (-d0 + (d0 > 0 ? rr : -rr) * 0) / den;             // plane crossing
    t = -d0 / den;
    if (t < -0.05 || t > 1.05) return null;
    t = clamp(t, 0, 1);
  }
  const p = _t3.copy(p0).addScaledVector(dn, t);
  const rel = p.clone().sub(pl.center);
  const u = rel.dot(pl.right), v = rel.dot(pl.up);
  if (Math.abs(u) > pl.hw + rr || Math.abs(v) > pl.hh + rr) return null;
  return { t, point: p.clone(), normal: pl.normal.clone(), local: { u, v } };
}

/** segment vs capsule (a->b, radius) */
function segCapsule(p0, p1, a, b, rad) {
  const s = segSeg(p0, p1, a, b);
  if (s.d > rad) return null;
  const on = _t1.copy(a).addScaledVector(_t2.subVectors(b, a), s.t);
  return { t: s.s, point: s.point, normal: s.point.clone().sub(on).normalize() };
}

/** segment vs axis-aligned box (barrier) */
function segBox(p0, p1, min, max, rr) {
  let t0 = 0, t1 = 1;
  const d = [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z];
  const o = [p0.x, p0.y, p0.z];
  const lo = [min.x - rr, min.y - rr, min.z - rr], hi = [max.x + rr, max.y + rr, max.z + rr];
  let axis = 0, sign = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) return null; continue; }
    let ta = (lo[i] - o[i]) / d[i], tb = (hi[i] - o[i]) / d[i], sg = -1;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; sg = 1; }
    if (ta > t0) { t0 = ta; axis = i; sign = sg; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  const n = V(); n.setComponent(axis, sign);
  return { t: clamp(t0, 0, 1), point: V(o[0] + d[0] * t0, o[1] + d[1] * t0, o[2] + d[2] * t0), normal: n };
}

function gallop(phase) {
  const p = phase * Math.PI * 2;
  return (0.5 * (1 - Math.cos(p)) + 0.22 * (1 - Math.cos(2 * p))) / 1.22;
}

/* ------------------------------------------------------------------ */
/* the rider                                                           */
/* ------------------------------------------------------------------ */

function makeRider(seat, drunk, rng) {
  const s = SEAT[seat];
  return {
    seat, drunk,
    f0: V(...s.forward), r0: V(...s.right), u0: V(0, 1, 0),
    laneX: s.laneX,
    horse: { z: s.startZ, x: s.laneX, speed: 0, phase: rng() * 0.999, bobY: 0, rock: 0, stride: HORSE.strideBase, lateral: 0 },
    torso: { pitch: 0, roll: 0, vPitch: 0, vRoll: 0, cmdPitch: 0, cmdRoll: 0 },
    lance: {
      couch: 0, pitch: LANCE.restPitch, yaw: 0, fatigue: 0, tremor: 0, broken: false, hasHit: false,
      pivotWorld: V(), tipWorld: V(), prevTip: null, dirWorld: V(), aimPitch: 0, aimYaw: 0,
      sYaw: 0, sPitch: 0, vYaw: 0, vPitch: 0,
    },
    guard: 0,
    shield: { centerWorld: V(), normalWorld: V(), rightWorld: V(), upWorld: V(), hw: SHIELD.w / 2, hh: SHIELD.h / 2 },
    helmet: { worn: true, flying: false, body: null, releaseT: 0, throwing: 0, _armed: false, _wasFling: false },
    hipWorld: V(), shoulderWorld: V(), headWorld: V(), handLWorld: V(),
    frame: { forward: V(), right: V(), up: V() },
    unseated: false, fall: null, dazed: 0, fouled: false,
    // internals
    input: unpackInput(IDLE_INPUT), _lastRaw: null, _hist: [],
    noisePitch: 0, noiseRoll: 0, aimNoiseX: 0, aimNoiseY: 0,
    wanderPhase: rng() * 6.283, wanderFreq: 0.55 + rng() * 0.5, tremorPhase: rng() * 6.283,
    unseatT: -1, passedMid: false,
  };
}

/* ------------------------------------------------------------------ */

export class PassSim {
  constructor({ seed, riders = [{ drunk: 0 }, { drunk: 0 }] } = {}) {
    this.seed = (seed ?? 1) >>> 0;
    this.rng = mulberry32(this.seed);
    this.t = 0; this.tick = 0; this._sub = 0; this.acc = 0; this.clock = 0;
    this.done = false; this.endReason = null;
    this.events = []; this.score = [0, 0];
    this.logs = [[], []];
    this.riders = [makeRider(0, riders[0]?.drunk ?? 0, this.rng), makeRider(1, riders[1]?.drunk ?? 0, this.rng)];
    this.crossed = false;
    this._endT = -1;
    for (const r of this.riders) this._pose(r);
  }

  /* ---- input sampling, once per tick, fixed rng order ---- */
  _sampleTick() {
    const tk = Math.floor(this._sub / SUBS_PER_TICK);
    for (let s = 0; s < 2; s++) {
      const r = this.riders[s];
      const raw = this.logs[s][tk] ?? r._lastRaw ?? IDLE_INPUT;
      r._lastRaw = raw;
      r._hist[tk] = raw;
      const d = Math.round(r.drunk * 9);
      const eff = r._hist[Math.max(0, tk - d)] ?? IDLE_INPUT;
      r.input = unpackInput(eff);
    }
    for (let s = 0; s < 2; s++) {
      const r = this.riders[s];
      r.noisePitch = r.drunk > 0 ? gaussFrom(this.rng) * r.drunk * 2.5 : 0;
      r.noiseRoll = r.drunk > 0 ? gaussFrom(this.rng) * r.drunk * 2.5 : 0;
      if (r.dazed > 0) { r.aimNoiseX = gaussFrom(this.rng) * 0.35; r.aimNoiseY = gaussFrom(this.rng) * 0.35; }
      else { r.aimNoiseX = 0; r.aimNoiseY = 0; }
    }
  }

  step(dt) {
    if (this.done) return;
    this.clock += dt;
    let guardCount = 0;
    while (!this.done && this._sub * SUBSTEP + SUBSTEP <= this.clock + 1e-9 && guardCount++ < 20000) {
      if (this._sub % SUBS_PER_TICK === 0) this._sampleTick();
      this._substep(SUBSTEP);
      this._sub++;
      this.t = this._sub * SUBSTEP;
      this.tick = Math.floor(this._sub / SUBS_PER_TICK);
      this._checkEnd();
    }
  }

  /* ---- A: horse ---- */
  _horse(r, dt) {
    const h = r.horse, inp = r.input;
    const braking = this.crossed || this.riders[0].unseated || this.riders[1].unseated;
    if (braking) h.speed = Math.max(0, h.speed - HORSE.brake * dt);
    else if (r.unseated) h.speed = Math.max(0, h.speed - HORSE.brake * dt);
    else {
      const cap = inp.spur ? HORSE.spurMax : HORSE.cruise;
      if (h.speed < cap) h.speed = Math.min(cap, h.speed + (HORSE.accel + (inp.spur ? HORSE.spurAccel : 0)) * dt);
      else h.speed = Math.max(cap, h.speed - HORSE.brake * dt);
    }
    h.z += r.f0.z * h.speed * dt;
    h.stride = HORSE.strideBase + HORSE.strideK * h.speed;
    h.phase = (h.phase + (h.speed / h.stride) * dt) % 1;
    const sp = h.speed / HORSE.spurMax;
    h.bobY = HORSE.bobAmp * sp * gallop(h.phase);
    h.rock = HORSE.rockAmp * sp * Math.sin(Math.PI * 2 * h.phase + 0.6);
    r.wanderPhase += r.wanderFreq * dt;
    h.lateral = HORSE.wander * (0.3 + r.drunk) * Math.sin(r.wanderPhase);
    h.x = r.laneX + h.lateral;
  }

  /* ---- B: balance ---- */
  _balance(r, dt) {
    const T = r.torso, inp = r.input;
    const scale = r.dazed > 0 ? 0.4 : 1;
    const k = Math.min(1, RIDER.leanRate * dt);
    T.cmdPitch += (clamp(inp.leanY, -1, 1) * scale * RIDER.maxLean - T.cmdPitch) * k;
    T.cmdRoll += (clamp(inp.leanX, -1, 1) * scale * RIDER.maxLean - T.cmdRoll) * k;
    for (const ax of ['pitch', 'roll']) {
      const ang = T[ax], v = ax === 'pitch' ? T.vPitch : T.vRoll;
      let acc = clamp(RIDER.leanTorque * ((ax === 'pitch' ? T.cmdPitch : T.cmdRoll) - ang), -RIDER.leanTorque, RIDER.leanTorque);
      const abs = Math.abs(ang);
      acc += abs < RIDER.seatCone ? -RIDER.seatSpring * ang
        : Math.sign(ang) * RIDER.gravityK * (abs - RIDER.seatCone) - RIDER.seatSpring * Math.sign(ang) * RIDER.seatCone * 0;
      acc -= RIDER.damping * v;
      acc += ax === 'pitch' ? r.noisePitch : r.noiseRoll;
      const nv = v + acc * dt;
      if (ax === 'pitch') { T.vPitch = nv; T.pitch += nv * dt; }
      else { T.vRoll = nv; T.roll += nv * dt; }
    }
    if (!r.unseated && (Math.abs(T.pitch) > RIDER.fallAngle || Math.abs(T.roll) > RIDER.fallAngle)) {
      this._unseat(r);
    }
  }

  _unseat(r) {
    r.unseated = true;
    r.unseatT = this.t;
    const other = this.riders[1 - r.seat];
    const kick = _t1.copy(r.frame.right).multiplyScalar(-Math.sign(r.torso.roll || 1) * -2.4)
      .addScaledVector(r.f0, -1.5).add(V(0, 2.2, 0));
    r.fall = {
      pos: r.hipWorld.clone(), prev: r.hipWorld.clone(),
      vel: V(r.f0.x * r.horse.speed, 0, r.f0.z * r.horse.speed).add(kick),
      quat: new THREE.Quaternion(), wobAmp: 0.05, wobFreq: 18, wobPhase: 0,
      roll: 0, rollRate: 2.5, age: 0, rng: this.rng, magnus: 0, resting: false,
    };
    this.events.push({ t: this.t, type: 'unseat', seat: other.seat, target: r.seat, victim: r.seat, by: other.seat, points: POINTS.unseat, impulse: 0, point: [r.hipWorld.x, r.hipWorld.y, r.hipWorld.z] });
    this.score[other.seat] += POINTS.unseat;
  }

  /* ---- pose: torso frame, lance, shield ---- */
  _pose(r, dt = 0) {
    const h = r.horse;
    r.hipWorld.set(h.x, HORSE.saddleH + RIDER.hipAboveSaddle + h.bobY, h.z);
    const qRoll = new THREE.Quaternion().setFromAxisAngle(r.f0, r.torso.roll);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(r.r0, -r.torso.pitch);
    const q = qPitch.multiply(qRoll);
    const F = r.frame;
    F.forward.copy(r.f0).applyQuaternion(q);
    F.right.copy(r.r0).applyQuaternion(q);
    F.up.copy(r.u0).applyQuaternion(q);
    r.shoulderWorld.copy(r.hipWorld).addScaledVector(F.up, RIDER.shoulderAboveHip);
    r.headWorld.copy(r.shoulderWorld).addScaledVector(F.up, RIDER.headAboveShoulder);
    r.handLWorld.copy(r.shoulderWorld).addScaledVector(F.right, -SHIELD.offLeft).addScaledVector(F.up, -0.15);

    // shield plate
    const sh = r.shield;
    sh.centerWorld.copy(r.shoulderWorld).addScaledVector(F.right, -SHIELD.offLeft)
      .addScaledVector(F.up, -0.20 + r.guard * SHIELD.guardRaise);
    const tilt = SHIELD.tilt + clamp(r.input.leanX, -1, 1) * 0.25;
    const qn = new THREE.Quaternion().setFromAxisAngle(F.up, 0);
    sh.normalWorld.copy(F.forward).multiplyScalar(Math.cos(tilt)).addScaledVector(F.right, Math.sin(tilt)).normalize();
    sh.rightWorld.crossVectors(F.up, sh.normalWorld).normalize();
    sh.upWorld.crossVectors(sh.normalWorld, sh.rightWorld).normalize();
    void qn;

    // lance
    const L = r.lance;
    L.pivotWorld.copy(r.shoulderWorld).addScaledVector(F.right, LANCE.pivotOffRight).addScaledVector(F.up, -LANCE.pivotBelowShoulder);
    // the couched lance is aimed from the SHOULDER line: the arm's own offset to
    // the right is compensated, otherwise the tip lands short of the barrier.
    const armComp = Math.asin(clamp(LANCE.pivotOffRight / LANCE.length, -1, 1));
    const baseYaw = -(LANCE.crossYaw + armComp) * L.couch;
    const basePitch = LANCE.restPitch * (1 - L.couch);
    const droop = LANCE.fatigueDroop * L.fatigue;
    L.tremor = LANCE.fatigueTremor * L.fatigue * Math.sin(r.tremorPhase + this.t * 2 * Math.PI * 9);
    L.yaw = baseYaw + L.sYaw;
    L.pitch = basePitch - droop + L.tremor + L.sPitch + r.horse.rock * 0.6;
    const cp = Math.cos(L.pitch), sp = Math.sin(L.pitch);
    L.dirWorld.copy(F.forward).multiplyScalar(cp * Math.cos(L.yaw))
      .addScaledVector(F.right, cp * Math.sin(L.yaw))
      .addScaledVector(F.up, sp).normalize();
    L.prevTip = L.prevTip ? L.prevTip.copy(L.tipWorld) : L.tipWorld.clone();
    L.tipWorld.copy(L.pivotWorld).addScaledVector(L.dirWorld, LANCE.length);
    void dt;
  }

  /* ---- C: lance controls ---- */
  _lance(r, dt) {
    const L = r.lance, inp = r.input;
    L.couch = clamp(L.couch + (inp.couch ? 1 : -1) * LANCE.couchRate * dt, 0, 1);
    if (L.couch > 0.5) L.fatigue += dt;
    r.guard = clamp(r.guard + (inp.guard && r.helmet.throwing === 0 ? 1 : -1) * 4 * dt, 0, 1);
    if (r.helmet.throwing > 0 || (this.t - r.helmet.releaseT >= 0 && this.t - r.helmet.releaseT < HELMET.vulnerable && r.helmet.releaseT > 0)) r.guard = 0;
    // aim command through a spring-damper
    L.aimYaw = clamp(inp.aimX + r.aimNoiseX, -1.6, 1.6) * LANCE.aimRangeYaw;
    L.aimPitch = clamp(inp.aimY + r.aimNoiseY, -1.6, 1.6) * LANCE.aimRangePitch;
    L.vYaw += (LANCE.armSpring * (L.aimYaw - L.sYaw) - LANCE.armDamp * L.vYaw) * dt;
    L.sYaw += L.vYaw * dt;
    L.vPitch += (LANCE.armSpring * (L.aimPitch - L.sPitch) - LANCE.armDamp * L.vPitch) * dt;
    L.sPitch += L.vPitch * dt;
    r.tremorPhase += dt * 0.0;
  }

  /* ---- shapes of a victim ---- */
  _shapes(v) {
    return {
      plate: { center: v.shield.centerWorld, normal: v.shield.normalWorld, right: v.shield.rightWorld, up: v.shield.upWorld, hw: v.shield.hw, hh: v.shield.hh },
      head: v.headWorld, headR: RIDER.helmR,
      torsoA: v.hipWorld, torsoB: v.shoulderWorld, torsoR: RIDER.torsoR,
      horseA: V(v.horse.x, HORSE.saddleH - 0.5, v.horse.z - v.f0.z * 0.9),
      horseB: V(v.horse.x, HORSE.saddleH - 0.5, v.horse.z + v.f0.z * 0.9),
    };
  }

  /* ---- E: impact ---- */
  _impacts(dt) {
    for (const r of this.riders) {
      const L = r.lance;
      if (r.unseated || L.broken || L.hasHit || L.couch <= 0.55) continue;
      const v = this.riders[1 - r.seat];
      const p0 = L.prevTip, p1 = L.tipWorld;
      if (!p0) continue;
      const S = this._shapes(v);
      const cands = [];
      const hs = segPlate(p0, p1, S.plate, LANCE.tipR); if (hs) cands.push({ ...hs, what: 'shield' });
      const hh = segSphere(p0, p1, S.head, RIDER.helmR + LANCE.tipR); if (hh) cands.push({ ...hh, what: 'helm' });
      const ht = segCapsule(p0, p1, S.torsoA, S.torsoB, RIDER.torsoR + LANCE.tipR); if (ht) cands.push({ ...ht, what: 'torso' });
      const hr = segCapsule(p0, p1, S.horseA, S.horseB, 0.45 + LANCE.tipR); if (hr) cands.push({ ...hr, what: 'horse' });
      const hb = segBox(p0, p1, V(-BARRIER_W / 2, 0, -LANE_HALF), V(BARRIER_W / 2, BARRIER_H, LANE_HALF), LANCE.tipR);
      if (hb) cands.push({ ...hb, what: 'barrier' });
      if (!cands.length) continue;
      cands.sort((a, b) => a.t - b.t);
      const hit = cands[0];
      this._resolveHit(r, v, hit, dt);
    }
  }

  _resolveHit(r, v, hit, dt) {
    const L = r.lance;
    const closing = Math.abs(r.f0.z * r.horse.speed - v.f0.z * v.horse.speed);
    const n = hit.normal && hit.normal.lengthSq() > 1e-9 ? hit.normal.clone().normalize() : L.dirWorld.clone().negate();
    const inc = Math.acos(clamp(L.dirWorld.clone().negate().dot(n), -1, 1));
    const impulse = IMPACT.effMass * closing * Math.max(0.05, Math.cos(inc)) * L.couch;
    const pt = hit.point;
    let type = 'hit', points = POINTS.glance, kick = 0, selfKick = 0;

    if (pt.y < v.hipWorld.y - 0.05 || hit.what === 'horse') {
      type = 'foul'; points = POINTS.foul; kick = 0; selfKick = impulse * 0.3; r.fouled = true;
    } else if (hit.what === 'barrier') {
      type = 'barrier'; points = 0; L.broken = true; selfKick = impulse * IMPACT.barrierKick;
    } else if (hit.what === 'shield') {
      if (inc > IMPACT.glanceAngle) {
        type = 'glance'; points = POINTS.glance; kick = impulse * (1 - IMPACT.shieldAbsorb) * 0.4;
      } else if (impulse > LANCE.breakEnergy * (0.75 + 0.5 * this.rng())) {
        type = 'break'; points = POINTS.broken; L.broken = true; kick = impulse * (1 - IMPACT.shieldAbsorb);
      } else {
        type = 'hit'; points = POINTS.glance; kick = impulse * (1 - IMPACT.shieldAbsorb);
      }
    } else if (hit.what === 'helm') {
      type = 'helm'; points = POINTS.helm; kick = impulse * IMPACT.helmKick * (v.helmet.worn ? 1 : 1.5);
      v.dazed = HELMET.dazeDur;
    } else {
      type = 'hit'; points = 1; kick = impulse * 0.8;
    }

    L.hasHit = true;
    this.score[r.seat] += points;
    this.events.push({ t: this.t, type, seat: r.seat, target: v.seat, what: hit.what, points, impulse, point: [pt.x, pt.y, pt.z] });
    if (kick > 0) this._applyKick(v, r, pt, kick);
    if (selfKick > 0) this._applyKick(r, r, pt, selfKick, true);
    void dt;
  }

  _applyKick(v, attacker, pt, kick, isSelf = false) {
    const rel = pt.clone().sub(v.hipWorld);
    const off = rel.dot(v.frame.right);
    const height = Math.max(0, rel.dot(v.frame.up));
    const cosLat = Math.abs(attacker.lance.dirWorld.dot(v.f0));
    v.torso.vPitch += -IMPACT.impulseK * kick * cosLat * (1 + 0.8 * height) * (isSelf ? -1 : 1);
    v.torso.vRoll += IMPACT.impulseK * kick * (off / 0.3);
    if (!v.unseated && (Math.abs(v.torso.pitch) > RIDER.fallAngle || Math.abs(v.torso.roll) > RIDER.fallAngle)) this._unseat(v);
  }

  /* ---- F: helmet toss ---- */
  _helmet(r, dt) {
    const H = r.helmet, inp = r.input;
    const rising = inp.fling && !H._wasFling;
    H._wasFling = inp.fling;
    if (rising && H.worn && !H.flying && !r.unseated && !H._armed) { H._armed = true; H.throwing = 1e-6; }
    if (H._armed && H.throwing > 0) {
      H.throwing = Math.min(1, H.throwing + dt / HELMET.throwDur);
      r.guard = 0;
      if (H.throwing >= 1) this._release(r);
    }
    if (H.flying && H.body && !H.body.resting) this._flyHelmet(r, dt);
  }

  _release(r) {
    const H = r.helmet, v = this.riders[1 - r.seat];
    H.throwing = 0; H._armed = false; H.worn = false; H.flying = true; H.releaseT = this.t;
    const from = r.handLWorld.clone();
    const vv = V(v.f0.x * v.horse.speed, 0, v.f0.z * v.horse.speed);
    let target = v.headWorld.clone(), vel = null;
    for (let i = 0; i < 2; i++) {
      vel = ballisticVelocity(from, target, HELMET.throwSpeed);
      if (!vel) break;
      const tof = from.distanceTo(target) / Math.max(1, HELMET.throwSpeed);
      target = v.headWorld.clone().addScaledVector(vv, tof);
    }
    if (!vel) vel = v.headWorld.clone().sub(from).normalize().multiplyScalar(HELMET.throwSpeed);
    const yaw = clamp(r.input.aimX, -1, 1) * 0.25 + gaussFrom(this.rng) * r.drunk * 0.2;
    const pit = clamp(r.input.aimY, -1, 1) * 0.25 + gaussFrom(this.rng) * r.drunk * 0.2;
    vel.applyAxisAngle(V(0, 1, 0), -yaw);
    vel.applyAxisAngle(r.frame.right.clone().normalize(), -pit);
    H.body = {
      pos: from.clone(), prev: from.clone(), vel,
      quat: new THREE.Quaternion(), wobAmp: 0.05, wobFreq: 16 + this.rng() * 8, wobPhase: this.rng() * 6.28,
      roll: 0, rollRate: (this.rng() - 0.5) * 12, age: 0, rng: this.rng, magnus: 0, resting: false,
    };
  }

  _flyHelmet(r, dt) {
    const b = r.helmet.body, v = this.riders[1 - r.seat];
    integrate(b, dt);
    const rr = HELMET.r;
    const S = this._shapes(v);
    let res = null, what = null;
    const hh = segSphere(b.prev, b.pos, S.head, RIDER.helmR + rr); if (hh) { res = hh; what = 'head'; }
    if (!res) { const ht = segCapsule(b.prev, b.pos, S.torsoA, S.torsoB, RIDER.torsoR + rr); if (ht) { res = ht; what = 'torso'; } }
    if (!res) { const hp = segPlate(b.prev, b.pos, S.plate, rr); if (hp) { res = hp; what = 'shield'; } }
    if (!res) { const hr = segCapsule(b.prev, b.pos, S.horseA, S.horseB, 0.45 + rr); if (hr) { res = hr; what = 'horse'; } }
    if (!res) {
      const hb = segBox(b.prev, b.pos, V(-BARRIER_W / 2, 0, -LANE_HALF), V(BARRIER_W / 2, BARRIER_H, LANE_HALF), rr);
      if (hb) { res = hb; what = 'barrier'; }
    }
    if (!res && b.pos.y <= GROUND_Y + rr) { res = { point: b.pos.clone() }; what = 'ground'; }
    if (!res) return;
    const pt = res.point;
    if (what === 'head' || what === 'torso') {
      const points = what === 'head' ? 2 : 1;
      this.score[r.seat] += points;
      v.dazed += HELMET.dazeDur;
      const off = pt.clone().sub(v.hipWorld).dot(v.frame.right);
      v.torso.vRoll += HELMET.dazeKick * Math.sign(off || 1);
      this.events.push({ t: this.t, type: 'helmet-hit', seat: r.seat, target: v.seat, what, points, impulse: HELMET.mass * b.vel.length(), point: [pt.x, pt.y, pt.z] });
      if (!v.unseated && (Math.abs(v.torso.roll) > RIDER.fallAngle || Math.abs(v.torso.pitch) > RIDER.fallAngle)) this._unseat(v);
    } else {
      this.events.push({ t: this.t, type: 'helmet-miss', seat: r.seat, target: v.seat, what, points: 0, impulse: 0, point: [pt.x, pt.y, pt.z] });
    }
    b.pos.copy(pt); b.pos.y = Math.max(GROUND_Y + rr, b.pos.y);
    b.vel.multiplyScalar(0.2);
    if (b.vel.length() < 1.2 || what === 'ground') { b.vel.set(0, 0, 0); b.resting = true; }
  }

  /* ---- one substep ---- */
  _substep(dt) {
    for (const r of this.riders) {
      if (!r.unseated) {
        this._horse(r, dt);
        this._lance(r, dt);
        this._balance(r, dt);
      } else {
        this._horse(r, dt);
        if (r.fall && !r.fall.resting) {
          integrate(r.fall, dt);
          if (r.fall.pos.y <= GROUND_Y + 0.25) {
            r.fall.pos.y = GROUND_Y + 0.25;
            r.fall.vel.multiplyScalar(0.3); r.fall.vel.y = 0;
            if (r.fall.vel.length() < 0.5) { r.fall.vel.set(0, 0, 0); r.fall.resting = true; }
          }
        }
      }
      if (r.dazed > 0) r.dazed = Math.max(0, r.dazed - dt);
      this._pose(r, dt);
    }
    if (!this.crossed && this.riders[0].horse.z < this.riders[1].horse.z) this.crossed = true;
    this._impacts(dt);
    for (const r of this.riders) this._helmet(r, dt);
  }

  _checkEnd() {
    if (this.done) return;
    const [a, b] = this.riders;
    if (this.t >= PASS_MAX_S) return this._finish('timeout');
    if (a.unseated || b.unseated) {
      const t0 = Math.max(a.unseatT, b.unseatT);
      if (this.t - t0 >= 1.5) return this._finish('unseat');
      return;
    }
    if (this.crossed && a.horse.speed < 0.3 && b.horse.speed < 0.3) return this._finish('complete');
  }

  _finish(reason) {
    this.done = true;
    this.endReason = reason;
    this.events.push({ t: this.t, type: 'pass-end', seat: -1, target: -1, points: 0, impulse: 0, reason, point: [0, 0, 0] });
  }

  result() {
    return {
      score: [...this.score],
      events: this.events,
      unseated: [this.riders[0].unseated, this.riders[1].unseated],
      ticks: this.tick,
      endReason: this.endReason ?? 'timeout',
    };
  }
}

/** Headless resolution: the same class, fed a finished log. */
export function simulatePass({ seed, logs = [[], []], riders }) {
  const sim = new PassSim({ seed, riders });
  sim.logs = [logs[0] ?? [], logs[1] ?? []];
  let guardCount = 0;
  while (!sim.done && sim.t < PASS_MAX_S && guardCount++ < 2000) sim.step(TICK);
  if (!sim.done) sim._finish('timeout');
  return sim.result();
}

export { D_SUBSTEP };

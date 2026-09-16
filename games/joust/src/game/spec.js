/**
 * TILT ALLEY — the shared contract.
 *
 * Every module (physics, world, shell, net, server) imports its numbers from
 * here so the lists, the riders and the wire format can never disagree.
 *
 * Coordinates: y up, metres. The lane runs along z. The tilt barrier stands on
 * x = 0. Seat 0 starts at +z and rides toward -z on the +x side; seat 1 starts
 * at -z and rides toward +z on the -x side. Riders pass left shoulder to left
 * shoulder, the barrier on each rider's LEFT, lance in the RIGHT hand crossing
 * over the barrier toward the opponent's shield.
 */

/* ---------------- the lists ---------------- */

export const LANE_HALF = 26;           // barrier runs z = -26 .. +26
export const START_Z = 24;             // riders start at ±24
export const LANE_X = 0.95;            // riding line, either side of the barrier
export const BARRIER_H = 1.2;
export const BARRIER_W = 0.12;
export const GROUND_Y = 0;

/** Per-seat frame. forward = direction of travel; right = lance side. */
export const SEAT = [
  { forward: [0, 0, -1], right: [1, 0, 0], laneX: +LANE_X, startZ: +START_Z },
  { forward: [0, 0, +1], right: [-1, 0, 0], laneX: -LANE_X, startZ: -START_Z },
];

/* ---------------- the horse ---------------- */

export const HORSE = {
  saddleH: 1.55,          // saddle height off the ground at rest
  accel: 3.2,             // m/s^2 when charging
  cruise: 8.5,            // m/s natural charge speed
  spurMax: 11.0,          // m/s flat out
  spurAccel: 2.4,         // extra m/s^2 while spurring
  brake: 5.0,             // m/s^2 when reining in / after the pass
  strideBase: 2.2,        // stride length (m) = strideBase + strideK * speed
  strideK: 0.25,
  bobAmp: 0.075,          // vertical saddle bob at full gallop (m)
  rockAmp: 0.055,         // saddle pitch rock at full gallop (rad)
  wander: 0.06,           // lateral wander amplitude (m), scaled by drunk
};

/* ---------------- the rider ---------------- */

export const RIDER = {
  hipAboveSaddle: 0.05,
  shoulderAboveHip: 0.62,     // torso length, hip pivot -> shoulder
  headAboveShoulder: 0.28,
  helmR: 0.16,
  torsoR: 0.22,               // torso capsule radius
  // balance: inverted pendulum about the hip
  leanTorque: 9.0,            // rad/s^2 of muscle torque at full stick
  leanRate: 4.5,              // how fast the commanded lean is reached (1/s)
  seatCone: 0.45,             // rad: saddle spring holds you inside this
  seatSpring: 26.0,           // rad/s^2 per rad inside the cone
  gravityK: 6.5,              // destabilising rad/s^2 per rad outside the cone
  damping: 3.2,               // 1/s
  fallAngle: 0.95,            // rad: past this you are off the horse
  maxLean: 0.42,              // rad: commanded lean at full stick
};

/* ---------------- the lance ---------------- */

export const LANCE = {
  length: 3.2,                // couch pivot -> tip
  pivotOffRight: 0.30,        // couch pivot sits this far to the rider's right of the shoulder
  pivotBelowShoulder: 0.12,
  restPitch: 1.15,            // rad, tip up while carried
  couchRate: 1.9,             // couch progress per second (0 -> 1 in ~0.53 s)
  crossYaw: 0.52,             // rad, level lance points this far left across the barrier
  aimRangeYaw: 0.42,          // rad, mouse full deflection in yaw
  aimRangePitch: 0.30,        // rad, mouse full deflection in pitch
  armSpring: 34.0,            // spring-damper: tip follows the command with lag
  armDamp: 7.5,
  fatigueDroop: 0.11,         // rad of droop per second couched
  fatigueTremor: 0.035,       // rad of tremor amplitude per second couched
  breakEnergy: 62,            // kg m/s of axial impulse to shatter the tip
  tipR: 0.05,                 // sweep radius for the tip
};

export const SHIELD = {
  w: 0.52, h: 0.62,           // plate size
  offLeft: 0.24,              // centre sits this far to the rider's LEFT of the torso axis
  offUp: 0.08,                // above the shoulder line? no: above the hip by shoulder*0.55
  tilt: 0.35,                 // rad, plate normal turned away from the opponent
  guardRaise: 0.30,           // m the plate rises when guarding
};

export const HELMET = {
  r: 0.15,
  mass: 1.4,
  throwSpeed: 13.0,
  throwDur: 0.55,             // s from key press to release
  vulnerable: 0.8,            // s the shield is down while throwing
  dazeDur: 0.6,               // s the victim's aim spasms after a head hit
  dazeKick: 0.9,              // rad/s roll impulse on the victim's balance
};

/* ---------------- scoring ---------------- */

export const POINTS = {
  glance: 1,
  broken: 3,
  helm: 5,
  unseat: 10,
  foul: -2,
};
export const DEFAULT_PASSES = 5;

/* ---------------- impact ---------------- */

export const IMPACT = {
  glanceAngle: 0.96,          // rad off the surface normal beyond which a hit is glancing
  impulseK: 0.11,             // rad/s of balance kick per (kg m/s) of impulse
  effMass: 5.5,               // effective lance+arm mass for impulse
  shieldAbsorb: 0.35,         // fraction of impulse the shield soaks up
  helmKick: 1.35,             // multiplier on a helm hit
  barrierKick: 1.1,           // multiplier on the self-kick from snagging the barrier
  slowmo: 0.22,               // time scale during the impact cinematic
  slowmoDur: 0.7,             // real seconds of slow-mo
};

/* ---------------- ticks and wire ---------------- */

export const SUBSTEP = 1 / 480;     // physics, same as darts
export const TICK = 1 / 60;         // input sampling and the wire log
export const PASS_MAX_S = 9;        // a pass can never run longer than this

/**
 * One tick of input, packed as a flat array for the wire:
 *   [leanX, leanY, aimX, aimY, flags]
 * leanX  -1..1  right positive (D), left negative (A)
 * leanY  -1..1  forward positive (W), back negative (S)
 * aimX   -1..1  mouse, right positive — BODY-RELATIVE (see lance coupling)
 * aimY   -1..1  mouse, up positive   — BODY-RELATIVE
 * flags  bit 0 couch (LMB), bit 1 guard (RMB), bit 2 spur (Space), bit 3 fling (H)
 */
export const F_COUCH = 1, F_GUARD = 2, F_SPUR = 4, F_FLING = 8;

export function packInput(i) {
  const r = (n) => Math.round(Math.max(-1, Math.min(1, n)) * 100) / 100;
  return [r(i.leanX), r(i.leanY), r(i.aimX), r(i.aimY),
    (i.couch ? F_COUCH : 0) | (i.guard ? F_GUARD : 0) | (i.spur ? F_SPUR : 0) | (i.fling ? F_FLING : 0)];
}
export function unpackInput(a) {
  const f = a?.[4] ?? 0;
  return {
    leanX: a?.[0] ?? 0, leanY: a?.[1] ?? 0, aimX: a?.[2] ?? 0, aimY: a?.[3] ?? 0,
    couch: !!(f & F_COUCH), guard: !!(f & F_GUARD), spur: !!(f & F_SPUR), fling: !!(f & F_FLING),
  };
}
export const IDLE_INPUT = [0, 0, 0, 0, 0];

/**
 * LANCE COUPLING — the rule Anay asked for, stated once:
 * The lance pivot is fixed to the TORSO. Torso lean rotates the pivot and the
 * lance's base direction with it. Mouse aim is applied in the torso frame ON
 * TOP of the lean. So leaning left swings the tip left, and holding a world
 * target through a lean means moving the mouse right to cancel it.
 */

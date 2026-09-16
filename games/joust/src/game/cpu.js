/**
 * TILT ALLEY — the CPU knights.
 *
 * A CPU is just another input source: every tick it returns a packed input
 * array exactly like the player's, so the physics never knows the difference
 * and a replay of a CPU pass is byte-identical to a replay of a human one.
 *
 * Everything random comes out of the rng handed in at construction, so a seed
 * fully determines the opponent's ride.
 */

import * as THREE from 'three';
import { packInput, unpackInput, LANCE, RIDER, SEAT, START_Z } from './spec.js';
import { gaussFrom } from '../../../darts/src/game/rng.js';

/** Fixed looks, so THE BLACK KNIGHT is always THE BLACK KNIGHT. */
export const KNIGHTS = {
  'cpu-squire': {
    name: 'THE SQUIRE',
    mask: 'none',
    spec: {
      name: 'SQUIRE', fur: '#d9c59a', hair: '#8a6a3a', hairStyle: 'shaggy',
      nose: '#e0604f', noseShape: 'round', accessory: 'cap', accent: '#5d6b4a',
      build: 'round', height: 1.44, eyeSize: 0.92, pupilSize: 1.15,
    },
    skill: { aimSigma: 0.30, couchLead: 0.95, couchJitter: 0.30, seat: 0.55, spur: 0.25, fling: 0 },
  },
  'cpu-knight': {
    name: 'THE KNIGHT',
    mask: 'none',
    spec: {
      name: 'KNIGHT', fur: '#7f95a8', hair: '#c8203c', hairStyle: 'mohawk',
      nose: '#5a6a78', noseShape: 'beak', accessory: 'shades', accent: '#c8203c',
      build: 'lanky', height: 1.78, eyeSize: 0.85, pupilSize: 0.8,
    },
    skill: { aimSigma: 0.15, couchLead: 0.65, couchJitter: 0.16, seat: 1.0, spur: 0.6, fling: 0.25 },
  },
  'cpu-black': {
    name: 'THE BLACK KNIGHT',
    mask: 'plague',
    spec: {
      name: 'BLACK KNIGHT', fur: '#d8dde4', hair: '#9fb3c8', hairStyle: 'antennae',
      nose: '#7f8996', noseShape: 'button', accessory: 'bowtie', accent: '#2fd4ff',
      build: 'average', height: 1.66, eyeSize: 1.15, pupilSize: 0.55,
    },
    skill: { aimSigma: 0.07, couchLead: 0.48, couchJitter: 0.08, seat: 1.5, spur: 0.9, fling: 0.6 },
  },
};

export const KNIGHT_KEYS = Object.keys(KNIGHTS);

const _v = new THREE.Vector3();

export class Cpu {
  /**
   * @param {string}   key  a KNIGHTS key
   * @param {function} rng  mulberry32-style 0..1 source, owned by the caller
   */
  constructor(key, rng) {
    this.key = KNIGHTS[key] ? key : 'cpu-knight';
    this.def = KNIGHTS[this.key];
    this.skill = { ...this.def.skill };
    this.rng = rng ?? Math.random;
    this.reset();
  }

  get name() { return this.def.name; }
  get spec() { return this.def.spec; }
  get mask() { return this.def.mask; }

  /** New pass: re-roll the per-pass decisions. */
  reset() {
    const r = this.rng;
    const s = this.skill;
    this._lead = Math.max(0.12, s.couchLead + (r() - 0.5) * 2 * s.couchJitter);
    this._willFling = r() < s.fling;
    // somewhere in the run-up, but never so late it lands after the crossing
    this._flingAt = 0.45 + r() * 0.85;
    this._flung = false;
    this._aimBiasX = gaussFrom(r) * s.aimSigma * 0.5;
    this._aimBiasY = gaussFrom(r) * s.aimSigma * 0.5;
    this._noiseT = r() * 10;
    this._lastPitch = 0;
    this._lastRoll = 0;
    this._out = [0, 0, 0, 0, 0];
  }

  /**
   * One tick of input for `seat`.
   * @param {object} sim   the live PassSim
   * @param {number} seat  which seat this CPU rides
   * @returns {Array} packed input
   */
  input(sim, seat) {
    const me = sim?.riders?.[seat];
    const them = sim?.riders?.[seat ^ 1];
    if (!me || !them) return [0, 0, 0, 0, 0];

    const s = this.skill;
    const dtHint = 1 / 60;

    /* ---- when do we cross? ---- */
    const myZ = me.horse?.z ?? 0, theirZ = them.horse?.z ?? 0;
    const mySp = Math.abs(me.horse?.speed ?? 0), theirSp = Math.abs(them.horse?.speed ?? 0);
    const closing = Math.max(0.5, mySp + theirSp);
    const gap = Math.abs(myZ - theirZ);
    const tCross = gap / closing;

    /* ---- couch ---- */
    const couch = tCross <= this._lead && !me.lance?.broken;

    /* ---- guard: the squire hides, the black knight never does ---- */
    const guard = !couch && tCross < 0.35 && this.rng() < (1 - s.spur) * 0.15;

    /* ---- spur ---- */
    const spur = tCross > 0.25 && this.rng() < s.spur;

    /* ---- fling the helmet ---- */
    let fling = false;
    if (this._willFling && !this._flung && me.helmet?.worn && tCross <= this._flingAt) {
      fling = true;
      this._flung = true;
    }

    /* ---- aim at their shield centre, in our own aim axes ---- */
    let aimX = this._aimBiasX, aimY = this._aimBiasY;
    const tip = me.lance?.tipWorld, pivot = me.lance?.pivotWorld;
    const target = them.shield?.centerWorld ?? them.shoulderWorld;
    if (target && pivot) {
      // the error the lance must close, expressed as a fraction of the aim cone
      const fwd = SEAT[seat].forward;
      const right = SEAT[seat].right;
      _v.set(target.x - pivot.x, target.y - pivot.y, target.z - pivot.z);
      const dist = Math.max(0.6, _v.length());
      // yaw: sideways offset along our right axis, pitch: plain height offset
      const lateral = _v.x * right[0] + _v.z * right[2];
      const ahead = Math.abs(_v.x * fwd[0] + _v.z * fwd[2]) || dist;
      const wantYaw = Math.atan2(lateral, ahead) + LANCE.crossYaw * 0;
      const wantPitch = Math.asin(Math.max(-1, Math.min(1, _v.y / dist)));

      let haveYaw = 0, havePitch = 0;
      if (tip) {
        const t = _v.set(tip.x - pivot.x, tip.y - pivot.y, tip.z - pivot.z);
        const tl = t.x * right[0] + t.z * right[2];
        const ta = Math.abs(t.x * fwd[0] + t.z * fwd[2]) || LANCE.length;
        haveYaw = Math.atan2(tl, ta);
        havePitch = Math.asin(Math.max(-1, Math.min(1, t.y / Math.max(0.6, t.length()))));
      }
      aimX += (wantYaw - haveYaw) / LANCE.aimRangeYaw;
      aimY += (wantPitch - havePitch) / LANCE.aimRangePitch;
    }
    // hand tremor, scaled by how good this knight is
    this._noiseT += dtHint;
    aimX += Math.sin(this._noiseT * 5.3) * s.aimSigma * 0.35;
    aimY += Math.cos(this._noiseT * 4.1) * s.aimSigma * 0.35;

    /* ---- seat: counter-lean against our own torso velocity ---- */
    const pitch = me.torso?.pitch ?? 0, roll = me.torso?.roll ?? 0;
    const vPitch = (pitch - this._lastPitch) / dtHint;
    const vRoll = (roll - this._lastRoll) / dtHint;
    this._lastPitch = pitch; this._lastRoll = roll;
    const g = s.seat;
    let leanX = -(roll * 2.4 + vRoll * 0.24) * g;
    let leanY = -(pitch * 2.4 + vPitch * 0.24) * g;
    // lean into the blow just before contact — bracing beats flailing
    if (tCross < 0.25) leanY += 0.5 * g;

    const out = this._out;
    out[0] = clamp1(leanX); out[1] = clamp1(leanY);
    out[2] = clamp1(aimX); out[3] = clamp1(aimY);
    return packInput({
      leanX: out[0], leanY: out[1], aimX: out[2], aimY: out[3],
      couch, guard, spur, fling,
    });
  }
}

function clamp1(n) { return n < -1 ? -1 : n > 1 ? 1 : (Number.isFinite(n) ? n : 0); }

export { unpackInput, RIDER, START_Z };

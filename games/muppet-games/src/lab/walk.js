import * as THREE from 'three';

/**
 * First-person walking, for wandering the bar between shots.
 *
 * Deliberately simple: a capsule that slides along axis-aligned blockers, mouse
 * look, and a proximity test against a list of interaction points. It only runs
 * when the game hands it control, so it never fights the aiming camera.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const EYE_HEIGHT = 1.32;      // muppet height, not human height

export class Walker {
  constructor(opts = {}) {
    this.pos = new THREE.Vector3(0, EYE_HEIGHT, 2.6);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;
    this.pitch = -0.06;
    this.radius = 0.28;
    this.speed = 2.5;
    this.sens = 1;
    this.active = false;
    this.keys = new Set();

    this.blockers = [];              // { minX, maxX, minZ, maxZ }
    this.spots = [];                 // { name, x, z, r, label, onEnter, onLeave }
    this.nearest = null;
    this.onSpotChange = opts.onSpotChange ?? (() => {});
    this.onInteract = opts.onInteract ?? (() => {});
    this.bounds = opts.bounds ?? { minX: -6, maxX: 6, minZ: -6, maxZ: 6 };

    this.bob = 0;
  }

  /** Rectangular no-go areas, in world XZ. */
  addBlocker(minX, minZ, maxX, maxZ) {
    this.blockers.push({ minX, minZ, maxX, maxZ });
  }

  /** Somewhere you can stand and press E. */
  addSpot(spot) { this.spots.push(spot); return spot; }

  enter(x, z, yaw) {
    this.pos.set(x, EYE_HEIGHT, z);
    if (yaw !== undefined) this.yaw = yaw;
    this.vel.set(0, 0, 0);
    this.active = true;
  }

  leave() {
    this.active = false;
    if (this.nearest) {
      this.nearest.onLeave?.();
      this.nearest = null;
      this.onSpotChange(null);
    }
  }

  look(dx, dy) {
    if (!this.active) return;
    this.yaw -= dx * 0.0026 * this.sens;
    this.pitch = clamp(this.pitch - dy * 0.0022 * this.sens, -1.1, 0.9);
  }

  key(k, down) {
    if (down) this.keys.add(k); else this.keys.delete(k);
  }

  interact() {
    if (this.active && this.nearest) this.onInteract(this.nearest);
  }

  update(dt, camera) {
    if (!this.active) return;

    /* ---- intent ---- */
    let fwd = 0, strafe = 0;
    if (this.keys.has('w')) fwd += 1;
    if (this.keys.has('s')) fwd -= 1;
    if (this.keys.has('a')) strafe -= 1;
    if (this.keys.has('d')) strafe += 1;
    const run = this.keys.has('shift') ? 1.7 : 1;

    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    // -z is forward when yaw is 0, matching three.js camera convention
    const wishX = (-sinY * fwd + cosY * strafe);
    const wishZ = (-cosY * fwd - sinY * strafe);
    const len = Math.hypot(wishX, wishZ) || 1;
    const target = this.speed * run * (fwd || strafe ? 1 : 0);

    this.vel.x += ((wishX / len) * target - this.vel.x) * Math.min(1, dt * 12);
    this.vel.z += ((wishZ / len) * target - this.vel.z) * Math.min(1, dt * 12);

    /* ---- move, one axis at a time so we slide along walls ---- */
    const stepX = this.vel.x * dt, stepZ = this.vel.z * dt;
    if (!this._blocked(this.pos.x + stepX, this.pos.z)) this.pos.x += stepX;
    else this.vel.x = 0;
    if (!this._blocked(this.pos.x, this.pos.z + stepZ)) this.pos.z += stepZ;
    else this.vel.z = 0;

    const b = this.bounds;
    this.pos.x = clamp(this.pos.x, b.minX, b.maxX);
    this.pos.z = clamp(this.pos.z, b.minZ, b.maxZ);

    /* ---- head bob, because a muppet does not glide ---- */
    const moving = Math.hypot(this.vel.x, this.vel.z);
    this.bob += dt * moving * 7.5;
    const bobY = Math.sin(this.bob) * 0.022 * Math.min(1, moving / 2);
    const bobR = Math.cos(this.bob * 0.5) * 0.012 * Math.min(1, moving / 2);

    /* ---- camera ---- */
    if (camera) {
      camera.position.set(this.pos.x, this.pos.y + bobY, this.pos.z);
      camera.rotation.set(0, 0, 0);
      camera.rotateY(this.yaw);
      camera.rotateX(this.pitch);
      camera.rotateZ(bobR);
    }

    /* ---- what am I standing at? ---- */
    let found = null;
    let bestD = Infinity;      // local: stashing this on the spot would compare
    for (const s of this.spots) {           // against last frame's distance
      const d = Math.hypot(this.pos.x - s.x, this.pos.z - s.z);
      if (d < s.r && d < bestD) { found = s; bestD = d; }
    }
    if (found !== this.nearest) {
      this.nearest?.onLeave?.();
      this.nearest = found;
      found?.onEnter?.();
      this.onSpotChange(found);
    }
  }

  _blocked(x, z) {
    const r = this.radius;
    for (const b of this.blockers) {
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return true;
    }
    return false;
  }
}

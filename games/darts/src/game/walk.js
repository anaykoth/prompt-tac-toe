import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;

/** Eye height above whatever you're standing on. */
const EYE = 1.53;
const SPEED = 2.0;          // m/s
const SPRINT = 3.1;
const LOOK = 0.0024;        // radians per pixel of mouse travel
const PITCH_LIMIT = 1.15;

/**
 * Shift-to-walk. You can wander the whole throwing area, but the oche is the
 * oche — `legal` goes false the moment you step over it, and the game refuses
 * to let you throw until you're back behind the line.
 */
export class Walk {
  constructor(arena, ocheZ) {
    this.stageH = arena.stageH;
    this.stageZ0 = 1.55;
    this.stageZ1 = 4.3;
    this.stageHalf = 1.65;
    this.ocheZ = ocheZ;

    this.bounds = { x: 1.85, z0: -0.30, z1: 4.85 };

    this.active = false;
    this.pos = new THREE.Vector3(0, 0, ocheZ + 0.29);
    this.pos.y = this.groundAt(this.pos.x, this.pos.z);
    this.eyeY = this.pos.y + EYE;
    this.yaw = Math.PI;        // facing -Z, i.e. at the board
    this.pitch = 0;
    this.keys = new Set();

    this.eye = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this._sync();
  }

  groundAt(x, z) {
    const onStage = z > this.stageZ0 && z < this.stageZ1 && Math.abs(x) < this.stageHalf;
    return onStage ? this.stageH : 0;
  }

  /** False when the player has stepped over the throw line. */
  get legal() { return this.pos.z >= this.ocheZ - 0.02; }

  get moving() {
    return this.active && (this.keys.has('KeyW') || this.keys.has('KeyS')
      || this.keys.has('KeyA') || this.keys.has('KeyD'));
  }

  begin() {
    this.active = true;
    this.keys.clear();
  }

  end() {
    this.active = false;
    this.keys.clear();
  }

  key(code, down) {
    if (down) this.keys.add(code); else this.keys.delete(code);
  }

  releaseAll() { this.keys.clear(); }

  look(dx, dy) {
    if (!this.active) return;
    this.yaw -= dx * LOOK;
    this.pitch = clamp(this.pitch - dy * LOOK, -PITCH_LIMIT, PITCH_LIMIT);
  }

  /** Point the view back at the board, keeping the current stance. */
  faceBoard(target) {
    this.yaw = Math.atan2(this.pos.x - target.x, this.pos.z - target.z) + Math.PI;
    this.pitch = 0;
  }

  update(dt) {
    if (this.active) {
      let fwd = 0, strafe = 0;
      if (this.keys.has('KeyW')) fwd += 1;
      if (this.keys.has('KeyS')) fwd -= 1;
      if (this.keys.has('KeyD')) strafe += 1;
      if (this.keys.has('KeyA')) strafe -= 1;

      if (fwd || strafe) {
        const len = Math.hypot(fwd, strafe);
        fwd /= len; strafe /= len;
        const speed = (this.keys.has('KeyQ') ? SPRINT : SPEED) * dt;
        const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
        // forward = (sin y, cos y); right = forward x up = (-cos y, sin y)
        this.pos.x += (sy * fwd - cy * strafe) * speed;
        this.pos.z += (cy * fwd + sy * strafe) * speed;
        this.pos.x = clamp(this.pos.x, -this.bounds.x, this.bounds.x);
        this.pos.z = clamp(this.pos.z, this.bounds.z0, this.bounds.z1);
      }
    }

    // step up and down onto the stage smoothly rather than snapping 17 cm
    this.pos.y = this.groundAt(this.pos.x, this.pos.z);
    const targetEye = this.pos.y + EYE;
    this.eyeY += (targetEye - this.eyeY) * Math.min(1, dt * 12);
    this._sync();
  }

  _sync() {
    this.eye.set(this.pos.x, this.eyeY, this.pos.z);
    const cp = Math.cos(this.pitch);
    this.lookAt.set(
      this.eye.x + Math.sin(this.yaw) * cp,
      this.eye.y + Math.sin(this.pitch),
      this.eye.z + Math.cos(this.yaw) * cp,
    );
  }

  /** Drop back to the default stance behind the oche. */
  reset() {
    this.pos.set(0, 0, this.ocheZ + 0.29);
    this.pos.y = this.groundAt(this.pos.x, this.pos.z);
    this.eyeY = this.pos.y + EYE;
    this.yaw = Math.PI;
    this.pitch = 0;
    this._sync();
  }
}

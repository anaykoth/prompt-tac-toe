import * as THREE from 'three';
import { BALL_R, TABLE } from './physics.js';
import { buildCueStick, buildBridgeHand } from './table.js';
import { StrokeTrace } from './stroke-feedback.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

/** Stable input surface. Each stroke style lives in its own lazy-loaded module. */
export class CueControl {
  constructor(dom, opts = {}) {
    this.dom = dom;
    this.onShoot = opts.onShoot ?? (() => {});
    this.onState = opts.onState ?? (() => {});
    this.onPlace = opts.onPlace ?? (() => {});
    this.onMode = opts.onMode ?? (() => {});
    this.enabled = false;
    this.suspended = false;
    this.state = 'idle';
    this.sens = this.power = 1;
    this.assist = 0.3;
    this.yaw = this.elevation = this.tipX = 0;
    this.tipY = 0.15;
    this.back = this.forward = this.lateral = this.lateralAbs = 0;
    this.peak = this.speed = this.sinceSlow = 0;
    this.pushing = false;
    this.keys = new Set();
    this.placeTarget = new THREE.Vector2();
    this.locked = document.pointerLockElement === dom;
    this._listeners = [];
    this._modeRequest = 0;
    this.trace = new StrokeTrace();
    this._bind();
    this.ready = this.setMode(opts.mode ?? 'contact');
  }

  _listen(target, type, fn) {
    target.addEventListener(type, fn);
    this._listeners.push(() => target.removeEventListener(type, fn));
  }

  _bind() {
    this._listen(this.dom, 'mousedown', (e) => this._down(e));
    this._listen(window, 'mouseup', (e) => this._up(e));
    this._listen(window, 'mousemove', (e) => this._move(e));
    this._listen(window, 'keydown', (e) => {
      if (e.repeat || !this.enabled || this.suspended || isFormTarget(e.target)) return;
      this.keys.add(e.key.toLowerCase());
      if (e.key === 'Escape') this.cancelStroke();
    });
    this._listen(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    this._listen(window, 'blur', () => { this.keys.clear(); this.cancelStroke(); });
    this._listen(document, 'pointerlockchange', () => {
      const wasLocked = this.locked;
      this.locked = document.pointerLockElement === this.dom;
      if (wasLocked && !this.locked) { this.keys.clear(); this.cancelStroke(); }
      this.onState(this.state, this.locked);
    });
  }

  async setMode(id) {
    const load = CONTROL_LOADERS[id];
    if (!load || this.disposed) return false;
    const request = ++this._modeRequest;
    this.pendingMode = null;
    this.requestedMode = id;
    this.loadingMode = true;
    this.onMode(id, 'loading');
    try {
      const mod = await load();
      if (this.disposed || request !== this._modeRequest) return false;
      this.loadingMode = false;
      if (this.state === 'stroke') {
        this.pendingMode = mod;
        this.onMode(id, 'pending');
      } else this._installMode(mod);
      return true;
    } catch (error) {
      if (request !== this._modeRequest) return false;
      this.loadingMode = false;
      this.onMode(id, 'error', error);
      return false;
    }
  }

  _installMode(mod) {
    this.stroke?.cancel?.();
    this.pendingMode = null;
    this.stroke = mod.createStroke(this);
    this.mode = mod.meta.id;
    this.meta = mod.meta;
    this.back = this.forward = this.lateral = this.lateralAbs = 0;
    this.peak = this.speed = 0;
    this.pushing = false;
    this.onMode(this.mode, 'ready');
  }

  _applyPending() { if (this.pendingMode) this._installMode(this.pendingMode); }

  lock() {
    if (!this.locked && this.dom.requestPointerLock) {
      const r = this.dom.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
    }
  }

  unlock() { this.cancelStroke(); if (this.locked) document.exitPointerLock(); }

  rearm() {
    this.trace.cancel();
    this.stroke?.cancel?.();
    this.state = 'aim';
    this.keys.clear();
    this.back = this.forward = this.lateral = this.lateralAbs = 0;
    this.peak = this.speed = 0;
    this.pushing = false;
    this._applyPending();
    this.onState(this.state, this.locked);
  }

  cancelStroke() { if (this.state === 'stroke') { this.trace.cancel(); this.rearm(); } }

  idle() {
    this.trace.cancel();
    this.stroke?.cancel?.();
    this.state = 'idle';
    this.keys.clear();
    this._applyPending();
    this.onState(this.state, this.locked);
  }

  placing() {
    this.trace.cancel();
    this.stroke?.cancel?.();
    this.state = 'placing';
    this.keys.clear();
    this._applyPending();
    this.onState(this.state, this.locked);
  }

  _down(e) {
    if (!this.enabled || this.suspended || e.button !== 0 || !this.stroke) return;
    if (!this.locked) this.lock();
    if (this.state === 'placing') { this.onPlace(); return; }
    if (this.state !== 'aim') return;
    this.state = 'stroke';
    this.stroke.begin(eventTime(e));
    this.onState(this.state, this.locked);
  }

  _up(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (this.state !== 'stroke') return;
    if (!this.enabled || this.suspended) { this.cancelStroke(); return; }
    this.stroke.release();
  }

  _move(e) {
    if (!this.enabled || this.suspended || isFormTarget(e.target)) return;
    const dx = e.movementX || 0, dy = e.movementY || 0;
    if (this.state === 'aim') {
      const fine = this.mode === 'contact' && this.keys.has('shift') ? 0.28 : 1;
      this.yaw += dx * 0.0032 * this.sens * fine;
      this.elevation = clamp(this.elevation + dy * 0.0022 * this.sens * fine, 0, 1.05);
    } else if (this.state === 'placing') {
      this.placeTarget.x += dx * 0.0016 * this.sens;
      this.placeTarget.y += dy * 0.0016 * this.sens;
    } else if (this.state === 'stroke') {
      // Classic retains its original performance.now timing; Contact uses
      // event timestamps so input queued between render frames keeps its timing.
      this.stroke.move(dx, dy, this.mode === 'classic' ? performance.now() : eventTime(e));
    }
  }

  update(dt) {
    if (!this.enabled || this.suspended) { this.cancelStroke(); return; }
    if (this.state === 'stroke') this.stroke.update(dt);
  }

  fire(ev) {
    if (this.state !== 'stroke') return;
    this.state = 'fired';
    this.trace.finish(ev);
    this.onState(this.state, this.locked);
    this.onShoot(ev);
    this._applyPending();
  }

  get visualPull() {
    return this.state === 'stroke' ? (this.stroke?.visualPull ?? 0)
      : this.mode === 'contact' ? 0.002 : 0.012;
  }
  get contactModel() { return this.mode === 'contact' ? this.stroke?.model : null; }
  previewShot(time = performance.now()) { return this.state === 'stroke' ? this.stroke?.preview?.(time) : null; }

  /** Set the bridge hand before a Contact stroke; it stays planted on the shot. */
  tick(dt) {
    if (!this.enabled || this.suspended) return;
    if (this.state !== 'aim' && this.state !== 'stroke') return;
    if (this.mode === 'contact' && this.state === 'stroke') return;
    const k = this.keys;
    const rate = (k.has('shift') ? 0.35 : 1.1) * dt;
    if (k.has('w')) this.tipY += rate;
    if (k.has('s')) this.tipY -= rate;
    if (k.has('a')) this.tipX -= rate;
    if (k.has('d')) this.tipX += rate;
    const r = Math.hypot(this.tipX, this.tipY), MAX = 0.68;
    if (r > MAX) { this.tipX *= MAX / r; this.tipY *= MAX / r; }
  }

  centreTip() {
    if (this.mode === 'contact' && this.state === 'stroke') return;
    this.tipX = 0; this.tipY = 0.15;
  }

  dispose() {
    this.disposed = true;
    this._modeRequest++;
    this.stroke?.cancel?.();
    this.keys.clear();
    for (const remove of this._listeners) remove();
    this._listeners.length = 0;
  }
}

const CONTROL_LOADERS = {
  classic: () => import('./controls/classic.js'),
  contact: () => import('./controls/contact.js'),
};
const eventTime = (event) => Number.isFinite(event.timeStamp) && event.timeStamp > 0
  ? event.timeStamp : performance.now();
const isFormTarget = (target) => target?.closest?.('input, select, textarea, button, [contenteditable="true"]');

/* ------------------------------------------------------------------ */
/* The visible cue                                                     */
/* ------------------------------------------------------------------ */

/** Positions the stick and the bridge hand from the control's state. */
export class CueRig {
  constructor(scene) {
    this.stick = buildCueStick();
    this.hand = buildBridgeHand();
    this.group = new THREE.Group();
    this.group.add(this.stick, this.hand);
    scene.add(this.group);
    this.len = this.stick.userData.length;

    this.pull = 0;          // how far the cue is drawn back, metres
    this.follow = 0;        // follow-through after the strike
    this.visible = true;

    this._dir = new THREE.Vector3();
    this._tip = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
    this._down = new THREE.Vector3(0, -1, 0);

    /* the aim line, drawn on the cloth */
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.32,
    }));
    this.line.frustumCulled = false;
    scene.add(this.line);

    const deliveryGeo = geo.clone();
    this.deliveryLine = new THREE.Line(deliveryGeo, new THREE.LineBasicMaterial({
      color: 0xffc736, transparent: true, opacity: 0.9,
    }));
    this.deliveryLine.frustumCulled = false;
    this.deliveryLine.visible = false;
    scene.add(this.deliveryLine);

    /* the ghost ball at the end of the aim line */
    this.ghost = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 18, 14),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, wireframe: true }),
    );
    scene.add(this.ghost);
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
    this.line.visible = v;
    this.deliveryLine.visible = false;
    this.ghost.visible = v;
  }

  /**
   * @param {object} cue    the cue ball from the sim
   * @param {object} state  { yaw, elevation, tipX, tipY }
   * @param {object} aim    { hitX, hitZ, dist } from the aim trace, may be null
   */
  update(cue, state, aim, dt, strokePull = 0, deliveryYaw = null) {
    if (!this.visible || !cue || !cue.live) return;
    const { yaw, elevation, tipX, tipY } = state;

    const cx = Math.cos(yaw), cz = Math.sin(yaw);
    // aim direction, and the horizontal vector to its right
    this._dir.set(cx * Math.cos(elevation), -Math.sin(elevation), cz * Math.cos(elevation)).normalize();
    const rx = cz, rz = -cx;

    const bx = cue.x, by = TABLE.height + BALL_R + cue.y, bz = cue.z;

    // where the tip meets the ball
    const depth = Math.sqrt(Math.max(0.02, 1 - tipX * tipX - tipY * tipY)) * BALL_R;
    this._tip.set(
      bx + rx * tipX * BALL_R - cx * depth,
      by + tipY * BALL_R,
      bz + rz * tipX * BALL_R - cz * depth,
    );
    // pulled back along its own axis
    if (state.mode === 'contact') this.pull = strokePull;
    else this.pull += (strokePull - this.pull) * Math.min(1, dt * 22);
    this._tip.addScaledVector(this._dir, -(this.pull + this.follow) - 0.012);

    this._q.setFromUnitVectors(this._down, this._dir);
    this.stick.quaternion.copy(this._q);
    this.stick.position.copy(this._tip).addScaledVector(this._dir, -this.len);

    // bridge hand sits on the cloth under the shaft, a bridge length back
    const hx = bx - cx * 0.30, hz = bz - cz * 0.30;
    this.hand.position.set(hx, TABLE.height, hz);
    this.hand.rotation.y = -yaw + Math.PI / 2;
    // it visibly leans the way the tip has been walked
    this.hand.rotation.z = tipX * 0.28;
    this.hand.position.y = TABLE.height + Math.max(0, tipY) * 0.012;

    this.follow *= Math.max(0, 1 - dt * 6);

    /* aim line + ghost ball */
    const pos = this.line.geometry.attributes.position.array;
    const d = aim?.dist ?? 1.2;
    pos[0] = bx; pos[1] = TABLE.height + 0.004; pos[2] = bz;
    pos[3] = bx + cx * d; pos[4] = TABLE.height + 0.004; pos[5] = bz + cz * d;
    this.line.geometry.attributes.position.needsUpdate = true;
    this.deliveryLine.visible = deliveryYaw !== null;
    if (deliveryYaw !== null) {
      const release = this.deliveryLine.geometry.attributes.position.array;
      release[0] = bx; release[1] = TABLE.height + 0.006; release[2] = bz;
      release[3] = bx + Math.cos(deliveryYaw) * d;
      release[4] = TABLE.height + 0.006;
      release[5] = bz + Math.sin(deliveryYaw) * d;
      this.deliveryLine.geometry.attributes.position.needsUpdate = true;
    }

    if (aim && aim.hit) {
      this.ghost.visible = true;
      this.ghost.position.set(aim.hitX, TABLE.height + BALL_R, aim.hitZ);
    } else {
      this.ghost.visible = false;
    }
  }

  /** Kick the stick through the ball when the shot goes off. */
  strike(power) {
    this.follow = -0.06 - power * 0.02;
    this.pull = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Aim trace                                                           */
/* ------------------------------------------------------------------ */

/**
 * Where does the cue ball first touch something? Straight-line only — no
 * cushions, no spin — because that is exactly as much help as a real table
 * gives you.
 */
export function traceAim(sim, yaw) {
  const cue = sim.cue;
  if (!cue || !cue.live) return null;
  const dx = Math.cos(yaw), dz = Math.sin(yaw);
  let best = null;

  for (const b of sim.live()) {
    if (b === cue) continue;
    const ox = b.x - cue.x, oz = b.z - cue.z;
    const t = ox * dx + oz * dz;
    if (t <= 0) continue;
    const px = cue.x + dx * t, pz = cue.z + dz * t;
    const perp = Math.hypot(b.x - px, b.z - pz);
    const sum = cue.r + b.r;
    if (perp > sum) continue;
    // exact contact distance along the line
    const back = Math.sqrt(sum * sum - perp * perp);
    const dist = t - back;
    if (dist < 0) continue;
    if (!best || dist < best.dist) {
      best = {
        dist, hit: true, ball: b,
        hitX: cue.x + dx * dist, hitZ: cue.z + dz * dist,
        // where the object ball will set off
        objDir: Math.atan2(b.z - (cue.z + dz * dist), b.x - (cue.x + dx * dist)),
      };
    }
  }

  if (best) return best;

  // otherwise run to the cushion
  let dist = 4;
  for (const c of sim.geo.cushions) {
    const ex = c.bx - c.ax, ez = c.bz - c.az;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((c.ax - cue.x) * ez - (c.az - cue.z) * ex) / den;
    const u = ((c.ax - cue.x) * dz - (c.az - cue.z) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && t < dist) dist = t;
  }
  return { dist: Math.max(0.1, dist - BALL_R), hit: false };
}

import * as THREE from 'three';

const CLAMP = { x: 0.62, yLo: -0.62, yHi: 0.72 };   // how far off the bull you may aim, metres

/**
 * Mouse throwing: aim with the pointer, pull down to wind up, flick up to
 * release. Flick speed is power, flick straightness is accuracy.
 */
export class ThrowControl {
  constructor(dom, camera, opts = {}) {
    this.dom = dom;
    this.camera = camera;
    this.enabled = false;
    this.sens = 1;
    this.assist = 0.35;

    this.state = 'aim';          // aim | wind | flick | meter | spent
    this.mouse = new THREE.Vector2(innerWidth / 2, innerHeight * 0.46);
    // where the reticle is drawn: tracks the pointer while aiming, then locks
    // to the frozen aim point so pulling down doesn't drag the sight off target
    this.aimScreen = this.mouse.clone();
    this.aimNDC = new THREE.Vector2();
    this.target = new THREE.Vector3(0, 0, 0);
    this.frozenTarget = new THREE.Vector3();

    this.samples = [];
    this.anchorY = 0;
    this.pull = 0;
    this.peakUp = 0;
    this.flickX0 = 0;
    this.upTravel = 0;
    this.holdT = 0;
    this.power01 = 0;

    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

    this.onThrow = opts.onThrow ?? (() => {});
    this.onAim = opts.onAim ?? (() => {});
    this.onCharge = opts.onCharge ?? (() => {});

    this._bind();
  }

  _bind() {
    const inUI = (e) => e.target?.closest?.('#panel, #intro, #loading, #bar');
    const move = (e) => this._move(e);
    const down = (e) => { if (e.button === 0 && !inUI(e)) this._down(e); };
    const up = (e) => { if (e.button === 0) this._up(e); };
    addEventListener('mousemove', move, { passive: true });
    addEventListener('mousedown', down);
    addEventListener('mouseup', up);
    this._unbind = () => {
      removeEventListener('mousemove', move);
      removeEventListener('mousedown', down);
      removeEventListener('mouseup', up);
    };
  }

  setBoardPlane(z) { this.plane.constant = -z; }

  /** Screen point -> a point on the board plane, clamped to a sane area. */
  _project(px, py) {
    this.aimNDC.set((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.aimNDC, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return null;
    hit.x = THREE.MathUtils.clamp(hit.x, -CLAMP.x, CLAMP.x);
    hit.y = THREE.MathUtils.clamp(hit.y, this.boardY + CLAMP.yLo, this.boardY + CLAMP.yHi);
    return hit;
  }

  _push(x, y) {
    const t = performance.now();
    this.samples.push({ t, x, y });
    while (this.samples.length > 24 || (this.samples.length > 2 && t - this.samples[0].t > 200)) {
      this.samples.shift();
    }
  }

  /** px/s over the last ~50 ms. */
  _velocity() {
    const s = this.samples;
    if (s.length < 2) return { vx: 0, vy: 0 };
    const now = s[s.length - 1];
    let i = s.length - 2;
    while (i > 0 && now.t - s[i].t < 50) i--;
    const dt = Math.max(8, now.t - s[i].t) / 1000;
    return { vx: (now.x - s[i].x) / dt, vy: (now.y - s[i].y) / dt };
  }

  _move(e) {
    if (!this.enabled) return;
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    this._push(e.clientX, e.clientY);

    if (this.state === 'aim') {
      this.aimScreen.copy(this.mouse);
      const p = this._project(e.clientX, e.clientY);
      if (p) { this.target.copy(p); this.onAim(this.target, this.aimScreen); }
      return;
    }
    this.onAim(this.frozenTarget, this.aimScreen);

    if (this.state === 'wind') {
      const dy = e.clientY - this.anchorY;
      if (dy > this.pull) this.pull = dy;
      // has the flick started?
      const rise = this.pull - dy;
      if (this.pull > 26 && rise > 14) {
        this.state = 'flick';
        this.flickX0 = e.clientX;
        this.upTravel = rise;
        this.peakUp = 0;
      }
      this.onCharge(Math.min(1, this.pull / 210), 'wind');
    } else if (this.state === 'flick') {
      const dy = e.clientY - this.anchorY;
      this.upTravel = this.pull - dy;
      const { vy } = this._velocity();
      if (-vy > this.peakUp) this.peakUp = -vy;
      this.onCharge(this._powerFromSpeed(this.peakUp), 'flick');
      // auto-release once the arm has come through
      if (this.upTravel > this.pull * 0.85 || (this.peakUp > 260 && vy > -60)) this._fire(e.clientX);
    }
  }

  /**
   * Flick speed (px/s) -> 0..1 power. Sensitivity calibrates the curve to the
   * player's mouse DPI and pointer acceleration; a ~2600 px/s flick at
   * sensitivity 1 lands in the middle of the sweet band.
   */
  _powerFromSpeed(v) {
    return THREE.MathUtils.clamp((v * this.sens - 380) / 3400, 0, 1);
  }

  _down(e) {
    if (!this.enabled || this.state !== 'aim') return;
    this.state = 'wind';
    this.anchorY = e.clientY;
    this.pull = 0;
    this.peakUp = 0;
    this.upTravel = 0;
    this.holdT = performance.now();
    this.aimScreen.set(e.clientX, e.clientY);
    const p = this._project(e.clientX, e.clientY);
    this.frozenTarget.copy(p ?? this.target);
    this.onCharge(0, 'wind');
  }

  _up(e) {
    if (!this.enabled) return;
    if (this.state === 'flick') { this._fire(e.clientX); return; }
    if (this.state === 'meter') {
      this.power01 = this._meterValue();
      this._fire(e.clientX, true);
      return;
    }
    if (this.state === 'wind') {
      // barely moved: treat it as a click-throw at whatever the meter reads
      if (this.pull < 30) { this.power01 = this._meterValue(); this._fire(e.clientX, true); }
      else { this.state = 'aim'; this.onCharge(0, 'off'); }
    }
  }

  _meterValue() {
    const t = (performance.now() - this.holdT) / 1000;
    return 0.5 - 0.5 * Math.cos(t * 3.4);
  }

  _fire(clientX, viaMeter = false) {
    const power01 = viaMeter ? this.power01 : this._powerFromSpeed(this.peakUp);
    const lateralPx = viaMeter ? 0 : (clientX - this.flickX0);
    const straight = viaMeter ? 1
      : 1 - Math.min(1, Math.abs(lateralPx) / Math.max(40, this.upTravel));

    this.state = 'spent';
    this.onCharge(0, 'off');
    this.onThrow({
      target: this.frozenTarget.clone(),
      power01,
      lateralPx,
      straight,
      viaMeter,
      sens: this.sens,
      assist: this.assist,
    });
  }

  /** Called by the game once a dart has been consumed and the next is ready. */
  rearm() {
    this.state = 'aim';
    this.samples.length = 0;
    this.aimScreen.copy(this.mouse);
    const p = this._project(this.mouse.x, this.mouse.y);
    if (p) this.target.copy(p);
  }

  update(dt) {
    if (!this.enabled) return;
    // re-cast every frame: the camera sways when you're drunk and moves when
    // you change stance, and the aim has to follow it even if the mouse is still
    if (this.state === 'aim') {
      const p = this._project(this.mouse.x, this.mouse.y);
      if (p) this.target.copy(p);
    }
    if (this.state === 'wind' && performance.now() - this.holdT > 420 && this.pull < 30) {
      this.state = 'meter';
    }
    if (this.state === 'meter') this.onCharge(this._meterValue(), 'meter');
  }

  dispose() { this._unbind(); }
}

/** Sweet band on the power meter — matches the CSS marker. */
export const SWEET = { lo: 0.58, hi: 0.74 };
export const SWEET_MID = (SWEET.lo + SWEET.hi) / 2;

/** How far outside the sweet band a throw landed, 0 = perfect. */
export function offSweet(p) {
  if (p < SWEET.lo) return (SWEET.lo - p) / SWEET.lo;
  if (p > SWEET.hi) return (p - SWEET.hi) / (1 - SWEET.hi);
  return 0;
}

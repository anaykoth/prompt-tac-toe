const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Mouse Lab takes 2–6 establish the gesture, not a physical mouse scale.
// Keep the scale adjustable and map displacement to pose, never to a trigger.
export const DIRECT_BAT = Object.freeze({
  initialAngle: -.85, minAngle: -1.55, maxAngle: 1.45,
  radiansPerPixel: .0024, wristPerPixel: .0018, reachPerPixel: .0003,
});

export class DirectBatControl {
  constructor({ sensitivity = 1 } = {}) { this.setSensitivity(sensitivity); this.reset(); }
  setSensitivity(value) {
    this.sensitivity = clamp(Number.isFinite(value) ? value : 1, .4, 2);
  }
  reset(time = 0) {
    this.angle = DIRECT_BAT.initialAngle; this.wrist = 0; this.reach = 0;
    this.clearMotion(time);
  }
  clearMotion(time = 0) {
    this.lastTime = Number.isFinite(time) ? time : 0; this.x = this.y = 0; this.segments = [];
    this.points = [{ x: 0, y: 0 }];
  }
  move(dx, dy, time) {
    if (![dx, dy, time].every(Number.isFinite)) return false;
    const wrist = clamp(this.wrist + dy * DIRECT_BAT.wristPerPixel * this.sensitivity, -.6, .6);
    // Clamp the pose itself: reversing at the end of a stroke responds at once,
    // even after thousands of mouse pixels beyond the available arm rotation.
    this.angle = clamp(this.angle + dx * DIRECT_BAT.radiansPerPixel * this.sensitivity + wrist - this.wrist,
      DIRECT_BAT.minAngle, DIRECT_BAT.maxAngle);
    this.wrist = wrist;
    this.reach = clamp(this.reach - dy * DIRECT_BAT.reachPerPixel * this.sensitivity, -.16, .22);
    const end = Math.max(this.lastTime + .1, time);
    this.segments.push({ from: this.lastTime, to: end, dx, dy });
    this.segments = this.segments.filter(s => s.to > end - 100);
    this.lastTime = end; this.x += dx; this.y += dy;
    if (this.points.length >= 220) this.points = this.points.filter((_, i) => i % 2 === 0);
    this.points.push({ x: this.x, y: this.y });
    return true;
  }
  snapshot(time = this.lastTime) {
    if (!Number.isFinite(time)) time = this.lastTime;
    const start = time - 40;
    let dx = 0, dy = 0;
    for (const s of this.segments) {
      const overlap = Math.max(0, Math.min(time, s.to) - Math.max(start, s.from));
      const fraction = overlap / Math.max(.1, s.to - s.from);
      dx += s.dx * fraction; dy += s.dy * fraction;
    }
    return { angle: this.angle, wrist: this.wrist, reach: this.reach,
      velocityX: dx * 25, velocityY: dy * 25, mouseSpeed: Math.hypot(dx, dy) * 25 };
  }
}

export function directBatHeight(y, { buttons = 0, keys = new Set(), dt = 0 } = {}) {
  if (!Number.isFinite(y)) y = 1.05;
  if (!Number.isFinite(dt)) dt = 0;
  const up = Number(Boolean(buttons & 1)) + Number(keys.has('KeyW'));
  const down = Number(Boolean(buttons & 2)) + Number(keys.has('KeyS'));
  return clamp(y + clamp(up - down, -1, 1) * .85 * clamp(dt, 0, .25), .35, 2.05);
}

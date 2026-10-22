const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function velocity(segments, end, window = 60) {
  const start = end - window;
  let x = 0, y = 0;
  for (const s of segments) {
    const fraction = Math.max(0, Math.min(end, s.to) - Math.max(start, s.from)) / Math.max(.25, s.to - s.from);
    x += s.dx * fraction; y += s.dy * fraction;
  }
  return { x: x * 1000 / window, y: y * 1000 / window };
}

class Gesture {
  begin(time) { this.active = true; this.lastTime = time; this.x = this.y = 0; this.segments = []; this.points = [{ x: 0, y: 0 }]; }
  record(dx, dy, time) {
    if (!this.active || ![dx, dy, time].every(Number.isFinite)) return false;
    const end = Math.max(this.lastTime + .25, time);
    this.segments.push({ from: this.lastTime, to: end, dx, dy });
    this.segments = this.segments.filter(s => s.to > end - 100);
    this.lastTime = end; this.x += dx; this.y += dy;
    if (this.points.length >= 160) this.points = this.points.filter((_, i) => i % 2 === 0);
    this.points.push({ x: this.x, y: this.y });
    return true;
  }
  cancel() { this.active = false; }
}

export class BatGesture extends Gesture {
  begin(time) { super.begin(time); this.travel = 0; this.fired = false; }
  move(dx, dy, time) {
    if (!this.record(dx, dy, time) || this.fired) return null;
    this.travel = Math.max(0, this.travel - dx);
    const speed = -velocity(this.segments, this.lastTime).x;
    if (this.travel < 20 || speed < 120) return null;
    this.fired = true; this.active = false;
    return { speed: clamp(speed, 180, 3500) };
  }
}

export class PitchGesture extends Gesture {
  begin(time) { super.begin(time); this.back = this.forward = 0; this.armed = false; }
  move(dx, dy, time) {
    if (!this.record(dx, dy, time)) return;
    this.back = Math.max(this.back, this.y);
    this.armed ||= this.back >= 14;
    if (this.armed && dy < 0) this.forward += -dy;
  }
  preview() {
    if (!this.active || !this.armed || this.forward < 24) return null;
    const v = velocity(this.segments, this.lastTime);
    if (v.y >= -90) return null;
    return { handSpeed: -v.y, speed: clamp(14 + 18 * Math.pow(-v.y / 1300, .65), 18, 40),
      // Mound camera faces +z: screen-right is world -x.
      curve: clamp(-v.x / Math.max(180, -v.y) * 1.4, -1, 1) };
  }
  release(time) {
    const pitch = time - this.lastTime <= 180 ? this.preview() : null;
    this.active = false; return pitch;
  }
}

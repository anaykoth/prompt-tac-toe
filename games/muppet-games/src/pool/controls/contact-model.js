const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * A cue moving along one continuous axis, measured in mouse pixels.
 * Positive dy draws back; negative dy advances. Contact is the zero plane.
 * Each movement represents a segment over its event interval. Velocity at
 * contact is integrated over a fixed time window, independent of event rate;
 * the portion of a movement after contact never contributes to the strike.
 */
export class ContactStroke {
  constructor({ gap = 14, minDraw = 12, maxDistance = 320, windowMs = 32 } = {}) {
    Object.assign(this, { gap, minDraw, maxDistance, windowMs });
    this.cancel();
  }

  begin(time = 0) {
    this.active = true;
    this.armed = false;
    this.distance = this.gap;
    this.maxDraw = 0;
    this.lateral = 0;
    this.forward = 0;
    this.lastTime = this.startTime = time;
    this.segments = [];
    this.contact = null;
  }

  cancel() { this.active = false; this.contact = null; this.segments = []; }

  move(dx, dy, time) {
    if (!this.active || !Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(time)) return null;
    const from = this.lastTime;
    const to = Math.max(time, from + 0.25);
    this.lastTime = to;
    const before = this.distance;
    const next = clamp(before + dy, 0, this.maxDistance);
    if (dy > 0) {
      this.maxDraw = Math.max(this.maxDraw, next - this.gap);
      this.armed ||= this.maxDraw >= this.minDraw;
    }

    const crosses = this.armed && dy < 0 && before + dy <= 0;
    const fraction = crosses ? clamp(before / -dy, 0, 1) : 1;
    const end = from + (to - from) * fraction;
    // Include only travel up to the ball, even for a large coalesced event.
    this.segments.push({ from, to: end, dx: dx * fraction, dy: -dy * fraction });
    this.lateral += dx * fraction;
    if (dy < 0) this.forward += -dy * fraction;
    this.distance = next;

    if (!crosses) {
      // A push without a backswing cannot accidentally tap the ball.
      if (!this.armed && this.distance === 0) this.distance = this.gap;
      this.segments = this.segments.filter((s) => s.to >= end - this.windowMs);
      return null;
    }

    this.contact = this.motion(end);
    this.active = false;
    this.distance = 0;
    return this.contact;
  }

  /** The very same velocity window used by contact, also available to the HUD. */
  motion(time = this.lastTime) {
    const end = Math.max(this.startTime, time);
    const start = Math.max(this.startTime, end - this.windowMs);
    let x = 0, y = 0;
    for (const s of this.segments) {
      const overlap = Math.max(0, Math.min(end, s.to) - Math.max(start, s.from));
      const share = overlap / Math.max(0.001, s.to - s.from);
      x += s.dx * share;
      y += s.dy * share;
    }
    const elapsed = Math.max(0.25, end - start);
    return {
      speed: Math.max(0, y * 1000 / elapsed),
      sideSpeed: x * 1000 / elapsed,
      lateral: this.lateral, back: this.maxDraw, forward: this.forward, time: end,
    };
  }
}

export function contactShot(hit, { yaw, tipX, tipY, elevation, power = 1, assist = 0.3 }) {
  // Keep touch shots accessible, while still requiring a deliberate fast
  // stroke for a break. Only speed at contact matters; old peaks do not.
  const speed = clamp(1.8 * Math.pow(hit.speed / 1000, 1.35) * power, 0.06, 6.2);
  const angle = Math.atan2(hit.sideSpeed, Math.max(80, hit.speed));
  const straight = clamp(1 - Math.abs(angle) * 1.3 - Math.abs(hit.lateral) / 190, 0, 1);
  return {
    yaw: yaw + angle * 0.08 * (1 - assist), speed, tipX, tipY, elevation,
    straight, pull: hit.lateral, back: hit.back, forward: hit.forward,
    contactSpeed: hit.speed, controlMode: 'contact',
  };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const meta = {
  id: 'classic', label: 'Classic stroke', shortLabel: 'CLASSIC',
  description: 'The original controls: draw back, push, then release. Your fastest movement supplies the power.',
  hint: 'CLASSIC · MOUSE aim · WASD spin · HOLD, DRAW BACK, PUSH',
};

/** Original stroke calculations, kept separately so experiments stay optional. */
export function createStroke(c) {
  return {
    begin() {
      c.back = c.forward = c.lateral = c.lateralAbs = 0;
      c.peak = 0;
      c.pushing = false;
      c.sinceSlow = 0;
      this.x = this.y = 0;
      c.trace.begin('classic', c.yaw);
    },
    move(dx, dy, now) {
      this.x += dx; this.y += dy;
      c.trace.add(this.x, this.y, dy < 0);
      if (!c.pushing) {
        if (dy > 0) c.back = Math.min(320, c.back + dy);
        if (dy < -2) c.pushing = true;
      }
      if (c.pushing && dy < 0) {
        c.forward += -dy;
        c.lateral += dx;
        c.lateralAbs += Math.abs(dx);
        const gap = c._lastT ? Math.max(1, now - c._lastT) : 16;
        const v = (-dy / gap) * 1000;
        if (v > c.peak) { c.peak = v; c.sinceSlow = 0; }
      }
      c._lastT = now;
    },
    update(dt) {
      if (!c.pushing) return;
      c.sinceSlow += dt;
      if (c.forward > 40 && c.sinceSlow > 0.055) this.fire();
      else if (c.forward > 620) this.fire();
    },
    release() { if (c.forward > 22) this.fire(); else c.cancelStroke(); },
    preview() {
      if (c.forward <= 0) return null;
      const straight = clamp(1 - (c.lateralAbs / Math.max(40, c.forward)) * 1.6, 0, 1);
      const swing = 0.72 + Math.min(1, c.back / 220) * 0.55;
      const drive = Math.pow(Math.max(0, c.peak) / 1000, 1.67);
      return {
        yaw: c.yaw, speed: clamp(1.62 * drive * swing * c.power, 0.12, 6.2),
        tipX: c.tipX, tipY: c.tipY, elevation: c.elevation,
        straight, pull: c.lateral, back: c.back, forward: c.forward,
      };
    },
    fire() { const shot = this.preview(); if (shot) c.fire(shot); },
    get visualPull() { return 0.02 + Math.min(0.3, c.back / 900); },
  };
}

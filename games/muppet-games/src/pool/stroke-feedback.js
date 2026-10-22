const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** One mapping for the preview and the real shot. Keep the original feel. */
export function resolveStroke(shot, assistLess = 0.45) {
  const wobble = (1 - shot.straight) * (1 - assistLess);
  return {
    ...shot,
    yaw: shot.yaw + (shot.pull ?? 0) * 0.00018 * wobble,
    tipX: clamp(shot.tipX + (shot.pull ?? 0) * 0.0009 * wobble, -0.9, 0.9),
  };
}

export function directionLabel(radians) {
  const degrees = Math.atan2(Math.sin(radians), Math.cos(radians)) * 180 / Math.PI;
  return Math.abs(degrees) < 0.05 ? 'STRAIGHT · 0.0°'
    : `${degrees < 0 ? '← LEFT' : 'RIGHT →'} ${Math.abs(degrees).toFixed(1)}°`;
}

/** A bounded record of the movement actually consumed by each stroke model. */
export class StrokeTrace {
  constructor() { this.points = []; this.version = 0; this.status = 'ready'; }
  begin(mode, yaw, y = 0) {
    this.mode = mode; this.aimYaw = yaw; this.status = 'live'; this.shot = null;
    this.points = [{ x: 0, y, push: false }]; this.version++;
  }
  add(x, y, push) {
    if (this.status !== 'live' || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (this.points.length >= 384) this.points = this.points.filter((_, i) => i % 2 === 0);
    this.points.push({ x, y, push }); this.version++;
  }
  finish(shot) { this.status = 'released'; this.shot = { ...shot }; this.version++; }
  cancel() { if (this.status === 'live') { this.status = 'cancelled'; this.version++; } }
}

/** The trace is an instrument, not a second input surface. */
export class StrokeFeedback {
  constructor(root) {
    this.root = root;
    if (!root) return;
    root.innerHTML = `
      <div class="stroke-heading"><b>YOUR STROKE</b><span data-stroke-status>READY</span></div>
      <svg viewBox="0 0 264 172" role="img" aria-label="Mouse stroke path: left and right across the graph, draw back down, push up.">
        <defs><clipPath id="stroke-clip"><rect x="10" y="16" width="244" height="140" /></clipPath></defs>
        <path class="stroke-grid" data-grid />
        <path class="stroke-axis" d="M132 18V156" />
        <path class="stroke-plane" data-plane />
        <text x="12" y="11" data-plane-label>CONTACT</text>
        <g clip-path="url(#stroke-clip)"><path class="stroke-draw" data-draw /><path class="stroke-push" data-push />
          <circle class="stroke-start" data-start r="3" /><circle class="stroke-end" data-end r="4" /></g>
        <text x="12" y="168">← LEFT</text><text x="252" y="168" text-anchor="end">RIGHT →</text>
        <text x="132" y="168" text-anchor="middle" data-scale>80 px / GRID</text>
      </svg>
      <div class="stroke-values"><div><small>CUE RELEASE</small><strong data-angle>STRAIGHT · 0.0°</strong></div><div><small>CUE SPEED</small><strong data-speed>— m/s</strong></div></div>
      <div class="stroke-legend"><span>BLUE: DRAW</span><span>GOLD: PUSH</span></div>
      <p data-stroke-note>Hold mouse · draw down · push up. Sideways movement steers the release.</p>
      <p class="stroke-key">TABLE: WHITE AIM / GOLD CUE DELIVERY<br>Before ball spin and collisions · Tab to hide</p>`;
    this.parts = {};
    for (const key of ['stroke-status', 'grid', 'plane', 'plane-label', 'draw', 'push', 'start', 'end', 'scale', 'angle', 'speed', 'stroke-note']) {
      this.parts[key] = root.querySelector(`[data-${key}]`);
    }
  }

  update(control, shot, visible) {
    if (!this.root) return;
    this.root.classList.toggle('hidden', !visible);
    if (!visible) return;
    const trace = control.trace, live = trace.status === 'live';
    const active = live ? shot : trace.shot;
    this.parts['stroke-status'].textContent = live ? 'LIVE' : trace.status === 'released' ? 'LAST SHOT' : trace.status === 'cancelled' ? 'CANCELLED' : 'READY';
    this.root.dataset.state = trace.status;
    this.parts.angle.textContent = directionLabel(active ? active.yaw - trace.aimYaw : 0);
    this.parts.speed.textContent = active ? `${active.speed.toFixed(2)} m/s` : '— m/s';
    const last = trace.points.at(-1);
    this.parts['stroke-note'].textContent = last && trace.points.length > 1
      ? `${Math.abs(last.x).toFixed(0)} px ${last.x < 0 ? 'left' : 'right'} of start · ${trace.status === 'cancelled' ? 'no shot taken' : live ? 'movement is live' : 'held until your next stroke'}`
      : 'Hold mouse · draw down · push up. Sideways movement steers the release.';
    if (this.version !== trace.version || this.mode !== control.mode) {
      this.version = trace.version; this.mode = control.mode; this.draw(trace, control.mode);
    }
  }

  draw(trace, mode) {
    const points = trace.points.length ? trace.points : [{ x: 0, y: mode === 'contact' ? 14 : 0, push: false }];
    let loY = 0, hiY = 320, extentX = 320;
    for (const p of points) { loY = Math.min(loY, p.y); hiY = Math.max(hiY, p.y); extentX = Math.max(extentX, Math.abs(p.x)); }
    // The same scale on both axes keeps a diagonal honest. Fit extreme strokes.
    const scale = Math.min(120 / (hiY - loY), 116 / extentX);
    const X = x => 132 + x * scale, Y = y => 28 + (y - loY) * scale;
    const point = p => `${X(p.x).toFixed(2)},${Y(p.y).toFixed(2)}`;
    const step = 80 * Math.max(1, Math.ceil(extentX / 640));
    let grid = '';
    for (let x = -extentX; x <= extentX; x += step) grid += `M${X(x)} 18V156`;
    for (let y = Math.floor(loY / step) * step; y <= hiY; y += step) grid += `M10 ${Y(y)}H254`;
    this.parts.grid.setAttribute('d', grid);
    this.parts.plane.setAttribute('d', `M10 ${Y(0)}H254`);
    this.parts['plane-label'].textContent = (trace.mode || mode) === 'contact' ? 'CONTACT · PUSH ↑' : 'PRESS · PUSH ↑';
    this.parts.scale.textContent = `${step} ${(trace.mode || mode) === 'contact' ? 'SCALED ' : ''}px / GRID`;
    let draw = '', push = '';
    for (let i = 1; i < points.length; i++) {
      const segment = `M${point(points[i - 1])}L${point(points[i])}`;
      if (points[i].push) push += segment; else draw += segment;
    }
    this.parts.draw.setAttribute('d', draw); this.parts.push.setAttribute('d', push);
    for (const [key, p] of [['start', points[0]], ['end', points.at(-1)]]) {
      this.parts[key].setAttribute('cx', X(p.x)); this.parts[key].setAttribute('cy', Y(p.y));
    }
  }
}

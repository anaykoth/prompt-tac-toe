/** Deterministic baseball simulation. Metres, seconds, +y up, fair territory -z.
 * A right-handed bat is a moving capsule. Classic gestures start a timed sweep;
 * direct control moves the capsule itself, including when held still for a bunt.
 * Base running and the choice of fielding throw are deliberately automatic.
 */
const BASE = 27.43;
const CORNER = BASE / Math.SQRT2;
export const FIELD = Object.freeze({
  moundZ: -18.44, baseDistance: BASE, fenceDistance: 95, fenceHeight: 2.5,
  ballRadius: .037, batRadius: .048, batLength: 1.12, gravity: 9.81,
  strikeZone: { minX: -.42, maxX: .42, minY: .5, maxY: 1.7 },
  bases: [{ x: 0, y: 0, z: 0 }, { x: CORNER, y: 0, z: -CORNER }, { x: 0, y: 0, z: -2 * CORNER }, { x: -CORNER, y: 0, z: -CORNER }, { x: 0, y: 0, z: 0 }],
});
const STEP = 1 / 240;
const START_ANGLE = 1.15, END_ANGLE = -1.25;
const IMPACT_FRACTION = START_ANGLE / (START_ANGLE - END_ANGLE);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const finite = (x, fallback) => Number.isFinite(x) ? x : fallback;
const lerp = (a, b, t) => a + (b - a) * t;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const vecDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const swingDuration = speed => .32 - clamp((speed - 180) / 3320, 0, 1) * .19;
const FAIR = Math.PI / 4;
const CONTACT_TRAVEL = (FIELD.ballRadius + FIELD.batRadius) * .3;
const MAX_EXIT_SPEED = 85;
const poseValues = bat => ({ angle: bat.angle, reach: bat.reach || 0, x: bat.x, y: bat.y });
const interpolatePose = (a, b, t) => ({ angle: lerp(a.angle, b.angle, t), reach: lerp(a.reach, b.reach, t), x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

function randomSource(seed) {
  let value = Number.isFinite(seed) ? seed >>> 0 : 1;
  return () => {
    value += 0x6D2B79F5;
    let n = value;
    n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

export function batPose(state) {
  const bat = state.bat;
  const handle = { x: -.82 + bat.x, y: bat.y, z: .12 - (bat.reach || 0) };
  return { handle, tip: { x: handle.x + Math.cos(bat.angle) * FIELD.batLength, y: handle.y, z: handle.z + Math.sin(bat.angle) * FIELD.batLength } };
}

function capsuleDistance(ball, handle, tip) {
  const dx = tip.x - handle.x, dy = tip.y - handle.y, dz = tip.z - handle.z;
  const length2 = dx * dx + dy * dy + dz * dz;
  // The barrel is the outer 55% of the bat; hands are not a second bat.
  const t = clamp(((ball.x - handle.x) * dx + (ball.y - handle.y) * dy + (ball.z - handle.z) * dz) / length2, .45, 1);
  const point = { x: handle.x + dx * t, y: handle.y + dy * t, z: handle.z + dz * t };
  return { distance: vecDistance(ball, point), t, point };
}

function fielders() {
  return [
    ['pitcher', 0, -18.44], ['first', 21, -23], ['second', 12, -35], ['short', -13, -34],
    ['third', -23, -22], ['left', -35, -61], ['center', 0, -72], ['right', 35, -61],
  ].map(([id, x, z]) => ({ id, x, y: 0, z, targetX: x, targetZ: z, homeX: x, homeZ: z, hasBall: false }));
}

export class BaseballGame {
  constructor({ mode = 'match', innings = 3, seed = 1 } = {}) {
    this.random = randomSource(seed);
    this.mode = ['match', 'batting', 'pitching'].includes(mode) ? mode : 'match';
    this.innings = clamp(Math.floor(finite(innings, 3)), 1, 9);
    this.events = [];
    this.runnerCounter = 0;
    this.pitchMix = 'mixed';
    this.batControl = 'classic';
    this.state = {
      mode: this.mode, role: this.mode === 'batting' ? 'batting' : 'pitching', phase: 'ready',
      inning: 1, half: this.mode === 'batting' ? 'bottom' : 'top', innings: this.innings,
      score: [0, 0], counts: { balls: 0, strikes: 0, outs: 0 }, bases: [false, false, false],
      ball: { x: 0, y: 1.85, z: FIELD.moundZ, vx: 0, vy: 0, vz: 0, visible: false },
      bat: { control: 'classic', angle: START_ANGLE, reach: 0, x: 0, y: 1.05, swinging: false, progress: 0, speed: 0, duration: .23, angularVelocity: 0, linearVelocity: { x: 0, y: 0, z: 0 }, contactSpeed: 0, attempted: false },
      pitch: null, hit: null, fielders: fielders(), runners: [],
      feedback: { title: 'PLAY BALL', detail: this.mode === 'batting' ? 'Watch the pitch. Sweep the mouse left through the ball.' : 'Aim at the catcher and throw a pitch.', outcome: 'ready', timingMs: null, distance: 0 },
      stats: { pitches: 0, swings: 0, contacts: 0, hits: 0, runs: 0, homeRuns: 0, strikeouts: 0 },
    };
    this.pendingHalf = false;
    this.play = null;
    this.swingStart = null;
    this.cpuSwing = null;
    this.directTarget = null;
    this.directActual = null;
    this.directPeakAngle = START_ANGLE;
  }

  setPitchMix(mix) { this.pitchMix = mix === 'straight' ? 'straight' : 'mixed'; return this.pitchMix; }

  _isDirect() { return this.batControl === 'direct' && this.state.role === 'batting'; }

  setBatControl(control) {
    const selected = control === 'direct' ? 'direct' : 'classic';
    if (selected === this.batControl) return selected;
    const bat = this.state.bat;
    if (this._isDirect()) this.directActual = poseValues(bat);
    this.batControl = selected; bat.control = selected;
    this.swingStart = null;
    Object.assign(bat, { swinging: false, angularVelocity: 0, linearVelocity: { x: 0, y: 0, z: 0 }, contactSpeed: 0, attempted: false });
    if (selected === 'direct') {
      this.directActual ||= { ...poseValues(bat), angle: -.85, reach: 0 };
      this.directTarget ||= { ...this.directActual };
      if (this._isDirect()) Object.assign(bat, this.directActual);
    } else if (this.state.role === 'batting') Object.assign(bat, { angle: START_ANGLE, reach: 0, progress: 0 });
    this.directPeakAngle = bat.angle;
    return selected;
  }

  /** Pose values are targets, never a queued stroke. update(dt) consumes this move. */
  setBatPose({ angle, reach, x, y } = {}) {
    const previous = this.directTarget || poseValues(this.state.bat);
    this.directTarget = {
      angle: clamp(finite(angle, previous.angle), -Math.PI, Math.PI),
      reach: clamp(finite(reach, previous.reach), -.6, .8),
      x: clamp(finite(x, previous.x), -.65, .65),
      y: clamp(finite(y, previous.y), .35, 2.05),
    };
    return { ...this.directTarget };
  }

  drainEvents() { return this.events.splice(0); }
  emit(type, data = {}) { this.events.push({ type, ...data }); }

  setBatAim(x, y) {
    if (this._isDirect()) { this.setBatPose({ x, y }); return; }
    this.state.bat.x = clamp(finite(x, this.state.bat.x), -.65, .65);
    this.state.bat.y = clamp(finite(y, this.state.bat.y), .35, 2.05);
  }

  next() {
    const s = this.state;
    if (s.phase === 'pitch' || s.phase === 'inplay' || s.phase === 'finished') return false;
    if (this.pendingHalf) {
      this.pendingHalf = false;
      s.counts = { balls: 0, strikes: 0, outs: 0 };
      s.bases = [false, false, false];
      if (this.mode === 'match') {
        if (s.half === 'top') { s.half = 'bottom'; s.role = 'batting'; }
        else { s.half = 'top'; s.role = 'pitching'; s.inning++; }
        if (s.inning > this.innings) { this._finishGame(); return true; }
      } else s.inning++;
    }
    s.phase = 'ready'; s.ball.visible = false; s.pitch = null; s.hit = null;
    s.runners = []; s.fielders = fielders(); this.play = null; this.cpuSwing = null;
    this._prepareBat();
    s.feedback = { title: s.role === 'batting' ? 'HERE COMES THE PITCH' : 'YOUR PITCH', detail: s.role === 'batting' ? 'Watch the ball into your swing.' : 'Aim, pull back, push forward, and release.', outcome: 'ready', timingMs: null, distance: 0 };
    if (s.role === 'batting') {
      if (this.pitchMix === 'straight') this._launchPitch({ targetX: 0, targetY: 1.05, speed: 25, curve: 0, drop: 0 });
      else {
        const targetX = (this.random() - .5) * .64;
        const targetY = .78 + this.random() * .57;
        this._launchPitch({ targetX, targetY, speed: 21 + this.random() * 8, curve: (this.random() - .5) * 1.6, drop: this.random() * .55 });
      }
    }
    return true;
  }

  pitch({ targetX = 0, targetY = 1.05, speed = 27, curve = 0, drop = 0 } = {}) {
    if (this.state.role !== 'pitching' || !['ready', 'result'].includes(this.state.phase)) return false;
    if (this.state.phase === 'result') { this.next(); if (this.state.role !== 'pitching' || this.state.phase !== 'ready') return false; }
    if (![targetX, targetY, speed, curve, drop].every(Number.isFinite)) return false;
    this._launchPitch({ targetX, targetY, speed, curve, drop });
    return true;
  }

  _launchPitch({ targetX, targetY, speed, curve, drop }) {
    const s = this.state;
    speed = clamp(finite(speed, 27), 18, 40); curve = clamp(finite(curve, 0), -1, 1); drop = clamp(finite(drop, 0), 0, 1);
    targetX = clamp(finite(targetX, 0), -1.2, 1.2); targetY = clamp(finite(targetY, 1.05), .2, 2.4);
    const duration = -FIELD.moundZ / speed, ax = curve * 6.5, ay = -FIELD.gravity - drop * 7;
    s.pitch = { targetX, targetY, speed, curve, drop, elapsed: 0, duration, ax, ay, crossed: false, strike: false };
    s.ball = { x: 0, y: 1.85, z: FIELD.moundZ, vx: (targetX - .5 * ax * duration * duration) / duration, vy: (targetY - 1.85 - .5 * ay * duration * duration) / duration, vz: speed, visible: true };
    this._prepareBat();
    s.phase = 'pitch'; s.hit = null; s.runners = []; this.play = null; this.swingStart = null;
    s.stats.pitches++; this.cpuSwing = null;
    if (s.role === 'pitching') {
      const inZone = Math.abs(targetX) < .47 && targetY >= .45 && targetY <= 1.75;
      if (this.random() < (inZone ? .88 : .28)) {
        const batSpeed = 1300 + this.random() * 1600;
        const timing = (this.random() + this.random() - 1) * .105;
        this.cpuSwing = { at: duration - swingDuration(batSpeed) * IMPACT_FRACTION + timing, speed: batSpeed, x: targetX - .06 + (this.random() - .5) * .25, y: targetY + (this.random() + this.random() - 1) * .16 };
      }
    }
    this.emit('pitch', { ...s.pitch });
  }

  swing({ speed = 1600 } = {}) {
    if (this.state.role !== 'batting' || this._isDirect() || !Number.isFinite(speed)) return false;
    return this._startSwing(speed);
  }

  _startSwing(speed) {
    const s = this.state;
    if (s.phase !== 'pitch' || this.swingStart !== null) return false;
    speed = clamp(speed, 180, 3500);
    Object.assign(s.bat, { swinging: true, progress: 0, angle: START_ANGLE, speed, duration: swingDuration(speed) });
    this.swingStart = s.pitch.elapsed;
    s.stats.swings++; this.emit('swing', { speed });
    return true;
  }

  _prepareBat() {
    const bat = this.state.bat;
    if (this._isDirect()) Object.assign(bat, this.directActual || poseValues(bat));
    else Object.assign(bat, { angle: START_ANGLE, reach: 0, progress: 0 });
    Object.assign(bat, { swinging: false, angularVelocity: 0, linearVelocity: { x: 0, y: 0, z: 0 }, contactSpeed: 0, attempted: false });
    this.directPeakAngle = bat.angle;
  }

  _barrelVelocity(bat, barrel) {
    const radius = barrel * FIELD.batLength, angular = bat.angularVelocity || 0;
    const linear = bat.linearVelocity || { x: 0, y: 0, z: 0 };
    return { x: linear.x - Math.sin(bat.angle) * radius * angular, y: linear.y, z: linear.z + Math.cos(bat.angle) * radius * angular };
  }

  _recordDirectAttempt(previousAngle) {
    const s = this.state, bat = s.bat;
    if (s.phase !== 'pitch') return;
    this.directPeakAngle = Math.max(this.directPeakAngle, previousAngle, bat.angle);
    // A forward stroke must actually pass through the hitting plane. Presenting
    // a stationary bat, adjusting its height, or checking a short stroke is not
    // an automatic swinging strike. At most one attempt belongs to each pitch.
    if (!bat.attempted && bat.angularVelocity < 0 && bat.angle <= .1 && this.directPeakAngle - bat.angle >= .75) {
      bat.attempted = true; s.stats.swings++;
      this.emit('swing', { control: 'direct', contactSpeed: bat.contactSpeed });
    }
  }

  _directCollision(previousBall, previousBat, dt) {
    const s = this.state, b = s.ball, p = s.pitch;
    const currentPose = poseValues(s.bat), fromPose = previousBat || currentPose;
    const startVelocity = { x: b.vx - p.ax * dt, y: b.vy - p.ay * dt, z: b.vz };
    // update() already bounds joint ball/bat travel below one third of their
    // combined radius. These matched samples follow both objects through time.
    const sample = fraction => {
      const elapsed = dt * fraction;
      const ball = {
        x: previousBall.x + startVelocity.x * elapsed + .5 * p.ax * elapsed * elapsed,
        y: previousBall.y + startVelocity.y * elapsed + .5 * p.ay * elapsed * elapsed,
        z: previousBall.z + startVelocity.z * elapsed,
      };
      const bat = { ...s.bat, ...interpolatePose(fromPose, currentPose, fraction) };
      const pose = batPose({ bat }), contact = capsuleDistance(ball, pose.handle, pose.tip);
      return { ball, bat, contact, incoming: { x: startVelocity.x + p.ax * elapsed, y: startVelocity.y + p.ay * elapsed, z: startVelocity.z } };
    };
    const radius = FIELD.ballRadius + FIELD.batRadius;
    let previousFraction = 0, previousSample = sample(0);
    for (const fraction of [0, .5, 1]) {
      let candidate = fraction === 0 ? previousSample : sample(fraction);
      if (candidate.contact.distance > radius) { previousFraction = fraction; previousSample = candidate; continue; }
      if (previousSample.contact.distance > radius) {
        let outside = previousFraction, inside = fraction;
        // Find first touch rather than using a penetrated normal, which otherwise
        // changes a glancing shot when the display frame rate changes.
        for (let i = 0; i < 12; i++) {
          const middle = (outside + inside) / 2, probe = sample(middle);
          if (probe.contact.distance <= radius) { inside = middle; candidate = probe; }
          else outside = middle;
        }
      }
      const { ball, bat, contact, incoming } = candidate;
      const surface = this._barrelVelocity(bat, contact.t);
      const normal = contact.distance > 1e-9 ? {
        x: (ball.x - contact.point.x) / contact.distance,
        y: (ball.y - contact.point.y) / contact.distance,
        z: (ball.z - contact.point.z) / contact.distance,
      } : { x: Math.sin(bat.angle), y: 0, z: -Math.cos(bat.angle) };
      const relative = { x: incoming.x - surface.x, y: incoming.y - surface.y, z: incoming.z - surface.z };
      const approach = relative.x * normal.x + relative.y * normal.y + relative.z * normal.z;
      if (approach >= -1e-8) { previousFraction = fraction; previousSample = candidate; continue; }
      Object.assign(b, ball, { vx: incoming.x, vy: incoming.y, vz: incoming.z });
      this._directContact(bat, contact.t, surface, normal, -approach);
      return true;
    }
    return false;
  }

  _directContact(bat, barrel, surface, normal, normalSpeed) {
    const s = this.state, b = s.ball;
    const barrelQuality = clamp(1 - Math.abs(barrel - .82) * 1.6, .5, 1);
    // Relative-velocity restitution: a stationary square bat returns a 25 m/s
    // pitch at roughly 6–7 m/s. Moving into it adds the real barrel velocity.
    const restitution = .22 + .06 * barrelQuality;
    // Contact also absorbs some tangential slip. This keeps a dead bat soft
    // without inventing a minimum swing speed or launching every bunt upward.
    const relative = { x: b.vx - surface.x, y: b.vy - surface.y, z: b.vz - surface.z };
    const slip = .6;
    b.vx = surface.x + restitution * normalSpeed * normal.x + slip * (relative.x + normalSpeed * normal.x);
    b.vy = surface.y + restitution * normalSpeed * normal.y + slip * (relative.y + normalSpeed * normal.y);
    b.vz = surface.z + restitution * normalSpeed * normal.z + slip * (relative.z + normalSpeed * normal.z);
    const rawSpeed = Math.hypot(b.vx, b.vy, b.vz);
    if (rawSpeed > MAX_EXIT_SPEED) { const scale = MAX_EXIT_SPEED / rawSpeed; b.vx *= scale; b.vy *= scale; b.vz *= scale; }
    const exitSpeed = Math.hypot(b.vx, b.vy, b.vz), horizontal = Math.hypot(b.vx, b.vz);
    const barrelSpeed = Math.hypot(surface.x, surface.y, surface.z);
    // Display classification only: the recorded gentle push is about 3 m/s.
    // Restitution above is continuous and has no bunt/swing speed threshold.
    const kind = barrelSpeed < 5 ? 'bunt' : 'swing';
    if (kind === 'swing' && !s.bat.attempted) {
      s.bat.attempted = true; s.stats.swings++;
      this.emit('swing', { control: 'direct', contactSpeed: barrelSpeed });
    }
    const contact = { angle: bat.angle, barrelSpeed, normalSpeed, reach: bat.reach, height: bat.y, x: bat.x, barrel, angularVelocity: bat.angularVelocity, velocity: { ...surface }, normal: { ...normal } };
    s.bat.contactSpeed = barrelSpeed;
    this._beginHit({ spray: Math.atan2(b.vx, -b.vz), launchAngle: Math.atan2(b.vy, horizontal), exitSpeed, timingMs: null, kind, contact });
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return this.state;
    if (this._isDirect()) {
      const duration = Math.min(dt, .25), from = poseValues(this.state.bat), to = this.directTarget || from;
      const angularVelocity = (to.angle - from.angle) / duration;
      const linearVelocity = { x: (to.x - from.x) / duration, y: (to.y - from.y) / duration, z: -(to.reach - from.reach) / duration };
      // Bound relative travel between collision samples, rather than capping the
      // user's angular speed. Both the ball and the entire bat move at each sample.
      const ballTravel = this.state.phase === 'pitch' ? Math.hypot(this.state.ball.vx, this.state.ball.vy, this.state.ball.vz) * duration : 0;
      const batTravel = Math.abs(to.angle - from.angle) * FIELD.batLength + Math.hypot(to.x - from.x, to.y - from.y, to.reach - from.reach);
      const steps = Math.max(1, Math.ceil(duration / STEP), Math.ceil((batTravel + ballTravel) / CONTACT_TRAVEL));
      for (let i = 1; i <= steps; i++) {
        const previousPose = poseValues(this.state.bat);
        Object.assign(this.state.bat, interpolatePose(from, to, i / steps), { angularVelocity, linearVelocity });
        const velocity = this._barrelVelocity(this.state.bat, .82);
        this.state.bat.contactSpeed = Math.hypot(velocity.x, velocity.y, velocity.z);
        this.state.bat.swinging = this.state.bat.contactSpeed > .001;
        this._recordDirectAttempt(previousPose.angle);
        this._step(duration / steps, previousPose);
      }
      Object.assign(this.state.bat, to); // exact endpoint; no drift or follow-through
      this.directActual = poseValues(this.state.bat);
      return this.state;
    }
    // Substep for continuous gestures, pitching and fielding, even on a slow frame.
    let left = Math.min(dt, .25);
    while (left > 1e-9) { const step = Math.min(STEP, left); this._step(step); left -= step; }
    return this.state;
  }

  _step(dt, previousBat) {
    const s = this.state;
    if (s.phase === 'pitch') this._stepPitch(dt, previousBat);
    else if (s.phase === 'inplay') this._stepPlay(dt);
  }

  _stepPitch(dt, previousBat) {
    const s = this.state, p = s.pitch, b = s.ball;
    const previous = { x: b.x, y: b.y, z: b.z };
    p.elapsed += dt;
    // Analytic constant-acceleration integration avoids endpoint drift with dt.
    b.x += b.vx * dt + .5 * p.ax * dt * dt; b.vx += p.ax * dt;
    b.y += b.vy * dt + .5 * p.ay * dt * dt; b.vy += p.ay * dt;
    b.z += b.vz * dt;
    if (this.cpuSwing && p.elapsed >= this.cpuSwing.at) {
      this.setBatAim(this.cpuSwing.x, this.cpuSwing.y); this._startSwing(this.cpuSwing.speed); this.cpuSwing = null;
    }
    if (this._isDirect()) {
      if (this._directCollision(previous, previousBat, dt)) return;
    } else if (this.swingStart !== null) {
      s.bat.progress = clamp((p.elapsed - this.swingStart) / s.bat.duration, 0, 1);
      s.bat.angle = lerp(START_ANGLE, END_ANGLE, s.bat.progress);
      s.bat.swinging = s.bat.progress < 1;
      if (s.bat.swinging) {
        const pose = batPose(s);
        const contact = capsuleDistance(b, pose.handle, pose.tip);
        // A second midpoint sample catches the ball between fixed substeps.
        const midpoint = { x: (previous.x + b.x) / 2, y: (previous.y + b.y) / 2, z: (previous.z + b.z) / 2 };
        const midContact = capsuleDistance(midpoint, pose.handle, pose.tip);
        if (Math.min(contact.distance, midContact.distance) <= FIELD.ballRadius + FIELD.batRadius) {
          this._contact(contact.t); return;
        }
      }
    }
    if (!p.crossed && previous.z < 0 && b.z >= 0) {
      const t = -previous.z / (b.z - previous.z), x = lerp(previous.x, b.x, t), y = lerp(previous.y, b.y, t);
      p.crossed = true;
      p.strike = x >= FIELD.strikeZone.minX - FIELD.ballRadius && x <= FIELD.strikeZone.maxX + FIELD.ballRadius && y >= FIELD.strikeZone.minY - FIELD.ballRadius && y <= FIELD.strikeZone.maxY + FIELD.ballRadius;
      p.plateX = x; p.plateY = y;
    }
    if (b.z > 1.35 || b.y < 0) {
      b.visible = false;
      if (this.swingStart !== null || (this._isDirect() && s.bat.attempted)) this._strike('SWING AND A MISS', 'The bat and ball never met. Adjust the height, reach, or timing.');
      else if (p.strike) this._strike('CALLED STRIKE', 'That pitch crossed the strike zone.');
      else this._ball();
    }
  }

  _contact(barrel) {
    const s = this.state, b = s.ball, bat = s.bat;
    const timingMs = (this.swingStart + bat.duration * IMPACT_FRACTION - s.pitch.duration) * 1000;
    const spray = clamp(bat.angle * .94 + (b.x - bat.x) * .08, -1.2, 1.2);
    const verticalError = b.y - bat.y;
    const launchAngle = clamp(.28 + verticalError * 7.5, -.28, 1.10);
    const barrelQuality = clamp(1 - Math.abs(barrel - .82) * 1.6, .5, 1);
    const exitSpeed = (22 + (bat.speed - 180) / 3320 * 28) * barrelQuality;
    b.vx = Math.sin(spray) * Math.cos(launchAngle) * exitSpeed;
    b.vz = -Math.cos(spray) * Math.cos(launchAngle) * exitSpeed;
    b.vy = Math.sin(launchAngle) * exitSpeed;
    this._beginHit({ spray, launchAngle, exitSpeed, timingMs, kind: 'swing' });
  }

  _beginHit({ spray, launchAngle, exitSpeed, timingMs, kind, contact }) {
    const s = this.state, b = s.ball;
    s.phase = 'inplay';
    if (!this._isDirect()) s.bat.swinging = false;
    s.hit = { spray, launchAngle, exitSpeed, distance: 0, landing: { x: b.x, z: b.z }, fair: Math.abs(spray) <= FAIR, timingMs, kind, ...(contact ? { contact } : {}) };
    const projectedTime = Math.max(.2, (b.vy + Math.sqrt(b.vy * b.vy + 2 * FIELD.gravity * b.y)) / FIELD.gravity);
    const predicted = { x: b.x + b.vx * projectedTime * .82, z: b.z + b.vz * projectedTime * .82 };
    s.hit.landing = predicted;
    for (const fielder of s.fielders) { fielder.targetX = predicted.x; fielder.targetZ = predicted.z; }
    this.play = { elapsed: 0, bounced: false, outcome: null, runElapsed: 0, runnersDuration: 0, flyDistance: 0, wall: false };
    s.runners = this._makeRunners(s.bases, 1);
    s.stats.contacts++;
    const detail = contact ? (kind === 'bunt' ? 'Soft hands. The pitch rebounds off the presented bat.' : 'Your barrel speed and the face at contact send the ball away.') : Math.abs(timingMs) < 25 ? 'Right on time. Watch it fly.' : timingMs < 0 ? 'Early swing: pulled toward left field.' : 'Late swing: sent toward right field.';
    s.feedback = { title: kind === 'bunt' ? 'BUNT' : 'CONTACT', detail, outcome: 'contact', timingMs, distance: 0, ...(contact ? { contact } : {}) };
    this.emit('contact', { ...s.hit });
  }

  _stepPlay(dt) {
    const s = this.state, play = this.play, b = s.ball;
    play.elapsed += dt;
    if (play.outcome) {
      play.runElapsed += dt;
      this._animateRunners(play.runElapsed, play.runnersDuration);
      if (play.runElapsed >= play.runnersDuration) { s.phase = 'result'; b.visible = false; }
      return;
    }
    const horizontalSpeed = Math.hypot(b.vx, b.vz), drag = play.bounced ? .75 : .004 * Math.hypot(horizontalSpeed, b.vy);
    b.vx *= Math.exp(-drag * dt); b.vz *= Math.exp(-drag * dt);
    b.x += b.vx * dt; b.z += b.vz * dt;
    b.y += b.vy * dt - .5 * FIELD.gravity * dt * dt; b.vy -= FIELD.gravity * dt;
    const radial = Math.hypot(b.x, b.z);
    s.hit.distance = Math.max(s.hit.distance, radial); s.feedback.distance = s.hit.distance;
    if (!play.bounced) play.flyDistance = radial;
    this._animateRunners(Math.min(play.elapsed, 3.92), 3.92);

    if (s.hit.fair && radial >= FIELD.fenceDistance && !play.wall) {
      if (!play.bounced && b.y >= FIELD.fenceHeight) { this._awardHit(4, 'HOME RUN', 'Over the wall. Everybody comes home.'); return; }
      const scale = FIELD.fenceDistance / radial;
      b.x *= scale; b.z *= scale; b.vx *= -.28; b.vz *= -.28; play.wall = true;
      this.emit('wall');
    }
    if (b.y <= FIELD.ballRadius) {
      b.y = FIELD.ballRadius;
      if (!play.bounced) {
        play.bounced = true; s.hit.landing = { x: b.x, z: b.z };
        if (!s.hit.fair) { this._foul(); return; }
        this.emit('bounce');
      }
      b.vy = Math.abs(b.vy) > 1.3 ? Math.abs(b.vy) * .24 : 0;
    }
    for (const fielder of s.fielders) {
      if (play.bounced) { fielder.targetX = b.x; fielder.targetZ = b.z; }
      const toTarget = Math.hypot(fielder.targetX - fielder.x, fielder.targetZ - fielder.z);
      const speed = fielder.id === 'pitcher' ? 5.4 : 6.5;
      const travel = Math.min(toTarget, speed * dt);
      if (toTarget > 1e-6) { fielder.x += (fielder.targetX - fielder.x) / toTarget * travel; fielder.z += (fielder.targetZ - fielder.z) / toTarget * travel; }
      const gap = distance(fielder, b);
      if (!play.bounced && play.elapsed > .4 && b.vy < 0 && b.y < 2.8 && b.y > .12 && gap < 1.25) {
        fielder.hasBall = true;
        this._out(s.hit.fair ? 'CAUGHT!' : 'CAUGHT FOUL', 'A fielder got under the ball before it bounced.', 'flyout');
        return;
      }
      if (play.bounced && gap < 1.1 && b.y < 1.5) {
        fielder.hasBall = true;
        const firstThrow = play.elapsed + distance(fielder, FIELD.bases[1]) / 29 + .32;
        if (firstThrow < BASE / 7.1 && play.flyDistance < 32) this._out('OUT AT FIRST', 'The fielding throw beat the runner to first base.', 'groundout');
        else {
          const returnTime = play.elapsed + Math.hypot(fielder.x, fielder.z) / 27 + .35;
          const bases = clamp(Math.floor(returnTime / (BASE / 7.1)), 1, 3);
          this._awardHit(bases, ['','SINGLE','DOUBLE','TRIPLE'][bases], bases === 1 ? 'Safely aboard. The fielders had to chase it down.' : 'Into the gap. There was time to take another base.');
        }
        return;
      }
    }
    if (play.elapsed > 15) {
      if (!s.hit.fair) this._foul();
      else this._awardHit(clamp(Math.floor(play.elapsed / (BASE / 7.1)), 1, 3), 'IN THE GAP', 'The fielders finally bring it back in.');
    }
  }

  _makeRunners(bases, amount) {
    const starts = [0, ...bases.flatMap((occupied, index) => occupied ? [index + 1] : [])];
    return starts.map(from => ({ id: `runner-${++this.runnerCounter}`, from, to: Math.min(4, from + amount), progress: 0, x: FIELD.bases[from].x, y: 0, z: FIELD.bases[from].z }));
  }

  _animateRunners(elapsed, duration) {
    for (const runner of this.state.runners) {
      runner.progress = clamp(elapsed / Math.max(.01, duration), 0, 1);
      if (runner.progress === 1) { runner.x = FIELD.bases[runner.to].x; runner.z = FIELD.bases[runner.to].z; continue; }
      const travelled = (runner.to - runner.from) * runner.progress;
      const base = Math.min(3, runner.from + Math.floor(travelled));
      const fraction = runner.progress === 1 ? 1 : travelled % 1;
      const from = FIELD.bases[base], to = FIELD.bases[Math.min(4, base + 1)];
      runner.x = lerp(from.x, to.x, fraction); runner.z = lerp(from.z, to.z, fraction);
    }
  }

  _awardHit(amount, title, detail) {
    const s = this.state, oldBases = [...s.bases], newBases = [false, false, false];
    let runs = amount === 4 ? 1 : 0;
    if (amount < 4) newBases[amount - 1] = true;
    oldBases.forEach((occupied, index) => { if (!occupied) return; const end = index + 1 + amount; if (end >= 4) runs++; else newBases[end - 1] = true; });
    s.bases = newBases; s.counts.balls = 0; s.counts.strikes = 0;
    s.score[s.role === 'batting' ? 1 : 0] += runs; s.stats.runs += runs; s.stats.hits++;
    if (amount === 4) s.stats.homeRuns++;
    s.runners = this._makeRunners(oldBases, amount);
    s.feedback = { ...s.feedback, title, detail: `${detail}${runs ? ` ${runs} run${runs === 1 ? '' : 's'} score.` : ''}`, outcome: ['','','double','triple','home-run'][amount] || 'single', bases: amount, runs };
    this.play.outcome = s.feedback.outcome; this.play.runElapsed = 0; this.play.runnersDuration = amount === 4 ? 4.5 : 1.5 + amount * .65;
    this.emit('hit', { bases: amount, runs, outcome: s.feedback.outcome });
  }

  _out(title, detail, outcome = 'out') {
    const s = this.state;
    s.counts.outs++; s.counts.balls = 0; s.counts.strikes = 0;
    s.runners = []; s.ball.visible = false;
    s.feedback = { ...s.feedback, title, detail, outcome };
    if (s.counts.outs >= 3) { this.pendingHalf = true; s.feedback.detail += ' Three outs. The sides change.'; }
    s.phase = 'result'; this.emit('out', { outcome, outs: s.counts.outs });
  }

  _strike(title, detail) {
    const s = this.state;
    s.counts.strikes++;
    if (s.counts.strikes >= 3) { s.stats.strikeouts++; this._out('STRIKE THREE', 'Three strikes. The batter is out.', 'strikeout'); }
    else { s.phase = 'result'; s.feedback = { title, detail, outcome: 'strike', timingMs: this.swingStart === null ? null : (this.swingStart + s.bat.duration * IMPACT_FRACTION - s.pitch.duration) * 1000, distance: 0 }; this.emit('strike', { strikes: s.counts.strikes }); }
  }

  _foul() {
    const s = this.state;
    if (s.counts.strikes < 2) s.counts.strikes++;
    s.phase = 'result'; s.ball.visible = false; s.runners = [];
    s.feedback = { ...s.feedback, title: 'FOUL BALL', detail: s.counts.strikes === 2 ? 'Outside the lines. A foul cannot become strike three.' : 'Outside the lines. That counts as a strike.', outcome: 'foul' };
    this.emit('foul');
  }

  _ball() {
    const s = this.state;
    s.counts.balls++;
    if (s.counts.balls >= 4) {
      let runs = 0;
      if (s.bases[0]) { if (s.bases[1]) { if (s.bases[2]) runs++; s.bases[2] = true; } s.bases[1] = true; }
      s.bases[0] = true;
      s.score[s.role === 'batting' ? 1 : 0] += runs; s.stats.runs += runs;
      s.counts.balls = 0; s.counts.strikes = 0;
      s.feedback = { title: 'BALL FOUR', detail: runs ? 'Bases loaded. The walk forces a run home.' : 'Take your base. Only runners who are forced must advance.', outcome: 'walk', runs, timingMs: null, distance: 0 };
      this.emit('walk', { runs });
    } else { s.feedback = { title: 'BALL', detail: 'Outside the strike zone. Good eye.', outcome: 'ball', timingMs: null, distance: 0 }; this.emit('ball', { balls: s.counts.balls }); }
    s.phase = 'result';
  }

  _finishGame() {
    const s = this.state; s.phase = 'finished'; s.inning = this.innings; s.ball.visible = false;
    const playerWon = s.score[1] > s.score[0], tied = s.score[1] === s.score[0];
    s.feedback = { title: tied ? 'HONOURS EVEN' : playerWon ? 'YOU WIN!' : 'THE LOCALS WIN', detail: `${this.innings} innings. ${s.score[1]}–${s.score[0]}. ${tied ? 'A draw at the sandlot.' : playerWon ? 'The crowd will be talking about this one.' : 'There is always another game.'}`, outcome: tied ? 'draw' : playerWon ? 'win' : 'loss', timingMs: null, distance: 0 };
    this.emit('finished', { score: [...s.score] });
  }
}

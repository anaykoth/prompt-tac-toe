import { HOCKEY, constrainTarget } from './physics.js';
import { MAX_PENDING } from '../../../shared/net/inputs.js';

const copy = (value) => structuredClone(value);
const move = (body, target, dt) => {
  const dx = target.x - body.x,
    dy = target.y - body.y,
    d = Math.hypot(dx, dy),
    travel = Math.min(d, HOCKEY.malletSpeed * dt);
  body.vx = d > 1e-8 ? ((dx / d) * travel) / dt : 0;
  body.vy = d > 1e-8 ? ((dy / d) * travel) / dt : 0;
  body.x += body.vx * dt;
  body.y += body.vy * dt;
};
const blend = (a, b, t) =>
  Object.fromEntries(
    Object.keys(a).map((k) => [
      k,
      typeof a[k] === 'number' && typeof b[k] === 'number' ? a[k] + (b[k] - a[k]) * t : a[k],
    ]),
  );

/** Predict only the local hand, replay unacknowledged input, and interpolate
 * authoritative puck/opponents. Scores and collision effects are never guessed.
 * A bounded snapshot gap freezes the world instead of extrapolating forever. */
export class HockeyNetwork {
  constructor({ now = () => performance.now(), delayMs = 80 } = {}) {
    this.now = now;
    this.delayMs = delayMs;
    this.reset();
  }
  reset() {
    this.pending = [];
    this.seq = 0;
    this.sent = 0;
    this.snapshots = [];
    this.state = null;
    this.local = null;
    this.seat = null;
    this.epoch = null;
    this.inputEpoch = null;
    this.acc = 0;
    this.offset = { x: 0, y: 0 };
    this.metrics = { correctionCm: 0, bufferMs: 0, stalled: false };
  }
  absorb(packet, seat) {
    const now = this.now();
    const changed =
      this.epoch !== packet.epoch || this.inputEpoch !== packet.inputEpoch || seat !== this.seat;
    if (changed) {
      this.reset();
      this.epoch = packet.epoch;
      this.inputEpoch = packet.inputEpoch;
      this.seat = seat;
    }
    const last = this.snapshots.at(-1);
    if (last && packet.tick < last.tick) return false;
    this.state = copy(packet.state);
    this.playing = packet.playing;
    this.lastAt = now;
    if (!last || packet.tick > last.tick || changed)
      this.snapshots.push({ tick: packet.tick, at: now, state: copy(packet.state) });
    if (this.snapshots.length > 32) this.snapshots.shift();
    if (seat !== null && this.state.mallets[seat]) {
      const ack = packet.acks?.[seat] ?? { seq: 0, half: 0 };
      this.pending = this.pending.filter((c) => c.seq > ack.seq);
      const old = this.local && { x: this.local.x + this.offset.x, y: this.local.y + this.offset.y };
      this.local = copy(this.state.mallets[seat]);
      this.pending.forEach((c, i) => move(this.local, c, (i === 0 && ack.half ? 1 : 2) / 120));
      if (old && !changed) {
        this.offset = { x: old.x - this.local.x, y: old.y - this.local.y };
        this.metrics.correctionCm = Math.hypot(this.offset.x, this.offset.y) * 100;
      }
    }
    return true;
  }
  advance(dt, target) {
    if (!this.state) return null;
    this.metrics.stalled = this.now() - this.lastAt > 500;
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= 1 / 60) {
      this.acc -= 1 / 60;
      if (this.playing && !this.metrics.stalled && this.seat !== null && this.pending.length < MAX_PENDING) {
        const c = { seq: ++this.seq, ...constrainTarget(target, this.seat) };
        this.pending.push(c);
        move(this.local, c, 1 / 60);
      }
    }
    const fade = Math.exp(-dt * 25);
    this.offset.x *= fade;
    this.offset.y *= fade;
    const out = copy(this.state),
      list = this.snapshots,
      latest = list.at(-1);
    const tick = Math.min(latest.tick, latest.tick + (this.now() - latest.at - this.delayMs) * 0.12);
    let a = list[0],
      b = latest;
    for (const s of list) {
      if (s.tick <= tick) a = s;
      else {
        b = s;
        break;
      }
    }
    const t = b.tick === a.tick ? 1 : Math.max(0, Math.min(1, (tick - a.tick) / (b.tick - a.tick)));
    // Never interpolate across a goal/serve, rematch, or roster transition.
    if (
      a.state.goals === b.state.goals &&
      a.state.status === b.state.status &&
      a.state.mallets.length === b.state.mallets.length
    ) {
      out.puck = blend(a.state.puck, b.state.puck, t);
      out.mallets = a.state.mallets.map((m, i) => blend(m, b.state.mallets[i], t));
    }
    if (this.local && this.seat !== null)
      out.mallets[this.seat] = {
        ...this.local,
        x: this.local.x + this.offset.x,
        y: this.local.y + this.offset.y,
      };
    this.metrics.bufferMs = Math.max(0, (latest.tick - tick) / 0.12);
    return out;
  }
  batch() {
    return this.pending.filter((c) => c.seq > this.sent).slice(0, 12);
  }
  markSent(commands) {
    if (commands.length) this.sent = commands.at(-1).seq;
  }
}

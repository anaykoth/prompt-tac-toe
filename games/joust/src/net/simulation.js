import { PassSim } from '../game/pass.js';
import { TICK, PASS_MAX_S, IDLE_INPUT } from '../game/spec.js';
import { RemoteLog } from './live.js';

/** Immediate bounded prediction with deterministic replay of late inputs.
 * Only the confirmed simulation may produce gameplay events. Wall time drives
 * input sampling; camera slow motion never changes the network timeline. */
export class NetworkPass {
  constructor({ seed, riders, seat, pass, predictionTicks = 6 }) {
    this.options = { seed, riders };
    this.seat = seat;
    this.remote = new RemoteLog(pass);
    this.own = [];
    this.predictionTicks = predictionTicks;
    this.revision = 0;
    this.replayed = 0;
    this.view = new PassSim(this.options);
    this.confirmed = new PassSim(this.options);
    this.contiguous = 0;
    this.maxTicks = Math.ceil(PASS_MAX_S / TICK);
  }
  capture(tick, input) {
    const end = Math.min(this.maxTicks - 1, Math.max(0, tick | 0));
    if (end < this.own.length) return;
    while (this.own.length <= end) this.own.push(this.own.at(-1) ?? IDLE_INPUT);
    this.own[end] = input;
  }
  receive(packet) {
    // A received tick is immutable. Reconnects resend the entire log safely.
    if (!this.remote.add(packet)) return false;
    while (this.remote.ticks[this.contiguous]) this.contiguous++;
    this.revision++;
    return true;
  }
  logs() {
    const logs = [];
    logs[this.seat] = this.own;
    logs[1 - this.seat] = this.remote.ticks;
    return logs;
  }
  advance() {
    const logs = this.logs(),
      confirmed = Math.min(this.own.length, this.contiguous);
    this.confirmed.logs = logs;
    while (!this.confirmed.done && this.confirmed.tick < confirmed) this.confirmed.step(TICK);
    const target = Math.min(this.own.length, this.contiguous + this.predictionTicks);
    if (this.replayed !== this.revision) {
      this.view = this.confirmed.clone();
      this.replayed = this.revision;
    }
    this.view.logs = logs;
    while (!this.view.done && this.view.tick < target) this.view.step(TICK);
    if (this.confirmed.done) this.view = this.confirmed;
    return this.view;
  }
  get done() {
    return this.confirmed.done;
  }
  get expired() {
    return this.own.length >= this.maxTicks;
  }
}

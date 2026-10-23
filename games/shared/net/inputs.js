// Fixed 60 Hz commands, consumed by a 120 Hz authoritative simulation.
// Sequences acknowledge simulated time, not merely packet receipt.
export const INPUT_HZ = 60;
export const MAX_PENDING = 120;
export class InputQueue {
  constructor() {
    this.ack = 0;
    this.received = 0;
    this.queue = [];
    this.half = 0;
  }
  push(commands) {
    if (!Array.isArray(commands) || commands.length > 12) throw Error('Invalid input batch');
    const fresh = commands.filter((c) => c?.seq > this.received);
    if (this.queue.length + fresh.length > MAX_PENDING) throw Error('Input queue full');
    let seq = this.received;
    for (const c of fresh) {
      if (!Number.isSafeInteger(c.seq) || c.seq !== ++seq || ![c.x, c.y].every(Number.isFinite))
        throw Error('Invalid input sequence');
    }
    this.queue.push(...fresh.map((c) => ({ seq: c.seq, x: c.x, y: c.y })));
    this.received = seq;
  }
  target(fallback) {
    return this.queue[0] ?? fallback;
  }
  stepped() {
    if (!this.queue.length) return;
    if (++this.half === 2) {
      this.ack = this.queue.shift().seq;
      this.half = 0;
    }
  }
  snapshot() {
    return { seq: this.ack, half: this.half };
  }
}

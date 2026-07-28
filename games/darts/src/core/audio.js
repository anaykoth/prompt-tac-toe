/** Everything is synthesised — no assets, so it ships as one static bundle. */
export class Audio {
  constructor() {
    this.ok = false;
    this.enabled = true;
    this.hype = 0;
    this.drunk = 0;
  }

  init() {
    if (this.ok) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = this.ctx = new Ctx();
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(ctx.destination);

    // a little room
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(1.5, 2.4);
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.32;
    this.verb.connect(this.verbGain).connect(this.master);

    this.noiseBuf = this._noise(3);

    /* --- crowd bed: two noise layers through moving filters --- */
    this.bedGain = ctx.createGain();
    this.bedGain.gain.value = 0.0;
    this.bedGain.connect(this.master);
    this.bedGain.connect(this.verb);

    const lo = ctx.createBufferSource();
    lo.buffer = this.noiseBuf; lo.loop = true;
    this.bedLP = ctx.createBiquadFilter();
    this.bedLP.type = 'bandpass'; this.bedLP.frequency.value = 380; this.bedLP.Q.value = 0.7;
    lo.connect(this.bedLP).connect(this.bedGain);
    lo.start();

    const hi = ctx.createBufferSource();
    hi.buffer = this.noiseBuf; hi.loop = true; hi.playbackRate.value = 1.31;
    this.bedHP = ctx.createBiquadFilter();
    this.bedHP.type = 'bandpass'; this.bedHP.frequency.value = 1650; this.bedHP.Q.value = 0.55;
    this.bedHPGain = ctx.createGain(); this.bedHPGain.gain.value = 0.32;
    hi.connect(this.bedHP).connect(this.bedHPGain).connect(this.bedGain);
    hi.start();

    this.ok = true;
  }

  resume() { if (this.ok && this.ctx.state === 'suspended') this.ctx.resume(); }

  _noise(sec) {
    const n = this.ctx.sampleRate * sec;
    const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    return b;
  }

  _impulse(sec, decay) {
    const n = this.ctx.sampleRate * sec;
    const b = this.ctx.createBuffer(2, n, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return b;
  }

  _env(node, t0, peak, attack, hold, release) {
    const g = node.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.setValueAtTime(Math.max(0.0002, peak), t0 + attack + hold);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
  }

  _burst({ freq = 400, type = 'lowpass', Q = 1, peak = 0.3, attack = 0.002, hold = 0.01, release = 0.15, rate = 1, sweep = null, verb = 0.2 }) {
    if (!this.ok || !this.enabled) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = Q;
    if (sweep) {
      f.frequency.setValueAtTime(freq, t0);
      f.frequency.exponentialRampToValueAtTime(Math.max(40, sweep), t0 + attack + hold + release);
    }
    const g = ctx.createGain();
    src.connect(f).connect(g).connect(this.master);
    if (verb > 0) {
      const vg = ctx.createGain(); vg.gain.value = verb;
      g.connect(vg).connect(this.verb);
    }
    this._env(g, t0, peak, attack, hold, release);
    src.start(t0);
    src.stop(t0 + attack + hold + release + 0.05);
  }

  _tone({ freq = 440, type = 'sine', peak = 0.2, attack = 0.003, hold = 0.02, release = 0.2, slide = null, verb = 0.25 }) {
    if (!this.ok || !this.enabled) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + attack + hold + release);
    const g = ctx.createGain();
    o.connect(g).connect(this.master);
    if (verb > 0) { const vg = ctx.createGain(); vg.gain.value = verb; g.connect(vg).connect(this.verb); }
    this._env(g, t0, peak, attack, hold, release);
    o.start(t0);
    o.stop(t0 + attack + hold + release + 0.05);
  }

  /* ---------------- game sounds ---------------- */

  whoosh() { this._burst({ freq: 2600, type: 'bandpass', Q: 0.8, peak: 0.10, attack: 0.01, hold: 0.02, release: 0.18, sweep: 700, verb: 0.1 }); }

  thud(force = 1) {
    this._burst({ freq: 900, type: 'lowpass', peak: 0.4 * force, attack: 0.001, hold: 0.004, release: 0.09, rate: 1.6, verb: 0.25 });
    this._tone({ freq: 128, type: 'triangle', peak: 0.26 * force, attack: 0.001, hold: 0.006, release: 0.13, slide: 62, verb: 0.2 });
  }

  wire() {
    this._tone({ freq: 2380, type: 'square', peak: 0.09, attack: 0.001, hold: 0.004, release: 0.32, slide: 1900, verb: 0.5 });
    this._tone({ freq: 3610, type: 'sine', peak: 0.05, attack: 0.001, hold: 0.002, release: 0.24, verb: 0.5 });
  }

  clatter() {
    for (let i = 0; i < 5; i++) {
      setTimeout(() => this._burst({
        freq: 1200 + Math.random() * 2400, type: 'bandpass', Q: 3,
        peak: 0.12 - i * 0.018, attack: 0.001, hold: 0.002, release: 0.05, rate: 2,
      }), i * (40 + Math.random() * 55));
    }
  }

  /** Crowd surge. amount 0..1.6, negative = groan. */
  roar(amount) {
    if (!this.ok || !this.enabled) return;
    const a = Math.abs(amount);
    const ctx = this.ctx, t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = amount > 0 ? 1 + a * 0.35 : 0.62;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.6;
    const base = amount > 0 ? 520 : 240;
    f.frequency.setValueAtTime(base, t0);
    f.frequency.linearRampToValueAtTime(amount > 0 ? base + a * 1400 : 180, t0 + 0.28);
    f.frequency.linearRampToValueAtTime(base * 0.75, t0 + 0.9 + a);
    const g = ctx.createGain();
    src.connect(f).connect(g).connect(this.master);
    const vg = ctx.createGain(); vg.gain.value = 0.5; g.connect(vg).connect(this.verb);
    this._env(g, t0, 0.1 + a * 0.42, 0.09, 0.2 + a * 0.5, 0.9 + a * 1.2);
    src.start(t0);
    src.stop(t0 + 3.2);

    if (amount > 0.55) {
      const n = Math.round(3 + a * 9);
      for (let i = 0; i < n; i++) {
        setTimeout(() => this._tone({
          freq: 420 + Math.random() * 900, type: 'sawtooth',
          peak: 0.028, attack: 0.03, hold: 0.05, release: 0.3,
          slide: 300 + Math.random() * 1500, verb: 0.6,
        }), 60 + Math.random() * 900);
      }
    }
    if (amount < -0.3) {
      for (let i = 0; i < 4; i++) {
        setTimeout(() => this._tone({
          freq: 150 + Math.random() * 90, type: 'sawtooth',
          peak: 0.05, attack: 0.12, hold: 0.2, release: 0.6, slide: 90, verb: 0.5,
        }), Math.random() * 500);
      }
    }
  }

  bell() {
    [880, 1320, 1760].forEach((f, i) =>
      this._tone({ freq: f, type: 'sine', peak: 0.14 / (i + 1), attack: 0.002, hold: 0.05, release: 1.6, verb: 0.7 }));
  }

  click() { this._burst({ freq: 3200, type: 'highpass', peak: 0.05, attack: 0.001, hold: 0.001, release: 0.02, verb: 0 }); }

  /* ---------------- pool ---------------- */

  /** Phenolic on phenolic: a hard, short, bright crack that rises with speed. */
  ballClick(speed = 1) {
    const s = Math.max(0.05, Math.min(1, speed / 4));
    this._tone({
      freq: 1750 + s * 900, type: 'sine', peak: 0.05 + s * 0.16,
      attack: 0.0008, hold: 0.002, release: 0.05 + s * 0.05, slide: 1200, verb: 0.22,
    });
    this._burst({
      freq: 4200 + s * 3000, type: 'bandpass', Q: 2.2, peak: 0.05 + s * 0.13,
      attack: 0.0006, hold: 0.0015, release: 0.028, rate: 2.4, verb: 0.18,
    });
  }

  /** Leather tip into the ball — softer, woodier, no ring. */
  cueStrike(power = 1) {
    const s = Math.max(0.08, Math.min(1, power / 5));
    this._burst({
      freq: 900 + s * 700, type: 'bandpass', Q: 1.2, peak: 0.10 + s * 0.16,
      attack: 0.0008, hold: 0.004, release: 0.06, rate: 1.3, verb: 0.2,
    });
    this._tone({
      freq: 420 + s * 180, type: 'triangle', peak: 0.06 + s * 0.1,
      attack: 0.001, hold: 0.004, release: 0.07, slide: 220, verb: 0.15,
    });
  }

  /** Rubber cushion: dull, damped, a little boxy. */
  railThud(speed = 1) {
    const s = Math.max(0.05, Math.min(1, speed / 3.5));
    this._burst({
      freq: 380 + s * 260, type: 'lowpass', peak: 0.09 + s * 0.16,
      attack: 0.001, hold: 0.005, release: 0.08, rate: 1.1, verb: 0.26,
    });
    this._tone({
      freq: 180 + s * 90, type: 'sine', peak: 0.05 + s * 0.08,
      attack: 0.001, hold: 0.006, release: 0.11, slide: 100, verb: 0.2,
    });
  }

  /** Down it goes: the drop, then the ball running the trough. */
  pocketDrop() {
    this._burst({ freq: 520, type: 'lowpass', peak: 0.2, attack: 0.001, hold: 0.01, release: 0.16, rate: 0.9, verb: 0.4 });
    for (let i = 0; i < 4; i++) {
      setTimeout(() => this._tone({
        freq: 240 - i * 30 + Math.random() * 60, type: 'triangle',
        peak: 0.09 - i * 0.015, attack: 0.001, hold: 0.008, release: 0.12,
        slide: 120, verb: 0.45,
      }), 90 + i * (70 + Math.random() * 60));
    }
  }

  glug() {
    if (!this.ok || !this.enabled) return;
    for (let i = 0; i < 4; i++) {
      setTimeout(() => this._tone({
        freq: 190 - i * 22, type: 'sine', peak: 0.16,
        attack: 0.01, hold: 0.03, release: 0.09, slide: 90 - i * 12, verb: 0.15,
      }), i * 135);
    }
    setTimeout(() => this._burst({
      freq: 700, type: 'lowpass', peak: 0.1, attack: 0.02,
      hold: 0.05, release: 0.35, sweep: 200,
    }), 560);
  }

  update(dt, hype) {
    if (!this.ok) return;
    this.hype += (hype - this.hype) * Math.min(1, dt * 3);
    const target = this.enabled ? 0.045 + this.hype * 0.5 : 0;
    // the room goes muddy and distant the further gone you are
    const muffle = 1 - this.drunk * 0.55;
    this.bedGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.18);
    this.bedLP.frequency.setTargetAtTime((360 + this.hype * 640) * muffle, this.ctx.currentTime, 0.25);
    this.bedHPGain.gain.setTargetAtTime((0.22 + this.hype * 0.9) * muffle, this.ctx.currentTime, 0.25);
  }
}

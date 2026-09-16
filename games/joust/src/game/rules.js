/** TILT ALLEY — match scoring over a series of passes. */
import { DEFAULT_PASSES, POINTS } from './spec.js';

export class Match {
  constructor(opts = {}) {
    this.passes = opts.passes ?? DEFAULT_PASSES;
    this.toUnhorsing = opts.toUnhorsing ?? false;
    this.names = opts.names ?? ['RED', 'BLUE'];
    this.reset();
  }

  reset() {
    this.score = [0, 0];
    this.pass = 1;
    this.finished = false;
    this.winner = null;
    this.history = [];
    this.suddenDeath = false;
  }

  /** Fold one pass result (from simulatePass / PassSim.result) into the match. */
  applyPass(result) {
    if (this.finished) return this;
    const s = result?.score ?? [0, 0];
    this.score[0] += s[0] || 0;
    this.score[1] += s[1] || 0;
    this.history.push({ pass: this.pass, score: [s[0] || 0, s[1] || 0], events: result?.events ?? [], endReason: result?.endReason ?? null, unseated: result?.unseated ?? [false, false] });

    const un = result?.unseated ?? [false, false];
    if (this.toUnhorsing && (un[0] || un[1])) {
      this.finished = true;
      this.winner = un[0] && un[1] ? this._leader() : (un[0] ? 1 : 0);
      return this;
    }

    if (this.pass >= this.passes) {
      const lead = this._leader();
      if (lead === null) this.suddenDeath = true;      // tie: ride another pass
      else { this.finished = true; this.winner = lead; }
    }
    this.pass++;
    return this;
  }

  _leader() {
    if (this.score[0] === this.score[1]) return null;
    return this.score[0] > this.score[1] ? 0 : 1;
  }

  get leader() { return this._leader(); }

  toJSON() {
    return {
      passes: this.passes, toUnhorsing: this.toUnhorsing, names: [...this.names],
      score: [...this.score], pass: this.pass, finished: this.finished,
      winner: this.winner, history: this.history, suddenDeath: this.suddenDeath,
    };
  }

  static fromJSON(o) {
    const m = new Match({ passes: o.passes, toUnhorsing: o.toUnhorsing, names: o.names });
    Object.assign(m, {
      score: [...o.score], pass: o.pass, finished: o.finished, winner: o.winner,
      history: o.history ?? [], suddenDeath: !!o.suddenDeath,
    });
    return m;
  }

  /** Adopt another match's state without breaking object identity. */
  adopt(o) { Object.assign(this, Match.fromJSON(o)); return this; }
}

/** Crowd-facing read of a pass, darts' visitReaction in a helmet. */
export function passSummary(result) {
  const ev = result?.events ?? [];
  const has = (t) => ev.some((e) => e.type === t);
  const pts = (result?.score ?? [0, 0]);
  const small = `${pts[0]} — ${pts[1]}`;
  if (has('unseat')) return { big: 'UNHORSED', small, hype: 1.7 };
  if (has('break')) return { big: 'LANCE SHATTERED', small, hype: 1.2 };
  if (has('helmet-hit')) return { big: 'BONK', small, hype: 1.1 };
  if (has('helm')) return { big: 'HELM', small, hype: 1.0 };
  if (has('foul') || has('barrier')) return { big: 'FOUL', small, hype: -0.85 };
  if (has('hit') || has('glance')) return { big: 'GLANCE', small, hype: 0.3 };
  return { big: 'NOTHING', small, hype: -0.5 };
}

export { POINTS };

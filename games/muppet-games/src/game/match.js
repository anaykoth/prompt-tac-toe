import { SECTORS, R } from '../world/dartboard.js';

/* ------------------------------------------------------------------ */
/* Board targets                                                       */
/* ------------------------------------------------------------------ */

const DEG = Math.PI / 180;

/** Board-local (x, y) in metres for a target label like 'T20', 'D16', '19', 'BULL'. */
export function targetPoint(label) {
  if (label === 'BULL' || label === 'D25' || label === '50') return { x: 0, y: 0 };
  if (label === '25') return { x: 0, y: (R.bull + R.outerBull) / 2 };
  const m = /^([TD]?)(\d+)$/.exec(label);
  if (!m) return { x: 0, y: 0 };
  const mult = m[1], n = +m[2];
  const idx = SECTORS.indexOf(n);
  if (idx < 0) return { x: 0, y: 0 };
  const a = (90 - idx * 18) * DEG;
  const r = mult === 'T' ? (R.trebleIn + R.trebleOut) / 2
    : mult === 'D' ? (R.doubleIn + R.doubleOut) / 2
      : (R.trebleOut + R.doubleIn) / 2 - 0.012;   // fat part of the single
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

/* ------------------------------------------------------------------ */
/* Checkout finder                                                     */
/* ------------------------------------------------------------------ */

const SINGLES = [];
const DOUBLES = [];
const TREBLES = [];
for (let i = 1; i <= 20; i++) {
  SINGLES.push({ label: `${i}`, v: i });
  DOUBLES.push({ label: `D${i}`, v: i * 2 });
  TREBLES.push({ label: `T${i}`, v: i * 3 });
}
SINGLES.push({ label: '25', v: 25 });
DOUBLES.push({ label: 'BULL', v: 50 });

const ALL = [...TREBLES, ...DOUBLES, ...SINGLES];
/** Doubles a player would rather be left on, best first. */
const NICE_DOUBLES = [32, 40, 16, 20, 8, 24, 36, 4, 12, 28, 10, 18, 2, 6, 14, 22, 26, 30, 34, 38, 50];

/**
 * Shortest checkout for `rem` in at most `darts` throws.
 * @returns {string[]|null}
 */
export function checkout(rem, darts = 3, doubleOut = true) {
  if (rem <= 0 || rem > 170) return null;
  const finishers = doubleOut ? DOUBLES : ALL;

  for (const f of finishers) if (f.v === rem) return [f.label];
  if (darts < 2) return null;

  const rank = (a) => {
    const i = NICE_DOUBLES.indexOf(a);
    return i < 0 ? 99 : i;
  };

  let best = null;
  for (const a of ALL) {
    const left = rem - a.v;
    if (left <= 0) continue;
    for (const f of finishers) {
      if (f.v === left) {
        const score = rank(f.v) + (a.label[0] === 'T' ? 0 : 0.5);
        if (!best || score < best.score) best = { path: [a.label, f.label], score };
      }
    }
  }
  if (best) return best.path;
  if (darts < 3) return null;

  for (const a of [...TREBLES].reverse()) {
    const r2 = rem - a.v;
    if (r2 <= 1) continue;
    const sub = checkout(r2, 2, doubleOut);
    if (sub) return [a.label, ...sub];
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Match state                                                         */
/* ------------------------------------------------------------------ */

export class Match {
  constructor(opts = {}) {
    this.start = opts.start ?? 501;
    this.doubleOut = opts.doubleOut ?? true;
    this.names = opts.names ?? ['PLAYER ONE', 'PLAYER TWO'];
    this.reset();
  }

  reset() {
    this.score = [this.start, this.start];
    this.visitStart = [this.start, this.start];
    this.dartsThrown = [0, 0];
    this.totalScored = [0, 0];
    this.current = 0;
    this.dartsLeft = 3;
    this.visit = [];
    this.round = 1;
    this.finished = false;
    this.winner = null;
    this.history = [];
  }

  get remaining() { return this.score[this.current]; }

  average(p) {
    const d = this.dartsThrown[p];
    return d ? (this.totalScored[p] / d) * 3 : null;
  }

  suggestion(p = this.current) {
    return checkout(this.score[p], p === this.current ? this.dartsLeft : 3, this.doubleOut);
  }

  /**
   * Register one dart.
   * @param {object|null} sc  result of scoreAt(), or null for a miss / bounce-out
   * @returns {object} { scored, label, bust, checkoutWin, visitOver, total }
   */
  applyDart(sc) {
    if (this.finished) return { scored: 0, label: '—', bust: false, visitOver: false };

    const p = this.current;
    const scored = sc ? sc.value : 0;
    const label = sc ? sc.label : 'MISS';
    const isDouble = sc ? (sc.mult === 2 || sc.ring === 'bull') : false;

    this.dartsLeft--;
    this.dartsThrown[p]++;
    this.visit.push(label);

    const before = this.score[p];
    const rem = before - scored;
    let bust = false, win = false;

    if (rem < 0) bust = true;
    else if (rem === 0) {
      if (this.doubleOut && !isDouble) bust = true;
      else win = true;
    } else if (rem === 1 && this.doubleOut) bust = true;

    if (bust) {
      // the whole visit is wiped, including darts already counted
      this.totalScored[p] -= (this.visitStart[p] - before);
      this.score[p] = this.visitStart[p];
      this.dartsLeft = 0;
    } else {
      this.score[p] = rem;
      this.totalScored[p] += scored;
      if (win) {
        this.finished = true;
        this.winner = p;
      }
    }

    const visitOver = this.dartsLeft <= 0 || win;
    const total = this.visitStart[p] - this.score[p];

    return { scored, label, bust, win, visitOver, total, player: p, remaining: this.score[p] };
  }

  /** Hand the darts over. */
  endVisit() {
    if (this.finished) return;
    const p = this.current;
    this.history.push({ player: p, darts: [...this.visit], total: this.visitStart[p] - this.score[p] });
    this.visitStart[p] = this.score[p];
    this.visit = [];
    this.current = 1 - p;
    this.dartsLeft = 3;
    if (this.current === 0) this.round++;
  }
}

/* ------------------------------------------------------------------ */
/* CPU opponent                                                        */
/* ------------------------------------------------------------------ */

/**
 * `sigma` is the CPU's group radius on the board, in metres. It maps onto a
 * real 3-dart average roughly as: 0.022 -> 38, 0.0125 -> 62, 0.0065 -> 95.
 * (A club player averages ~45-60; a touring pro ~95-105.)
 */
export const AI_LEVELS = {
  'ai-pub': { name: 'BARRY (PUB)', sigma: 0.0215, bias: 0.008, think: [700, 1500], nerve: 0.5 },
  'ai-shark': { name: 'THE SHARK', sigma: 0.0115, bias: 0.004, think: [520, 1100], nerve: 0.22 },
  'ai-robot': { name: 'UNIT 180', sigma: 0.0062, bias: 0.0012, think: [340, 700], nerve: 0.05 },
};

function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** What the CPU is going for this dart. */
export function aiTarget(match) {
  const rem = match.remaining;
  const darts = match.dartsLeft;
  const co = checkout(rem, darts, match.doubleOut);
  if (co) return co[0];

  if (rem > 180 || !match.doubleOut) return 'T20';
  // set up a friendly double
  if (rem <= 98) {
    for (const d of NICE_DOUBLES) {
      const need = rem - d;
      if (need <= 0) continue;
      const cand = ALL.find((a) => a.v === need);
      if (cand) return cand.label;
    }
  }
  return 'T20';
}

/** Where the CPU's dart actually goes, in board-local metres. */
export function aiAim(match, level) {
  const L = AI_LEVELS[level] ?? AI_LEVELS['ai-shark'];
  const label = aiTarget(match);
  const t = targetPoint(label);
  // pressure: doubles for the match are harder
  const clutch = match.remaining <= 50 && checkout(match.remaining, match.dartsLeft, match.doubleOut)
    ? 1 + L.nerve : 1;
  const s = L.sigma * clutch;
  return {
    label,
    x: t.x + gauss() * s + (Math.random() - 0.5) * L.bias,
    y: t.y + gauss() * s * 1.15 + (Math.random() - 0.5) * L.bias,
  };
}

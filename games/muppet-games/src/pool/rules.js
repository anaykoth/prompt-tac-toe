/**
 * Eight-ball: match state, foul adjudication, and an opponent that finds its
 * shots by actually playing them on a scratch copy of the table.
 *
 * Pure logic — no three.js, no DOM — so the same file can adjudicate on a
 * server when this goes online.
 */
import { BALL_R, TABLE, mulberry32 } from './physics.js';

export const SOLIDS = 'solids';
export const STRIPES = 'stripes';

export const groupOf = (n) => (n === 8 ? 'eight' : n < 8 ? SOLIDS : STRIPES);

export const FOULS = {
  scratch: 'SCRATCHED',
  noContact: 'NO BALL HIT',
  wrongBall: 'WRONG BALL FIRST',
  noRail: 'NO RAIL AFTER CONTACT',
  offTable: 'BALL OFF THE TABLE',
  earlyEight: 'HIT THE 8 EARLY',
  pushedJunk: 'MOVED THE RUBBISH',
};

export class Match {
  constructor(opts = {}) {
    this.names = opts.names ?? ['YOU', 'THEM'];
    this.group = [null, null];        // solids / stripes once the table is open
    this.current = 0;
    this.breaker = 0;
    this.open = true;                 // groups not yet assigned
    this.ballInHand = false;
    this.behindHeadString = true;     // ball in hand is restricted for the break
    this.finished = false;
    this.winner = -1;
    this.shots = [0, 0];
    this.pots = [0, 0];
    this.fouls = [0, 0];
    this.consecutiveFouls = [0, 0];
    this.history = [];
    this.broken = false;
    this.calledPocket = null;         // set when shooting at the 8
    this.lastResult = null;
  }

  get opponent() { return 1 - this.current; }

  groupName(p) { return this.group[p] ?? '—'; }

  /** Object balls of a player's group still on the table. */
  remaining(sim, p) {
    const g = this.group[p];
    if (!g) return sim.live().filter((b) => b.num > 0 && b.num !== 8 && !b.junk).map((b) => b.num);
    return sim.live()
      .filter((b) => !b.junk && b.num > 0 && b.num !== 8 && groupOf(b.num) === g)
      .map((b) => b.num);
  }

  /** True when this player is shooting at the 8-ball. */
  onEight(sim, p = this.current) {
    return !this.open && this.remaining(sim, p).length === 0;
  }

  /** Which balls the player is allowed to hit first, right now. */
  legalTargets(sim, p = this.current) {
    if (this.open) {
      return sim.live().filter((b) => !b.junk && b.num > 0 && b.num !== 8).map((b) => b.num);
    }
    if (this.onEight(sim, p)) return [8];
    return this.remaining(sim, p);
  }

  /**
   * Adjudicate a completed shot from the sim's log.
   * @returns {{foul:string|null, potted:number[], turnOver:boolean, win:boolean,
   *            lose:boolean, assigned:string|null, messages:string[]}}
   */
  applyShot(sim, log) {
    const p = this.current;
    const res = {
      foul: null, potted: log.pocketed.filter((n) => n !== 0),
      turnOver: false, win: false, lose: false, assigned: null, messages: [],
    };
    this.shots[p]++;

    /* Legality has to be judged against the table as it was when the player
       struck, not as it is now. Judging it afterwards means that potting your
       last group ball retroactively makes the 8 the only legal target — and the
       shot you just played gets called as hitting the wrong ball first. */
    const potted = new Set([...log.pocketed, ...log.offTable]);
    const preShot = sim.balls
      .filter((b) => !b.junk && b.num > 0 && (b.live || potted.has(b.num)))
      .map((b) => b.num);
    const preMine = this.open
      ? preShot.filter((n) => n !== 8)
      : preShot.filter((n) => n !== 8 && groupOf(n) === this.group[p]);
    const wasOnEight = !this.open && preMine.length === 0;
    const legal = this.open ? preShot.filter((n) => n !== 8)
      : (wasOnEight ? [8] : preMine);

    /* ---- fouls ---- */
    if (log.cueScratch) res.foul = FOULS.scratch;
    else if (log.firstContact === null) res.foul = FOULS.noContact;
    else if (!this.open && !legal.includes(log.firstContact)) {
      res.foul = log.firstContact === 8 ? FOULS.earlyEight : FOULS.wrongBall;
    } else if (!log.railAfterContact && log.pocketed.length === 0) {
      res.foul = FOULS.noRail;
    } else if (log.offTable.length) res.foul = FOULS.offTable;

    /* ---- the 8-ball settles everything ---- */
    const eightDown = log.pocketed.includes(8);
    if (eightDown) {
      if (this.isBreak()) {
        // 8 on the break: spot it and play on, the friendly bar-room rule
        res.messages.push('EIGHT ON THE BREAK — SPOTTED');
      } else if (!wasOnEight || res.foul) {
        res.lose = true;
        res.messages.push(res.foul ? 'FOULED ON THE EIGHT' : 'EIGHT BALL TOO EARLY');
      } else if (this.calledPocket !== null && log.pocketDetail[8] !== this.calledPocket) {
        res.lose = true;
        res.messages.push('WRONG POCKET');
      } else {
        res.win = true;
      }
    }

    /* ---- group assignment: the first legal pot after the break opens it ---- */
    if (this.open && !res.foul && !this.isBreak()) {
      const mine = res.potted.filter((n) => n !== 8);
      if (mine.length) {
        const g = groupOf(mine[0]);
        this.group[p] = g;
        this.group[1 - p] = g === SOLIDS ? STRIPES : SOLIDS;
        this.open = false;
        res.assigned = g;
        res.messages.push(`${this.names[p]} IS ${g.toUpperCase()}`);
      }
    }

    this.pots[p] += res.potted.filter((n) => n !== 8 && (this.open || groupOf(n) === this.group[p])).length;

    if (res.win || res.lose) {
      this.finished = true;
      this.winner = res.win ? p : 1 - p;
      this.lastResult = res;
      this.history.push({ p, ...res });
      return res;
    }

    /* ---- who shoots next ---- */
    if (res.foul) {
      this.fouls[p]++;
      this.consecutiveFouls[p]++;
      res.turnOver = true;
      this.ballInHand = true;
      this.behindHeadString = false;
    } else {
      this.consecutiveFouls[p] = 0;
      const potMine = res.potted.some((n) => n !== 8
        && (this.open || groupOf(n) === this.group[p]));
      res.turnOver = !potMine;
      this.ballInHand = false;
    }

    if (this.isBreak()) this.broken = true;
    if (res.turnOver) this.current = 1 - p;
    this.lastResult = res;
    this.history.push({ p, ...res });
    return res;
  }

  isBreak() { return !this.broken; }

  /** Legal region for placing the cue ball. */
  placementBounds() {
    if (this.isBreak() || this.behindHeadString) {
      return { minX: -TABLE.halfLen + BALL_R, maxX: -TABLE.halfLen * 0.5,
        minZ: -TABLE.halfWid + BALL_R, maxZ: TABLE.halfWid - BALL_R };
    }
    return { minX: -TABLE.halfLen + BALL_R, maxX: TABLE.halfLen - BALL_R,
      minZ: -TABLE.halfWid + BALL_R, maxZ: TABLE.halfWid - BALL_R };
  }

  reset() {
    const b = 1 - this.breaker;
    Object.assign(this, new Match({ names: this.names }));
    this.breaker = b;
    this.current = b;
  }
}

/* ================================================================== */
/* Opponent                                                           */
/* ================================================================== */

export const AI_LEVELS = {
  'ai-drunk': { name: 'DEREK (SIX PINTS)', err: 0.055, speedErr: 0.35, look: 10, safety: 0.1 },
  'ai-local': { name: 'THE LOCAL', err: 0.022, speedErr: 0.18, look: 22, safety: 0.35 },
  'ai-hustler': { name: 'THE HUSTLER', err: 0.007, speedErr: 0.07, look: 46, safety: 0.7 },
};

const ghostBall = (obj, px, pz) => {
  const dx = px - obj.x, dz = pz - obj.z;
  const d = Math.hypot(dx, dz) || 1;
  return { x: obj.x - (dx / d) * 2 * BALL_R, z: obj.z - (dz / d) * 2 * BALL_R };
};

/** Is the straight run between two points clear of every other ball? */
function pathClear(sim, ax, az, bx, bz, ignore, radius = BALL_R * 1.98) {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return true;
  const ux = dx / len, uz = dz / len;
  for (const b of sim.live()) {
    if (ignore.includes(b)) continue;
    const t = (b.x - ax) * ux + (b.z - az) * uz;
    if (t <= 0 || t >= len) continue;
    const px = ax + ux * t, pz = az + uz * t;
    if (Math.hypot(b.x - px, b.z - pz) < radius) return false;
  }
  return true;
}

/**
 * Pick a shot. Candidates are generated geometrically (ball × pocket), scored
 * by how hard the cut is and whether the lines are clear, then the best few are
 * *simulated* — which is the only honest way to know whether a shot works on a
 * table with a beer bottle sitting on it.
 */
export function aiShot(sim, match, level = 'ai-local', rng = Math.random) {
  const cfg = AI_LEVELS[level] ?? AI_LEVELS['ai-local'];
  const cue = sim.cue;
  if (!cue || !cue.live) return null;
  const targets = match.legalTargets(sim);
  const candidates = [];

  for (const num of targets) {
    const obj = sim.byNum(num);
    if (!obj) continue;
    for (const p of sim.geo.pockets) {
      const g = ghostBall(obj, p.x, p.z);
      const cueToGhost = Math.hypot(g.x - cue.x, g.z - cue.z);
      const objToPocket = Math.hypot(p.x - obj.x, p.z - obj.z);
      if (cueToGhost < BALL_R) continue;

      // cut angle between the cue's approach and the object's line to the pocket
      const aimA = Math.atan2(g.z - cue.z, g.x - cue.x);
      const potA = Math.atan2(p.z - obj.z, p.x - obj.x);
      let cut = Math.abs(aimA - potA);
      while (cut > Math.PI) cut = Math.abs(cut - Math.PI * 2);
      if (cut > 1.25) continue;                       // beyond ~72° is a prayer

      if (!pathClear(sim, cue.x, cue.z, g.x, g.z, [cue, obj])) continue;
      if (!pathClear(sim, obj.x, obj.z, p.x, p.z, [obj])) continue;

      // easier = shorter, straighter, and not cutting into a side pocket
      const difficulty = cut * 1.6 + objToPocket * 0.9 + cueToGhost * 0.35
        + (p.kind === 'side' ? cut * 0.8 : 0);
      const speed = Math.min(4.6, 1.0 + objToPocket * 1.05 + cueToGhost * 0.5 + cut * 1.2);
      candidates.push({ num, pocket: p.id, yaw: aimA, speed, difficulty, cut });
    }
  }

  candidates.sort((a, b) => a.difficulty - b.difficulty);
  const shortlist = candidates.slice(0, Math.max(3, Math.round(cfg.look / 4)));

  /* ---- try the shortlist on a scratch table ---- */
  const snap = sim.snapshot();
  const legalNow = targets.slice();          // fixed: the sim mutates during trials
  let best = null;
  for (const c of shortlist) {
    for (const tipY of [0.15, -0.25, 0.4]) {
      sim.restore(snap);
      sim.strike(c.yaw, c.speed, 0, tipY);
      sim.settle(25);
      const log = sim.log;
      const potted = log.pocketed.includes(c.num);
      const scratch = log.cueScratch;
      const legalFirst = log.firstContact !== null
        && (match.open || legalNow.includes(log.firstContact));
      let score = 0;
      if (potted) score += 10;
      if (scratch) score -= 14;
      if (!legalFirst) score -= 8;
      if (!log.railAfterContact && log.pocketed.length === 0) score -= 6;
      score -= c.difficulty * 0.2;
      // leaving the cue ball near the middle of the table is a decent proxy
      // for good position
      if (sim.cue.live) score += 1 - Math.hypot(sim.cue.x / TABLE.halfLen, sim.cue.z / TABLE.halfWid);
      if (!best || score > best.score) best = { ...c, tipY, score };
    }
  }
  sim.restore(snap);

  if (!best) {
    /* nothing on: play a safety at the nearest legal ball */
    const obj = targets.map((n) => sim.byNum(n)).filter(Boolean)
      .sort((a, b) => Math.hypot(a.x - cue.x, a.z - cue.z) - Math.hypot(b.x - cue.x, b.z - cue.z))[0];
    if (!obj) return null;
    return {
      yaw: Math.atan2(obj.z - cue.z, obj.x - cue.x) + (rng() - 0.5) * cfg.err * 2,
      speed: 1.4 + rng() * 0.8, tipX: 0, tipY: 0.1, safety: true, target: obj.num,
    };
  }

  // human error, scaled by the level
  const jitter = cfg.err * (0.5 + best.cut) * (rng() - 0.5) * 2;
  return {
    yaw: best.yaw + jitter,
    speed: Math.max(0.9, best.speed * (1 + (rng() - 0.5) * cfg.speedErr)),
    tipX: (rng() - 0.5) * 0.1,
    tipY: best.tipY,
    target: best.num,
    pocket: best.pocket,
    safety: false,
  };
}

/** Where the AI puts the cue ball when it has ball in hand. */
export function aiPlacement(sim, match, rng = Math.random) {
  const bounds = match.placementBounds();
  const targets = match.legalTargets(sim);
  let best = null;
  for (let i = 0; i < 160; i++) {
    const x = bounds.minX + rng() * (bounds.maxX - bounds.minX);
    const z = bounds.minZ + rng() * (bounds.maxZ - bounds.minZ);
    if (!sim.freeAt(x, z, BALL_R, sim.cue)) continue;
    let score = 0;
    for (const n of targets) {
      const obj = sim.byNum(n);
      if (!obj) continue;
      for (const p of sim.geo.pockets) {
        const g = ghostBall(obj, p.x, p.z);
        const aimA = Math.atan2(g.z - z, g.x - x);
        const potA = Math.atan2(p.z - obj.z, p.x - obj.x);
        let cut = Math.abs(aimA - potA);
        while (cut > Math.PI) cut = Math.abs(cut - Math.PI * 2);
        if (cut > 1.0) continue;
        if (!pathClear(sim, x, z, g.x, g.z, [sim.cue, obj])) continue;
        if (!pathClear(sim, obj.x, obj.z, p.x, p.z, [obj])) continue;
        score += 1 / (1 + cut * 2 + Math.hypot(g.x - x, g.z - z));
      }
    }
    if (!best || score > best.score) best = { x, z, score };
  }
  return best ?? { x: -TABLE.halfLen * 0.5, z: 0 };
}

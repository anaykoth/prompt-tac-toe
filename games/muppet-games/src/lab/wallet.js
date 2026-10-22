/**
 * Points, purchases and the daily state, persisted to localStorage.
 *
 * Everything that pays out — the jar guess, blackjack, winning a rack — goes
 * through here, and everything that costs money asks here first. Kept free of
 * three.js and the DOM so the rules stay testable and so a server can one day
 * own the same shape.
 */

const KEY = 'fuzz-and-feather:v1';

/** Local calendar day, which is what "one guess a day" has to mean. */
export function today(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Stable 32-bit hash — turns a date string into the day's jar. */
export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const BLANK = {
  points: 250,
  lifetime: 250,
  owned: ['cue-house'],
  equipped: { cue: 'cue-house', felt: 'felt-green', drink: null },
  jar: {},            // date -> { guess, actual, points, revealed }
  stats: { racksWon: 0, racksLost: 0, handsWon: 0, handsLost: 0, bestJar: null },
  drinksToday: 0,
  lastSeen: null,
};

export class Wallet {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.data = this._load();
    this.listeners = new Set();
    const day = today();
    if (this.data.lastSeen !== day) {
      this.data.lastSeen = day;
      this.data.drinksToday = 0;
      this.save();
    }
  }

  _load() {
    try {
      const raw = this.storage?.getItem(KEY);
      if (!raw) return structuredClone(BLANK);
      const parsed = JSON.parse(raw);
      // merge so a new field in BLANK does not wipe an existing save
      return { ...structuredClone(BLANK), ...parsed,
        equipped: { ...BLANK.equipped, ...(parsed.equipped || {}) },
        stats: { ...BLANK.stats, ...(parsed.stats || {}) } };
    } catch {
      return structuredClone(BLANK);
    }
  }

  save() {
    try { this.storage?.setItem(KEY, JSON.stringify(this.data)); } catch { /* private mode */ }
    for (const fn of this.listeners) fn(this.data);
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  get points() { return this.data.points; }

  /** @returns {boolean} whether it went through */
  spend(n, why = '') {
    if (n > this.data.points) return false;
    this.data.points -= n;
    this.last = { delta: -n, why };
    this.save();
    return true;
  }

  earn(n, why = '') {
    this.data.points += n;
    this.data.lifetime += n;
    this.last = { delta: n, why };
    this.save();
    return n;
  }

  /* ---------------- shop ---------------- */

  owns(id) { return this.data.owned.includes(id); }

  buy(item) {
    if (this.owns(item.id)) return { ok: false, why: 'ALREADY YOURS' };
    if (item.cost > this.data.points) return { ok: false, why: 'NOT ENOUGH POINTS' };
    this.data.points -= item.cost;
    if (!item.consumable) this.data.owned.push(item.id);
    if (item.slot && !item.consumable) this.data.equipped[item.slot] = item.id;
    this.save();
    return { ok: true };
  }

  equip(slot, id) {
    if (!this.owns(id)) return false;
    this.data.equipped[slot] = id;
    this.save();
    return true;
  }

  /* ---------------- the jar ---------------- */

  jarFor(date = today()) { return this.data.jar[date] ?? null; }

  /**
   * Score a guess. Closest wins, and closer pays more — a linear fall-off from
   * the true count, so being one out is worth a great deal more than being ten.
   */
  submitJarGuess(guess, actual, date = today()) {
    if (this.data.jar[date]) return { ok: false, why: 'ALREADY GUESSED TODAY' };
    const err = Math.abs(guess - actual);
    const rel = err / Math.max(1, actual);
    let points = 0;
    let verdict;
    if (err === 0) { points = 500; verdict = 'EXACT. THE ROOM IS SHAKING.'; }
    else if (err <= 2) { points = 260; verdict = 'ALL BUT EXACT'; }
    else if (rel <= 0.05) { points = 150; verdict = 'VERY CLOSE'; }
    else if (rel <= 0.12) { points = 80; verdict = 'CLOSE ENOUGH TO BOAST'; }
    else if (rel <= 0.25) { points = 30; verdict = 'IN THE RIGHT POSTCODE'; }
    else { points = 5; verdict = 'NOWHERE NEAR'; }

    this.data.jar[date] = { guess, actual, points, err };
    this.earn(points, 'jar');
    const best = this.data.stats.bestJar;
    if (best === null || err < best) this.data.stats.bestJar = err;
    this.save();
    return { ok: true, points, err, verdict, actual };
  }

  /* ---------------- tallies ---------------- */

  record(stat, n = 1) {
    this.data.stats[stat] = (this.data.stats[stat] ?? 0) + n;
    this.save();
  }

  drink() {
    this.data.drinksToday++;
    this.save();
    return this.data.drinksToday;
  }
}

/* ------------------------------------------------------------------ */
/* Shop stock                                                          */
/* ------------------------------------------------------------------ */

export const STOCK = [
  {
    id: 'cue-house', name: 'HOUSE CUE', slot: 'cue', cost: 0,
    blurb: 'Bent. Chalk of unknown origin. It is free.',
    effect: { accuracy: 0, power: 1 },
  },
  {
    id: 'cue-straight', name: 'A CUE THAT IS STRAIGHT', slot: 'cue', cost: 400,
    blurb: 'Genuinely straight. Forgives a crooked push.',
    effect: { accuracy: 0.35, power: 1.05 },
  },
  {
    id: 'cue-jump', name: 'JUMP CUE', slot: 'cue', cost: 900,
    blurb: 'Short, nasty, and everyone will hate you for it.',
    effect: { accuracy: 0.2, power: 1.2, elevation: 1.5 },
  },
  {
    id: 'cue-gold', name: 'THE LANDLORD’S CUE', slot: 'cue', cost: 2500,
    blurb: 'Kept behind the bar. Nobody knows why it is gold.',
    effect: { accuracy: 0.6, power: 1.1 },
  },
  {
    id: 'felt-green', name: 'STANDARD GREEN FELT', slot: 'felt', cost: 0,
    blurb: 'The cloth you have. Slow, and it has seen things.',
    effect: { muRoll: 0.014 },
  },
  {
    id: 'felt-blue', name: 'TOURNAMENT BLUE', slot: 'felt', cost: 700,
    blurb: 'Fast, clean, and wildly out of place in here.',
    effect: { muRoll: 0.008, colour: '#1d4f86' },
  },
  {
    id: 'felt-red', name: 'BLOOD RED', slot: 'felt', cost: 700,
    blurb: 'Hides the stains. All of them.',
    effect: { muRoll: 0.012, colour: '#7a1f22' },
  },
  {
    id: 'felt-purple', name: 'UNLICENSED PURPLE', slot: 'felt', cost: 1200,
    blurb: 'Bought from a man in the car park.',
    effect: { muRoll: 0.006, colour: '#4a2472' },
  },
  {
    id: 'drink-pint', name: 'A PINT', cost: 40, consumable: true,
    blurb: 'Steadies the hand. Then it does the opposite.',
    effect: { drink: 1 },
  },
  {
    id: 'drink-double', name: 'SOMETHING SHORT', cost: 90, consumable: true,
    blurb: 'The crowd approves. Your aim does not.',
    effect: { drink: 2 },
  },
  {
    id: 'drink-round', name: 'A ROUND FOR THE ROOM', cost: 350, consumable: true,
    blurb: 'They will be louder, drunker and entirely on your side.',
    effect: { crowd: 1 },
  },
];

export const byId = (id) => STOCK.find((s) => s.id === id);

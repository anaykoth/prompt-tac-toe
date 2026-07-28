/**
 * The bar tab.
 *
 * Points are earned by scoring and are deliberately *separate* from the 501
 * remaining — a multiplier applied to the leg score would make double-out
 * checkouts unplannable, which would wreck the game it's bolted onto. So the
 * gamble is: spend points on a drink, throw worse, earn points faster.
 */

export const DRINKS = [
  { id: 'half', name: 'HALF', cost: 45, kick: 0.16, blurb: 'easing in' },
  { id: 'pint', name: 'PINT', cost: 90, kick: 0.30, blurb: 'the standard' },
  { id: 'shot', name: 'SHOT', cost: 150, kick: 0.46, blurb: 'ill-advised' },
  { id: 'puppet', name: 'THE PUPPET', cost: 280, kick: 0.78, blurb: 'nobody survives this' },
];

/** Drunkenness lost per second — a pint is worth roughly three visits. */
const SOBER_RATE = 0.0075;

/** The house buys the first round, so the mechanic is live from dart one. */
const OPENING_FLOAT = 60;

export class Bar {
  constructor() {
    this.enabled = true;
    this.reset();
  }

  reset() {
    this.points = OPENING_FLOAT;
    this.drunk = 0;
    this.rounds = 0;
    this.earned = 0;
    this.spent = 0;
  }

  /** Points multiplier — the whole reason to get on it. */
  get multiplier() { return 1 + this.drunk * 2; }

  /** 0 = steady, 1 = cannot see the wall. */
  get sway() { return this.drunk; }

  get state() {
    const d = this.drunk;
    if (d < 0.05) return 'SOBER';
    if (d < 0.22) return 'LOOSE';
    if (d < 0.45) return 'MERRY';
    if (d < 0.70) return 'WOBBLY';
    if (d < 0.90) return 'GONE';
    return 'HORIZONTAL';
  }

  canAfford(drink) { return this.enabled && this.points >= drink.cost; }

  /** @returns {boolean} whether the round was actually bought */
  buy(drink) {
    if (!this.canAfford(drink)) return false;
    this.points -= drink.cost;
    this.spent += drink.cost;
    this.drunk = Math.min(1, this.drunk + drink.kick);
    this.rounds++;
    return true;
  }

  /** Bank a dart. Returns the points credited so the HUD can show the bonus. */
  scoreDart(value) {
    if (!this.enabled || value <= 0) return 0;
    const p = Math.round(value * this.multiplier);
    this.points += p;
    this.earned += p;
    return p;
  }

  update(dt) {
    if (this.drunk > 0) this.drunk = Math.max(0, this.drunk - SOBER_RATE * dt);
  }
}

/**
 * THE ARMOURER — masks bought with bar points.
 *
 * The same points pay for drinks and for masks, so the whole economy is one
 * decision: another pint now, or the plague mask forever. Ownership persists in
 * localStorage; the bar balance deliberately does not (it resets each night).
 */

import { MASKS } from '../world/masks.js';

const KEY = 'tilt-alley.store';
const FREE = 'none';

export class Store {
  /** @param {object} bar  the Bar model — the wallet */
  constructor(bar) {
    this.bar = bar;
    this.owned = new Set([FREE]);
    this.worn = FREE;
    this.load();
  }

  get masks() { return MASKS; }

  cost(key) { return MASKS[key]?.cost ?? 0; }

  has(key) { return this.owned.has(key) || this.cost(key) === 0; }

  canBuy(key) {
    if (!MASKS[key] || this.has(key)) return false;
    return (this.bar?.points ?? 0) >= this.cost(key);
  }

  /** @returns {boolean} whether the mask was actually bought */
  buy(key) {
    if (!this.canBuy(key)) return false;
    this.bar.points -= this.cost(key);
    this.bar.spent = (this.bar.spent ?? 0) + this.cost(key);
    this.owned.add(key);
    this.save();
    return true;
  }

  /** @returns {boolean} whether the mask is now worn */
  wear(key) {
    if (!MASKS[key] || !this.has(key)) return false;
    this.worn = key;
    this.save();
    return true;
  }

  toJSON() {
    return { owned: [...this.owned], worn: this.worn };
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.toJSON())); } catch { /* private mode */ }
  }

  load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch { return; }
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      if (Array.isArray(d?.owned)) for (const k of d.owned) if (MASKS[k]) this.owned.add(k);
      if (d?.worn && MASKS[d.worn] && this.has(d.worn)) this.worn = d.worn;
    } catch { /* corrupt, start clean */ }
  }
}

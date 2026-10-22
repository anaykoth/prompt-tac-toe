/**
 * The blackjack table in the corner.
 *
 * Standard bar rules: six decks, dealer stands on all 17, blackjack pays 3:2,
 * double and split allowed. Pure logic and no rendering, so the hand can be
 * tested without a table in front of it.
 */

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

export const DECKS = 6;

export function buildShoe(rng) {
  const cards = [];
  for (let d = 0; d < DECKS; d++) {
    for (const s of SUITS) for (const r of RANKS) cards.push({ r, s });
  }
  // Fisher-Yates off the supplied rng, so a shoe can be replayed
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    if (c.r === 'A') { aces++; total += 11; }
    else if (c.r === 'K' || c.r === 'Q' || c.r === 'J' || c.r === '10') total += 10;
    else total += +c.r;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}

export const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;

export class Blackjack {
  constructor(opts = {}) {
    this.rng = opts.rng ?? Math.random;
    this.wallet = opts.wallet;
    this.onChange = opts.onChange ?? (() => {});
    this.min = 25;
    this.max = 1000;
    this.shoe = buildShoe(this.rng);
    this.discarded = 0;
    this.reset();
  }

  reset() {
    this.state = 'betting';     // betting · playing · dealer · settled
    this.bet = 0;
    this.hands = [];            // [{ cards, bet, done, outcome, payout }]
    this.active = 0;
    this.dealer = [];
    this.message = 'PLACE A BET';
    this.onChange(this);
  }

  _draw() {
    // the shoe is reshuffled at the cut card, like anywhere with a licence
    if (this.shoe.length < 60) { this.shoe = buildShoe(this.rng); this.discarded = 0; }
    return this.shoe.pop();
  }

  get hand() { return this.hands[this.active]; }

  /** @returns {{ok:boolean, why?:string}} */
  deal(bet) {
    if (this.state !== 'betting') return { ok: false, why: 'HAND IN PROGRESS' };
    const stake = Math.max(this.min, Math.min(this.max, Math.round(bet)));
    if (!this.wallet.spend(stake, 'blackjack')) return { ok: false, why: 'NOT ENOUGH POINTS' };

    this.bet = stake;
    this.hands = [{ cards: [this._draw(), this._draw()], bet: stake, done: false, outcome: null, payout: 0 }];
    this.dealer = [this._draw(), this._draw()];
    this.active = 0;
    this.state = 'playing';

    if (isBlackjack(this.hands[0].cards)) {
      if (isBlackjack(this.dealer)) this._finish(this.hands[0], 'PUSH — BOTH BLACKJACK', 1);
      else this._finish(this.hands[0], 'BLACKJACK', 2.5);
      this.state = 'settled';
      this.message = this.hands[0].outcome;
    } else if (isBlackjack(this.dealer)) {
      this._finish(this.hands[0], 'DEALER BLACKJACK', 0);
      this.state = 'settled';
      this.message = this.hands[0].outcome;
    } else {
      this.message = 'HIT, STAND, DOUBLE OR SPLIT';
    }
    this.onChange(this);
    return { ok: true };
  }

  hit() {
    if (this.state !== 'playing') return;
    const h = this.hand;
    h.cards.push(this._draw());
    const v = handValue(h.cards);
    if (v.total > 21) {
      this._finish(h, 'BUST', 0);
      this._nextHand();
    } else if (v.total === 21) {
      this.stand();
    }
    this.onChange(this);
  }

  stand() {
    if (this.state !== 'playing') return;
    this.hand.done = true;
    this._nextHand();
    this.onChange(this);
  }

  double() {
    if (this.state !== 'playing') return { ok: false, why: 'NOT NOW' };
    const h = this.hand;
    if (h.cards.length !== 2) return { ok: false, why: 'ONLY ON THE FIRST TWO' };
    if (!this.wallet.spend(h.bet, 'blackjack double')) return { ok: false, why: 'NOT ENOUGH POINTS' };
    h.bet *= 2;
    h.cards.push(this._draw());
    if (handValue(h.cards).total > 21) this._finish(h, 'BUST', 0);
    else h.done = true;
    this._nextHand();
    this.onChange(this);
    return { ok: true };
  }

  canSplit() {
    if (this.state !== 'playing' || this.hands.length > 1) return false;
    const c = this.hand.cards;
    if (c.length !== 2) return false;
    const val = (x) => (['10', 'J', 'Q', 'K'].includes(x.r) ? '10' : x.r);
    return val(c[0]) === val(c[1]);
  }

  split() {
    if (!this.canSplit()) return { ok: false, why: 'NOT A PAIR' };
    const h = this.hand;
    if (!this.wallet.spend(h.bet, 'blackjack split')) return { ok: false, why: 'NOT ENOUGH POINTS' };
    const moved = h.cards.pop();
    h.cards.push(this._draw());
    this.hands.push({ cards: [moved, this._draw()], bet: h.bet, done: false, outcome: null, payout: 0 });
    this.onChange(this);
    return { ok: true };
  }

  _nextHand() {
    const next = this.hands.findIndex((h) => !h.done && h.outcome === null);
    if (next >= 0) { this.active = next; return; }
    this._playDealer();
  }

  _playDealer() {
    this.state = 'dealer';
    // if every hand busted the dealer does not need to do anything
    if (this.hands.every((h) => h.outcome !== null)) {
      this.state = 'settled';
      this.message = 'DEALER TAKES IT';
      return;
    }
    while (handValue(this.dealer).total < 17) this.dealer.push(this._draw());
    const d = handValue(this.dealer).total;

    for (const h of this.hands) {
      if (h.outcome !== null) continue;
      const p = handValue(h.cards).total;
      if (d > 21) this._finish(h, `DEALER BUSTS ON ${d}`, 2);
      else if (p > d) this._finish(h, `${p} BEATS ${d}`, 2);
      else if (p === d) this._finish(h, `PUSH ON ${p}`, 1);
      else this._finish(h, `${d} BEATS ${p}`, 0);
    }
    this.state = 'settled';
    this.message = this.hands.map((h) => h.outcome).join(' · ');
  }

  /** payout is a multiple of the stake, already including the stake back. */
  _finish(h, outcome, payout) {
    h.outcome = outcome;
    h.done = true;
    h.payout = Math.round(h.bet * payout);
    if (h.payout > 0) this.wallet.earn(h.payout, 'blackjack');
    if (payout > 1) this.wallet.record('handsWon');
    else if (payout < 1) this.wallet.record('handsLost');
  }

  /** What the player walked away with this hand, net of the stake. */
  get net() {
    return this.hands.reduce((s, h) => s + h.payout - h.bet, 0);
  }
}

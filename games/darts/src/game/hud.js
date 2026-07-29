const $ = (s) => document.querySelector(s);

const ONES = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
  'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

export function sayNumber(n) {
  if (n === 0) return 'NO SCORE';
  if (n === 180) return 'ONE HUNDRED AND EIGHTY';
  let out = '';
  const h = Math.floor(n / 100), r = n % 100;
  if (h) out += `${ONES[h]} HUNDRED`;
  if (r) {
    if (h) out += ' AND ';
    out += r < 20 ? ONES[r] : (TENS[Math.floor(r / 10)] + (r % 10 ? '-' + ONES[r % 10] : ''));
  }
  return out;
}

const CROWD_GOOD = [
  'THE FELT IS ALIVE', 'ABSOLUTE SCENES', 'THEY ARE LOSING IT', 'SOMEONE FETCH A MEDIC',
  'THE PUPPETS HAVE RISEN', 'UNHINGED', 'A MAN HAS EATEN HIS SIGN', 'STUFFING EVERYWHERE',
];
const CROWD_BAD = [
  'AWKWARD', 'A COUGH FROM ROW FOUR', 'THEY SAW THAT', 'THE FUZZ GOES QUIET',
  'ONE PUPPET LEAVES', 'GRIM', 'SOMEBODY BOOED. LOUDLY.',
];
const CROWD_MISS = ['OFF THE WIRE', 'IN THE PLASTER', 'SPAT OUT', 'NO SCORE', 'THAT IS GONE'];

export const pick = (a) => a[(Math.random() * a.length) | 0];

export class Hud {
  constructor() {
    this.els = {
      p: [$('#p0'), $('#p1')],
      round: $('.round-num'),
      pips: [...document.querySelectorAll('.dart-pip')],
      visitScores: $('.visit-scores'),
      visitTotal: $('.visit-total'),
      toast: $('#toast'),
      callout: $('#callout'),
      power: $('#power'),
      powerFill: $('#power-fill'),
      powerLabel: $('#power-label'),
      reticle: $('#reticle'),
      intro: $('#intro'),
      loading: $('#loading'),
      styles: $('#styles'),
      bar: $('#bar'),
      barPoints: $('.bar-points b'),
      barState: $('.bar-state'),
      barMult: $('.bar-mult'),
      drunkFill: $('.drunk-fill'),
      drinks: $('#drinks'),
      walk: $('#walk'),
      pts: $('#pts'),
      nameplate: $('#nameplate'),
      presence: $('#presence'),
    };
    this._toastT = 0;
    this._shownPoints = -1;
  }

  /* ---------------- the bar ---------------- */

  buildDrinks(drinks, onBuy) {
    this.els.drinks.innerHTML = '';
    this.drinkBtns = drinks.map((d, i) => {
      const b = document.createElement('button');
      b.className = 'drink';
      b.innerHTML = `<span class="d-name">${d.name}</span>`
        + `<span class="d-blurb">${d.blurb}</span>`
        + `<span class="d-cost">${d.cost}</span>`;
      b.onclick = () => onBuy(i);
      this.els.drinks.appendChild(b);
      return b;
    });
    this.drinks = drinks;
  }

  /**
   * @param {object}  bar      the Bar model
   * @param {boolean} open     drink list expanded
   * @param {boolean} enabled  drunk mode switched on at all
   * @param {boolean} canBuy   only between throws
   */
  bar(bar, open, enabled, canBuy) {
    const el = this.els.bar;
    el.classList.toggle('off', !enabled);
    el.classList.toggle('shut', !open);
    el.classList.toggle('tipsy', bar.drunk > 0.05);
    if (!enabled) return;

    const pts = Math.round(bar.points);
    if (pts !== this._shownPoints) {
      this.els.barPoints.textContent = pts;
      this._shownPoints = pts;
    }
    this.els.barState.textContent = bar.state;
    this.els.barMult.textContent = `\u00d7${bar.multiplier.toFixed(1)}`;
    this.els.drunkFill.style.width = `${Math.round(bar.drunk * 100)}%`;
    this.drinkBtns?.forEach((b, i) => {
      b.disabled = !canBuy || !bar.canAfford(this.drinks[i]);
    });
  }

  /** Floating "+60" when a dart banks points. */
  points(gained, mult) {
    if (gained <= 0) return;
    const el = this.els.pts;
    el.textContent = mult > 1.02 ? `+${gained}  \u00d7${mult.toFixed(1)}` : `+${gained}`;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  /* ---------------- walking ---------------- */

  walk(on, legal) {
    this.els.walk.classList.toggle('on', on);
    this.els.walk.classList.toggle('foul', on && !legal);
  }

  /** Lower-third card naming whoever is at the oche. */
  nameplate(name, sub = '') {
    const el = this.els.nameplate;
    if (!name) { el.classList.remove('on'); return; }
    el.querySelector('.np-name').textContent = name;
    el.querySelector('.np-sub').textContent = sub;
    el.classList.add('on');
  }

  /** Standing over the line with darts in hand. */
  foul(on) {
    this.els.walk.classList.toggle('on', on);
    this.els.walk.classList.toggle('foul', on);
  }

  buildStyleButtons(keys, labels, onPick) {
    this.els.styles.innerHTML = '';
    this.styleBtns = keys.map((k, i) => {
      const b = document.createElement('button');
      b.className = 'style-btn';
      b.textContent = `${i + 1} ${labels[k]}`;
      b.onclick = () => onPick(k);
      this.els.styles.appendChild(b);
      return b;
    });
    this.styleKeys = keys;
  }

  markStyle(key) {
    if (!this.styleBtns) return;
    this.styleBtns.forEach((b, i) => b.classList.toggle('on', this.styleKeys[i] === key));
  }

  /**
   * @param {object} opts  `swap` when the local player holds seat 1, so the
   *   scoreboard still reads left-to-right as seat 0, seat 1 for both players.
   */
  setNames(a, b, { swap = false } = {}) {
    const [left, right] = swap ? [b, a] : [a, b];
    this.els.p[0].querySelector('.p-name').textContent = left;
    this.els.p[1].querySelector('.p-name').textContent = right;
  }

  /** Is the other seat actually here, and how far gone are they. */
  presence(online, name, state) {
    const el = this.els.presence;
    if (!name) { el.classList.remove('on'); return; }
    el.classList.add('on');
    el.classList.toggle('here', !!online);
    el.querySelector('.pr-name').textContent = name;
    el.querySelector('.pr-state').textContent = online ? state : 'away';
  }

  sync(match) {
    for (let i = 0; i < 2; i++) {
      const el = this.els.p[i];
      el.classList.toggle('active', match.current === i && !match.finished);
      el.querySelector('.p-score').textContent = match.score[i];
      const avg = match.average(i);
      el.querySelector('.p-avg').textContent = avg ? `avg ${avg.toFixed(1)}` : 'avg —';
      const co = match.suggestion(i);
      el.querySelector('.p-out').textContent = co ? co.join(' · ') : '';
    }
    this.els.round.textContent = match.round;
    const used = 3 - match.dartsLeft;
    this.els.pips.forEach((p, i) => p.classList.toggle('spent', i < used));
    this.els.visitScores.textContent = match.visit.join('  ');
    const t = match.visitStart[match.current] - match.score[match.current];
    this.els.visitTotal.textContent = match.visit.length ? t : '';
  }

  toast(big, small, color) {
    const el = this.els.toast;
    el.textContent = big;
    el.style.color = color || 'var(--ink)';
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
    if (small) {
      const c = this.els.callout;
      c.textContent = small;
      c.classList.remove('pop');
      void c.offsetWidth;
      c.classList.add('pop');
    }
  }

  power(v, mode) {
    const el = this.els.power;
    if (mode === 'off') { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    this.els.powerFill.style.width = `${Math.round(v * 100)}%`;
    this.els.powerLabel.textContent =
      mode === 'wind' ? 'WIND UP — PULL DOWN' :
        mode === 'flick' ? 'RELEASE' : 'CLICK TO THROW';
  }

  reticle(x, y, cls) {
    const el = this.els.reticle;
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.className = cls || '';
  }

  showReticle(on) { this.els.reticle.classList.toggle('hidden', !on); }

  hideIntro() { this.els.intro.classList.add('gone'); }
  hideLoading() { this.els.loading.classList.add('gone'); }

  showWin(name, avg, onAgain, bar = null) {
    const card = this.els.intro.querySelector('.intro-card');
    const who = name.split(' ')[0];
    const verb = name === 'YOU' ? 'WIN' : 'WINS';
    const tab = bar
      ? ` · ${Math.round(bar.earned)} pts on the night, ${bar.rounds} round${bar.rounds === 1 ? '' : 's'} sunk`
      : '';
    card.innerHTML = `
      <h1>${who}<span>${verb}</span></h1>
      <p class="tag">3-dart average ${avg ? avg.toFixed(2) : '—'}${tab}</p>
      <button id="btn-start">GO AGAIN</button>
      <p class="hint">Every puppet in this building saw what you did.</p>`;
    this.els.intro.classList.remove('gone');
    this.els.intro.classList.add('win');
    card.querySelector('#btn-start').onclick = onAgain;
  }
}

/* ------------------------------------------------------------------ */
/* Reaction table                                                      */
/* ------------------------------------------------------------------ */

/** Crowd intensity + commentary for a single dart. */
export function dartReaction(res, ev) {
  if (!res || ev.type === 'bounceout' || ev.type === 'clatter' || ev.type === 'floor' || ev.type === 'lost') {
    return { hype: -0.55, big: 'NO', small: pick(CROWD_MISS), color: 'var(--dim)' };
  }
  if (ev.surface === 'wall') return { hype: -0.75, big: 'OOF', small: 'INTO THE PLASTER', color: 'var(--dim)' };
  if (ev.surface === 'surround') return { hype: -0.6, big: 'MISS', small: 'IN THE WOOD', color: 'var(--dim)' };
  if (res.value === 0) return { hype: -0.5, big: '0', small: pick(CROWD_BAD), color: 'var(--dim)' };

  if (res.ring === 'bull') return { hype: 1.05, big: 'BULL', small: 'RIGHT IN THE MIDDLE', color: 'var(--gold)' };
  if (res.label === 'T20') return { hype: 1.0, big: 'T20', small: pick(CROWD_GOOD), color: 'var(--gold)' };
  if (res.mult === 3) return { hype: 0.78, big: res.label, small: 'TREBLE', color: 'var(--gold)' };
  if (res.mult === 2) return { hype: 0.55, big: res.label, small: 'DOUBLE', color: 'var(--green)' };
  if (res.ring === 'outerBull') return { hype: 0.42, big: '25', small: 'OUTER', color: 'var(--green)' };
  if (res.value >= 17) return { hype: 0.26, big: res.label, small: '', color: 'var(--ink)' };
  return { hype: 0.08, big: res.label, small: '', color: 'var(--ink)' };
}

/** Crowd intensity + commentary for a completed visit. */
export function visitReaction(total, bust) {
  if (bust) return { hype: -0.85, big: 'BUST', small: 'THE PUPPETS ARE APPALLED', color: 'var(--hot)' };
  if (total === 180) return { hype: 1.7, big: '180', small: 'ONE HUNDRED AND EIGHTY', color: 'var(--gold)' };
  if (total >= 140) return { hype: 1.25, big: String(total), small: sayNumber(total), color: 'var(--gold)' };
  if (total >= 100) return { hype: 0.9, big: String(total), small: sayNumber(total), color: 'var(--gold)' };
  if (total >= 60) return { hype: 0.45, big: String(total), small: sayNumber(total), color: 'var(--ink)' };
  if (total <= 9) return { hype: -0.6, big: String(total), small: pick(CROWD_BAD), color: 'var(--dim)' };
  return { hype: 0.12, big: String(total), small: sayNumber(total), color: 'var(--ink)' };
}

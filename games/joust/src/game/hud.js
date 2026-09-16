/**
 * TILT ALLEY — the HUD.
 *
 * A port of the darts HUD: same panels, same toast machinery, same bar. The
 * darts power meter becomes the COUCH meter, and two jousting-only widgets are
 * added — the balance dot and the armourer's mask store.
 */

const $ = (s) => document.querySelector(s);

const CROWD_GOOD = [
  'THE LISTS ARE ALIVE', 'ABSOLUTE SCENES', 'THEY ARE LOSING IT', 'SOMEONE FETCH A SURGEON',
  'STUFFING EVERYWHERE', 'UNHINGED', 'A HERALD HAS FAINTED', 'THE BOX IS ON ITS FEET',
];
const CROWD_BAD = [
  'AWKWARD', 'A COUGH FROM THE ROYAL BOX', 'THEY SAW THAT', 'THE FUZZ GOES QUIET',
  'ONE PUPPET LEAVES', 'GRIM', 'SOMEBODY BOOED. LOUDLY.',
];
const CROWD_MISS = ['THIN AIR', 'NOT CLOSE', 'WIDE OF EVERYTHING', 'NO CONTACT', 'A CLEAN MISS'];

export const pick = (a) => a[(Math.random() * a.length) | 0];

export class Hud {
  constructor() {
    this.els = {
      p: [$('#p0'), $('#p1')],
      passNum: $('.pass-num'),
      toast: $('#toast'),
      callout: $('#callout'),
      couch: $('#couch'),
      couchFill: $('#couch-fill'),
      couchLabel: $('#couch-label'),
      balance: $('#balance'),
      balDot: $('#balance .bal-dot'),
      balFall: $('#balance .bal-fall'),
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
      store: $('#store'),
      storeList: $('#store-list'),
      storePoints: $('.store-points b'),
      pts: $('#pts'),
      nameplate: $('#nameplate'),
      presence: $('#presence'),
    };
    this._shownPoints = -1;
    this._shownStorePoints = -1;
    this._lastCouch = -1;
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
    this.els.barMult.textContent = `×${bar.multiplier.toFixed(1)}`;
    this.els.drunkFill.style.width = `${Math.round(bar.drunk * 100)}%`;
    this.drinkBtns?.forEach((b, i) => {
      b.disabled = !canBuy || !bar.canAfford(this.drinks[i]);
    });
  }

  /* ---------------- the armourer ---------------- */

  /**
   * @param {object}   masks  MASKS table, { key: {label, cost} }
   * @param {Set}      owned
   * @param {string}   worn
   */
  buildStore(masks, owned, worn, onBuy, onWear) {
    const list = this.els.storeList;
    list.innerHTML = '';
    this.storeRows = [];
    for (const [key, m] of Object.entries(masks)) {
      const row = document.createElement('div');
      row.className = 'mask-row';
      const name = document.createElement('span');
      name.className = 'mask-name';
      name.textContent = m.label ?? key.toUpperCase();
      const cost = document.createElement('span');
      cost.className = 'mask-cost';
      const btn = document.createElement('button');
      btn.className = 'mask-btn';
      btn.onclick = () => (owned.has(key) || (m.cost ?? 0) === 0 ? onWear(key) : onBuy(key));
      row.append(name, cost, btn);
      list.appendChild(row);
      this.storeRows.push({ key, m, row, cost, btn });
    }
    this.syncStore(owned, worn, 0);
  }

  syncStore(owned, worn, points) {
    const p = Math.round(points);
    if (p !== this._shownStorePoints) {
      this.els.storePoints.textContent = p;
      this._shownStorePoints = p;
    }
    for (const r of this.storeRows ?? []) {
      const have = owned.has(r.key) || (r.m.cost ?? 0) === 0;
      r.row.classList.toggle('worn', worn === r.key);
      r.cost.textContent = have ? '' : String(r.m.cost ?? 0);
      r.btn.textContent = worn === r.key ? 'WORN' : have ? 'WEAR' : 'BUY';
      r.btn.disabled = worn === r.key || (!have && points < (r.m.cost ?? 0));
    }
  }

  store(open) { this.els.store.classList.toggle('shut', !open); }

  /** Floating "+10" when an event banks points. */
  points(gained, mult = 1) {
    if (!gained || gained <= 0) return;
    const el = this.els.pts;
    el.textContent = mult > 1.02 ? `+${gained}  ×${mult.toFixed(1)}` : `+${gained}`;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  /* ---------------- jousting widgets ---------------- */

  /**
   * @param {number}  v        couch progress 0..1
   * @param {number}  fatigue  seconds held past full, 0 when fresh
   */
  couch(v, fatigue = 0) {
    const el = this.els.couch;
    if (v == null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
    if (pct !== this._lastCouch) {
      this.els.couchFill.style.width = `${pct}%`;
      this._lastCouch = pct;
    }
    const tired = fatigue > 0.05;
    el.classList.toggle('fatigue', tired);
    this.els.couchLabel.textContent = tired
      ? `ARM TIRING — ${fatigue.toFixed(1)}s`
      : v >= 0.999 ? 'COUCHED' : 'COUCH — HOLD LMB';
  }

  showCouch(on) { this.els.couch.classList.toggle('hidden', !on); }

  /** Torso pitch/roll against the fall angle. */
  balance(pitch, roll, fallAngle = 0.95) {
    const el = this.els.balance;
    el.classList.remove('hidden');
    const k = 30 / Math.max(0.01, fallAngle);      // fall ring sits at r = 30
    const x = 50 + Math.max(-40, Math.min(40, roll * k));
    const y = 46 + Math.max(-40, Math.min(40, -pitch * k));
    this.els.balDot.setAttribute('cx', x.toFixed(1));
    this.els.balDot.setAttribute('cy', y.toFixed(1));
    const mag = Math.hypot(pitch, roll) / Math.max(0.01, fallAngle);
    el.classList.toggle('danger', mag > 0.7);
  }

  showBalance(on) { this.els.balance.classList.toggle('hidden', !on); }

  /* ---------------- shared chrome ---------------- */

  nameplate(name, sub = '') {
    const el = this.els.nameplate;
    if (!name) { el.classList.remove('on'); return; }
    el.querySelector('.np-name').textContent = name;
    el.querySelector('.np-sub').textContent = sub;
    el.classList.add('on');
  }

  presence(online, name, state) {
    const el = this.els.presence;
    if (!name) { el.classList.remove('on'); return; }
    el.classList.add('on');
    el.classList.toggle('here', !!online);
    el.querySelector('.pr-name').textContent = name;
    el.querySelector('.pr-state').textContent = online ? state : 'away';
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

  setNames(a, b) {
    this.els.p[0].querySelector('.p-name').textContent = a;
    this.els.p[1].querySelector('.p-name').textContent = b;
  }

  /**
   * @param {object} match  Match from rules.js — score[2], pass, passes
   * @param {object} sim    the live PassSim, for the in-pass running score
   */
  sync(match, sim = null) {
    const running = sim?.score ?? null;
    for (let i = 0; i < 2; i++) {
      const el = this.els.p[i];
      el.classList.toggle('active', !match?.finished);
      const base = match?.score?.[i] ?? 0;
      el.querySelector('.p-score').textContent = base;
      const last = this._last?.[i];
      el.querySelector('.p-last').textContent =
        running && running[i] ? `this pass +${running[i]}`
          : last != null ? `last +${last}` : '—';
    }
    const n = Math.min(match?.pass ?? 1, match?.passes ?? 5);
    this.els.passNum.textContent = `${n} OF ${match?.passes ?? 5}`;
  }

  /** Remember what each seat took on the pass just finished. */
  setLast(a, b) { this._last = [a, b]; }

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

  reticle(x, y, cls) {
    const el = this.els.reticle;
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.className = cls || '';
  }

  showReticle(on) { this.els.reticle.classList.toggle('hidden', !on); }

  hideIntro() { this.els.intro.classList.add('gone'); }
  hideLoading() { this.els.loading.classList.add('gone'); }

  showWin(name, score, onAgain, bar = null) {
    const card = this.els.intro.querySelector('.intro-card');
    const who = name.split(' ')[0];
    const verb = name === 'YOU' ? 'WIN' : 'WINS';
    const tab = bar
      ? ` · ${Math.round(bar.earned)} pts on the day, ${bar.rounds} round${bar.rounds === 1 ? '' : 's'} sunk`
      : '';
    card.innerHTML = `
      <h1>${who}<span>${verb}</span></h1>
      <p class="tag">${score ? `${score[0]} — ${score[1]}` : ''}${tab}</p>
      <button id="btn-start">RIDE AGAIN</button>
      <p class="hint">Every puppet in these lists saw what you did.</p>`;
    this.els.intro.classList.remove('gone');
    this.els.intro.classList.add('win');
    card.querySelector('#btn-start').onclick = onAgain;
  }
}

/* ------------------------------------------------------------------ */
/* Reaction table                                                      */
/* ------------------------------------------------------------------ */

/**
 * Crowd intensity + commentary for one pass event.
 * @param {{type:string, seat:number, points:number}} ev
 * @returns {{hype:number, big:string, small:string, color:string}}
 */
export function eventReaction(ev) {
  switch (ev?.type) {
    case 'break':
      return { hype: 1.2, big: 'LANCE SHATTERED', small: pick(CROWD_GOOD), color: 'var(--gold)' };
    case 'unseat':
      return { hype: 1.7, big: 'UNHORSED', small: pick(CROWD_GOOD), color: 'var(--gold)' };
    case 'helm':
      return { hype: 1.0, big: 'ON THE HELM', small: pick(CROWD_GOOD), color: 'var(--gold)' };
    case 'hit':
      return { hype: 0.6, big: 'STRUCK', small: 'CLEAN ON THE SHIELD', color: 'var(--green)' };
    case 'glance':
      return { hype: 0.3, big: 'GLANCE', small: 'SKIDDED OFF', color: 'var(--ink)' };
    case 'foul':
      return { hype: -0.85, big: 'FOUL', small: pick(CROWD_BAD), color: 'var(--hot)' };
    case 'barrier':
      return { hype: -0.7, big: 'INTO THE TILT', small: pick(CROWD_BAD), color: 'var(--dim)' };
    case 'helmet-hit':
      return { hype: 1.1, big: 'BONK', small: 'HIS OWN HELMET, THROWN', color: 'var(--gold)' };
    case 'helmet-miss':
      return { hype: -0.3, big: 'WIDE', small: pick(CROWD_MISS), color: 'var(--dim)' };
    default:
      return { hype: 0, big: '', small: '', color: 'var(--ink)' };
  }
}

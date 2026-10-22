import { groupOf, SOLIDS } from './rules.js';

const $ = (s) => document.querySelector(s);
export const pick = (a) => a[(Math.random() * a.length) | 0];

const POT_GOOD = [
  'THE ROOM ERUPTS', 'ABSOLUTE SCENES', 'A PUPPET HAS FAINTED', 'FILTHY',
  'THEY ARE ON THE TABLES', 'SOMEONE SPILLED EVERYTHING', 'UNHINGED',
];
const MISS_BAD = [
  'GRIM', 'A COUGH FROM THE BAR', 'THE JUKEBOX SKIPS', 'SOMEBODY BOOED',
  'GERALD IS DISAPPOINTED', 'AWKWARD',
];

export class PoolHud {
  constructor() {
    this.els = {
      p: [$('#p0'), $('#p1')],
      turn: $('#turn-label'),
      toast: $('#toast'),
      callout: $('#callout'),
      power: $('#power'),
      powerFill: $('#power-fill'),
      powerLabel: $('#power-label'),
      spinDot: $('#spin-dot'),
      spinTilt: $('#spin-tilt'),
      spinReadout: $('#spin-readout'),
      intro: $('#intro'),
      loading: $('#loading'),
      styles: $('#styles'),
      hint: $('#hint'),
      chaos: $('#chaos'),
      drunkFill: $('#drunk-fill'),
      drunkLabel: $('#drunk-label'),
    };
  }

  buildStyleButtons(keys, labels, onPick) {
    this.els.styles.innerHTML = '';
    this.styleBtns = keys.map((k, i) => {
      const b = document.createElement('button');
      b.className = 'style-btn';
      b.textContent = `${i === 9 ? 0 : i + 1} ${labels[k]}`;
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

  /** Redraw the scoreboard from the match and the live table. */
  sync(match, sim) {
    for (let i = 0; i < 2; i++) {
      const el = this.els.p[i];
      el.classList.toggle('active', match.current === i && !match.finished);
      const g = match.group[i];
      el.querySelector('.p-group').textContent = g ? g.toUpperCase() : 'OPEN TABLE';
      el.classList.toggle('solids', g === SOLIDS);
      el.classList.toggle('stripes', g && g !== SOLIDS);

      // one pip per ball still to go
      const pips = el.querySelector('.p-balls');
      const left = g
        ? sim.live().filter((b) => !b.junk && b.num > 0 && b.num !== 8 && groupOf(b.num) === g)
        : [];
      const onEight = g && left.length === 0;
      pips.innerHTML = '';
      if (onEight) {
        const d = document.createElement('span');
        d.className = 'pip eight';
        d.textContent = '8';
        pips.appendChild(d);
      } else if (!g) {
        pips.textContent = '—';
      } else {
        for (const b of left.sort((a, c) => a.num - c.num)) {
          const d = document.createElement('span');
          d.className = `pip b${b.num}`;
          d.textContent = b.num;
          pips.appendChild(d);
        }
      }
      el.querySelector('.p-fouls').textContent = match.fouls[i] ? `${match.fouls[i]} foul${match.fouls[i] > 1 ? 's' : ''}` : '';
    }

    const name = match.names[match.current];
    this.els.turn.textContent = match.finished
      ? 'GAME OVER'
      : match.ballInHand ? `${name} — BALL IN HAND`
        : match.isBreak() ? `${name} TO BREAK` : `${name} TO SHOOT`;
    this.els.turn.classList.toggle('inhand', match.ballInHand && !match.finished);
  }

  /** The cue-ball face: where WASD has walked the tip. */
  spin(tipX, tipY, elevation) {
    const R = 34;
    this.els.spinDot.style.transform =
      `translate(${(tipX * R).toFixed(1)}px, ${(-tipY * R).toFixed(1)}px)`;
    const deg = Math.round(elevation * 180 / Math.PI);
    this.els.spinTilt.style.height = `${Math.min(100, deg * 1.7)}%`;
    const side = Math.abs(tipX) < 0.08 ? '' : tipX > 0 ? 'RIGHT' : 'LEFT';
    const vert = Math.abs(tipY) < 0.08 ? 'CENTRE' : tipY > 0 ? 'FOLLOW' : 'DRAW';
    const r = Math.hypot(tipX, tipY);
    this.els.spinReadout.textContent =
      (r > 0.55 ? 'MISCUE RISK · ' : '') + [vert, side].filter(Boolean).join(' · ')
      + (deg > 4 ? ` · ${deg}°` : '');
    this.els.spinReadout.classList.toggle('warn', r > 0.55);
  }

  power(v, mode) {
    const el = this.els.power;
    if (mode === 'off') { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    this.els.powerFill.style.width = `${Math.round(Math.min(1, v) * 100)}%`;
    this.els.powerLabel.textContent =
      mode === 'back' ? 'DRAW BACK…'
        : mode === 'push' ? 'PUSH THROUGH'
          : 'HOLD LEFT MOUSE · DRAW BACK · PUSH';
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

  /** Bottom-of-screen shout when the crowd does something. */
  chaos(text) {
    const el = this.els.chaos;
    el.textContent = text;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  drunk(v) {
    this.els.drunkFill.style.width = `${Math.round(v * 100)}%`;
    this.els.drunkLabel.textContent =
      v < 0.2 ? 'FIRST ROUND' : v < 0.45 ? 'MERRY' : v < 0.7 ? 'LOUD'
        : v < 0.9 ? 'BELLIGERENT' : 'BANNED FOR LIFE';
  }

  hint(text) { this.els.hint.textContent = text || ''; }

  hideIntro() { this.els.intro.classList.add('gone'); }
  hideLoading() { this.els.loading.classList.add('gone'); }

  showWin(name, line, onAgain) {
    const card = this.els.intro.querySelector('.intro-card');
    card.innerHTML = `
      <h1>${name.split(' ')[0]}<span>${name === 'YOU' ? 'WIN' : 'WINS'}</span></h1>
      <p class="tag">${line}</p>
      <button id="btn-start">RACK THEM AGAIN</button>
      <p class="hint">The landlord would like a word about the table.</p>`;
    this.els.intro.classList.remove('gone');
    this.els.intro.classList.add('win');
    card.querySelector('#btn-start').onclick = onAgain;
  }
}

/* ------------------------------------------------------------------ */
/* Reactions                                                           */
/* ------------------------------------------------------------------ */

/** How hard does the room take a finished shot? */
export function shotReaction(res, ctx) {
  if (res.win) return { hype: 1.8, big: 'GAME', small: 'THE EIGHT BALL, CALLED AND DELIVERED', color: 'var(--gold)' };
  if (res.lose) return { hype: 1.4, big: 'ON THE BLACK', small: res.messages[0] ?? 'DISASTER', color: 'var(--hot)' };
  if (res.foul) {
    return { hype: -0.6, big: res.foul, small: pick(MISS_BAD), color: 'var(--hot)' };
  }
  const n = res.potted.length;
  if (n >= 3) return { hype: 1.5, big: `${n} DOWN`, small: pick(POT_GOOD), color: 'var(--gold)' };
  if (n === 2) return { hype: 1.1, big: 'TWO AT ONCE', small: pick(POT_GOOD), color: 'var(--gold)' };
  if (n === 1) {
    if (ctx?.long) return { hype: 1.0, big: 'POT', small: 'FROM DOWNTOWN', color: 'var(--gold)' };
    return { hype: 0.7, big: 'POT', small: ctx?.run > 1 ? `${ctx.run} IN A ROW` : '', color: 'var(--green)' };
  }
  if (ctx?.safety) return { hype: 0.1, big: 'SAFE', small: 'THE COWARD\'S CHOICE', color: 'var(--dim)' };
  return { hype: -0.15, big: 'MISS', small: pick(MISS_BAD), color: 'var(--dim)' };
}

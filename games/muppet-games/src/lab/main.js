import * as THREE from 'three';

import { Game } from '../pool/main.js';
import { buildBarRoom, barSeats } from '../pool/barroom.js';
import { buildTikiBar, tikiSeats } from '../world/tikibar.js';
import { designs, getDesign, loadDesigns } from '../pool/tables/index.js';
import { mulberry32 } from '../pool/physics.js';

import { Wallet, STOCK, byId, today } from './wallet.js';
import { Walker, EYE_HEIGHT } from './walk.js';
import { Blackjack, handValue } from './blackjack.js';
import { buildLabFittings, SPOTS, BLOCKERS, WALK_BOUNDS } from './labroom.js';

const $ = (s) => document.querySelector(s);

/**
 * The lab build: everything in the stable game, plus the rest of the pub.
 *
 * You can get up from the table between shots and walk about — to the shrine
 * wall, the meme wall, the jar, the blackjack table and the bar — and the
 * points you win at any of them are the points you spend at the others.
 */
class LabGame extends Game {
  constructor() {
    super();
    this.wallet = new Wallet();
    this.mode = 'play';                 // play · walk
    this.panel = null;

    this._buildWalk();
    this._buildLabUI();
    this._buildFittings();
    this._applyGear();

    this.wallet.onChange(() => this._syncWallet());
    this._syncWallet();
  }

  /* ================= venue ================= */

  /* The chosen table design. Read straight from storage because this runs
     inside super(), before any of our own fields exist. Designs beyond the
     house table are loaded asynchronously, so a fresh session shows the bar box
     and picks up the rest on the next build — which is also the fallback if one
     of them ever fails to compile. */
  _tableDesign() {
    let id = 'barbox';
    try { id = localStorage.getItem('fuzz-and-feather:table') || 'barbox'; } catch { /* ignore */ }
    this.tableId = id;
    const d = getDesign(id);
    return d.meta.id === 'barbox' ? null : d;
  }

  _setTable(id) {
    if (id === this.tableId) return;
    try { localStorage.setItem('fuzz-and-feather:table', id); } catch { /* ignore */ }
    location.reload();      // a new table rebuilds the world; reloading is honest
  }

  async _buildTablePicker() {
    const sel = $('#opt-table');
    if (!sel) return;
    const all = await loadDesigns();
    sel.innerHTML = all
      .map((d) => `<option value="${d.meta.id}">${d.meta.name}</option>`).join('');
    sel.value = this.tableId;
    const blurb = () => { $('#table-blurb').textContent = getDesign(sel.value).meta.blurb; };
    blurb();
    sel.onchange = () => { blurb(); this._setTable(sel.value); };
  }

  _makeVenue() {
    // read straight from storage: this runs inside super(), before our fields
    let venue = 'bar';
    try { venue = localStorage.getItem('fuzz-and-feather:venue') || 'bar'; } catch { /* ignore */ }
    this.venue = venue;
    return venue === 'tiki' ? buildTikiBar() : buildBarRoom();
  }

  _venueSeats(n) {
    return this.venue === 'tiki' ? tikiSeats(n) : barSeats(n);
  }

  _setVenue(v) {
    if (v === this.venue) return;
    try { localStorage.setItem('fuzz-and-feather:venue', v); } catch { /* ignore */ }
    location.reload();      // a venue swap rebuilds the whole room; reloading is honest
  }

  /* ================= walking ================= */

  _buildWalk() {
    this.walker = new Walker({
      bounds: WALK_BOUNDS,
      onSpotChange: (spot) => this._onSpot(spot),
      onInteract: (spot) => this._interact(spot),
    });
    for (const b of BLOCKERS) this.walker.addBlocker(b[0], b[1], b[2], b[3]);
    for (const s of Object.values(SPOTS)) this.walker.addSpot({ ...s });

    addEventListener('mousemove', (e) => {
      if (this.mode === 'walk' && !this.panel) {
        this.walker.look(e.movementX || 0, e.movementY || 0);
      }
    });
    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (this.mode === 'walk') this.walker.key(k, true);
      if (k === 'f') { e.preventDefault(); this._toggleWalk(); }
      if (k === 'e' && this.mode === 'walk') { e.preventDefault(); this.walker.interact(); }
      if (e.key === 'Escape' && this.panel) this._closePanel();
    });
    addEventListener('keyup', (e) => this.walker.key(e.key.toLowerCase(), false));
  }

  _canWalk() {
    return this.phase === 'aim' || this.phase === 'over' || this.phase === 'ai' || this.phase === 'place';
  }

  _toggleWalk() {
    if (this.mode === 'walk') return this._sitDown();
    if (!this._canWalk()) {
      this.hud.chaos('NOT WHILE THE BALLS ARE MOVING');
      return;
    }
    this.mode = 'walk';
    this.control.enabled = false;
    this.cueRig.setVisible(false);
    this.freeCam = false;
    this.orbit.enabled = false;
    this.control.lock();
    // stand up on the near side of the table
    this.walker.enter(0.9, 1.9, Math.PI * 0.9);
    document.body.classList.add('walking');
    $('#walk-hint').classList.remove('hidden');
    this.hud.hint('');
  }

  _sitDown() {
    this.mode = 'play';
    this.walker.leave();
    this._closePanel();
    document.body.classList.remove('walking');
    $('#walk-hint').classList.add('hidden');
    this.camera.rotation.set(0, 0, 0);
    if (this.phase === 'aim') {
      this.control.enabled = true;
      this.control.rearm();
      this._aimCam();
    } else if (this.phase === 'place') {
      this.control.enabled = true;
      this.control.placing();
      this._overheadCam();
    }
  }

  _onSpot(spot) {
    const el = $('#prompt');
    if (!spot) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = `<b>E</b> ${spot.label}`;
  }

  _interact(spot) {
    switch (spot.key) {
      case 'table': this._sitDown(); break;
      case 'jar': this._openPanel('jar'); break;
      case 'blackjack': this._openPanel('blackjack'); break;
      case 'shop': this._openPanel('shop'); break;
      case 'memes': this._openPanel('memes'); break;
      case 'bounty': this._openPanel('bounty'); break;
      default: break;
    }
  }

  /* ================= fittings ================= */

  async _buildFittings() {
    this.fittings = await buildLabFittings({
      storage: localStorage,
      onMemeChange: (s) => this._renderMemes(s),
    });
    this.scene.add(this.fittings.group);
    this.jarAnswer = this.fittings.jarCount;
    this.fittings.bountyPromise.then((wall) => {
      this.bounty = wall;
      this._renderBounty();
    });
    this._renderJar();
    this._renderMemes(this.fittings.memes.status());
  }

  /* ================= gear ================= */

  /** Push the equipped cue and cloth into the sim and the stroke control. */
  _applyGear() {
    const cue = byId(this.wallet.data.equipped.cue) ?? byId('cue-house');
    const felt = byId(this.wallet.data.equipped.felt) ?? byId('felt-green');

    this.control.power = (cue.effect.power ?? 1) * this.opts.power;
    // a better cue forgives a crooked push
    this.opts.assistLess = 0.45 + (cue.effect.accuracy ?? 0) * 0.5;
    this.sim.cfg.muRoll = felt.effect.muRoll ?? 0.014;

    if (felt.effect.colour && this.table?.clothMat) {
      this.table.clothMat.color.set(felt.effect.colour);
      this.table.clothMat.needsUpdate = true;
    } else if (this.table?.clothMat) {
      this.table.clothMat.color.set(0xffffff);
    }
  }

  /* ================= panels ================= */

  _openPanel(name) {
    this.panel = name;
    document.body.classList.add('paneled');
    for (const el of document.querySelectorAll('.lab-panel')) el.classList.add('hidden');
    $(`#panel-${name}`).classList.remove('hidden');
    this.control.unlock();
    if (name === 'jar') this._renderJar();
    if (name === 'shop') this._renderShop();
    if (name === 'blackjack') this._renderBlackjack();
    if (name === 'bounty') this._renderBounty();
  }

  _closePanel() {
    if (!this.panel) return;
    this.panel = null;
    document.body.classList.remove('paneled');
    for (const el of document.querySelectorAll('.lab-panel')) el.classList.add('hidden');
    if (this.mode === 'walk') this.control.lock();
  }

  _syncWallet() {
    $('#points-value').textContent = this.wallet.points.toLocaleString();
  }

  /* ---------------- the jar ---------------- */

  _renderJar() {
    const box = $('#jar-body');
    if (!box || !this.fittings) return;
    const kind = this.fittings.packed.kind;
    const record = this.wallet.jarFor();
    if (record) {
      box.innerHTML = `
        <p class="lab-lead">TODAY'S JAR: <b>${kind.name}</b></p>
        <p class="lab-big">${record.actual}</p>
        <p class="lab-lead">YOU SAID <b>${record.guess}</b> — OUT BY ${record.err}</p>
        <p class="lab-note">PAID <b>${record.points}</b> POINTS. ONE GO A DAY, AND YOU HAVE HAD IT.</p>`;
      return;
    }
    box.innerHTML = `
      <p class="lab-lead">TODAY'S JAR IS FULL OF <b>${kind.name}</b></p>
      <p class="lab-note">Everything in there is a separate object. Nothing overlaps.
        Closest guess wins, and closer pays more.</p>
      <div class="lab-row">
        <input id="jar-guess" type="number" min="1" max="9999" placeholder="HOW MANY?" />
        <button id="jar-submit">WRITE IT DOWN</button>
      </div>`;
    $('#jar-submit').onclick = () => {
      const v = Math.round(+$('#jar-guess').value);
      if (!Number.isFinite(v) || v < 1) return;
      const res = this.wallet.submitJarGuess(v, this.jarAnswer);
      if (!res.ok) return;
      this.audio.bell();
      this.crowd.react(res.points > 200 ? 1.4 : 0.4, 0.4);
      this.hud.chaos(res.verdict);
      this._renderJar();
    };
  }

  /* ---------------- shop ---------------- */

  _renderShop() {
    const box = $('#shop-body');
    const eq = this.wallet.data.equipped;
    box.innerHTML = STOCK.map((item) => {
      const owned = this.wallet.owns(item.id);
      const equipped = item.slot && eq[item.slot] === item.id;
      const action = item.consumable
        ? `<button data-buy="${item.id}">BUY · ${item.cost}</button>`
        : owned
          ? (equipped ? '<span class="lab-tag on">IN USE</span>'
            : `<button data-equip="${item.id}">USE IT</button>`)
          : `<button data-buy="${item.id}">BUY · ${item.cost}</button>`;
      return `<div class="shop-item${equipped ? ' on' : ''}">
        <div class="shop-name">${item.name}</div>
        <div class="shop-blurb">${item.blurb}</div>
        <div class="shop-action">${action}</div>
      </div>`;
    }).join('');

    box.querySelectorAll('[data-buy]').forEach((b) => {
      b.onclick = () => {
        const item = byId(b.dataset.buy);
        const res = this.wallet.buy(item);
        if (!res.ok) { this.hud.chaos(res.why); return; }
        this.audio.click();
        if (item.effect?.drink) this._drink(item.effect.drink);
        if (item.effect?.crowd) {
          this.chaos.setDrunk(Math.min(1, this.chaos.drunk + 0.25));
          this.crowd.react(1.4, 0.3);
          this.audio.roar(1.2);
          this.hud.chaos('A ROUND FOR THE ROOM');
        }
        this._applyGear();
        this._renderShop();
      };
    });
    box.querySelectorAll('[data-equip]').forEach((b) => {
      b.onclick = () => {
        const item = byId(b.dataset.equip);
        this.wallet.equip(item.slot, item.id);
        this._applyGear();
        this._renderShop();
      };
    });
  }

  _drink(strength) {
    const n = this.wallet.drink();
    this.drinkWobble = (this.drinkWobble ?? 0) + strength * 0.04;
    this.chaos.setDrunk(Math.min(1, this.chaos.drunk + strength * 0.06));
    this.crowd.react(0.5, 0.5);
    this.audio.glug?.();
    this.hud.chaos(n > 4 ? 'THAT IS ENOUGH NOW' : 'DOWN IT GOES');
  }

  /* ---------------- blackjack ---------------- */

  _renderBlackjack() {
    if (!this.bj) {
      // the constructor resets, which fires onChange — so only subscribe once
      // it exists, or rendering recurses straight back into a new table
      this.bj = new Blackjack({
        rng: mulberry32((Math.random() * 1e9) | 0),
        wallet: this.wallet,
      });
      this.bj.onChange = () => this._renderBlackjack();
    }
    const g = this.bj;
    const box = $('#blackjack-body');
    const cards = (list, hide) => list.map((c, i) => (hide && i === 1
      ? '<span class="card back">?</span>'
      : `<span class="card${c.s === '♥' || c.s === '♦' ? ' red' : ''}">${c.r}${c.s}</span>`)).join('');

    const hideHole = g.state === 'playing';
    const dealerVal = hideHole ? handValue([g.dealer[0]]).total : handValue(g.dealer).total;

    let html = `
      <div class="bj-row"><span class="bj-label">DEALER</span>
        <span class="bj-cards">${cards(g.dealer, hideHole)}</span>
        <span class="bj-total">${g.dealer.length ? dealerVal : ''}</span></div>`;

    html += g.hands.map((h, i) => `
      <div class="bj-row${i === g.active && g.state === 'playing' ? ' active' : ''}">
        <span class="bj-label">${g.hands.length > 1 ? `HAND ${i + 1}` : 'YOU'}</span>
        <span class="bj-cards">${cards(h.cards, false)}</span>
        <span class="bj-total">${handValue(h.cards).total}</span>
        <span class="bj-outcome">${h.outcome ?? ''}</span>
      </div>`).join('');

    html += `<p class="lab-note">${g.message}</p>`;

    if (g.state === 'betting') {
      html += `<div class="lab-row">
        ${[25, 50, 100, 250].map((v) => `<button data-bet="${v}">${v}</button>`).join('')}
      </div>`;
    } else if (g.state === 'playing') {
      html += `<div class="lab-row">
        <button data-act="hit">HIT</button>
        <button data-act="stand">STAND</button>
        <button data-act="double">DOUBLE</button>
        ${g.canSplit() ? '<button data-act="split">SPLIT</button>' : ''}
      </div>`;
    } else {
      const net = g.net;
      html += `<p class="lab-big ${net > 0 ? 'good' : net < 0 ? 'bad' : ''}">${net > 0 ? '+' : ''}${net}</p>
        <div class="lab-row"><button data-act="again">ANOTHER</button></div>`;
    }
    box.innerHTML = html;

    box.querySelectorAll('[data-bet]').forEach((b) => {
      b.onclick = () => {
        const r = g.deal(+b.dataset.bet);
        if (!r.ok) this.hud.chaos(r.why);
      };
    });
    box.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.act;
        if (a === 'hit') g.hit();
        else if (a === 'stand') g.stand();
        else if (a === 'double') { const r = g.double(); if (!r.ok) this.hud.chaos(r.why); }
        else if (a === 'split') { const r = g.split(); if (!r.ok) this.hud.chaos(r.why); }
        else if (a === 'again') g.reset();
      };
    });
  }

  /* ---------------- walls ---------------- */

  _renderMemes(status) {
    const box = $('#memes-body');
    if (!box || !status) return;
    box.innerHTML = `
      <p class="lab-lead">${status.category} — ${status.sub}</p>
      <p class="lab-note">${status.slide} of ${status.total}${status.custom ? '' : ' · house artwork'}</p>
      <div class="lab-row">
        <button id="meme-prev">◀</button>
        <button id="meme-cat">SWITCH CATEGORY</button>
        <button id="meme-next">▶</button>
      </div>
      ${status.custom ? '' : `<p class="lab-note small">No images have been dropped in for this
        category yet, so the wall is showing its own artwork. Put files in
        <code>public/memes/&lt;category&gt;/</code> with an <code>index.json</code>
        and they will appear here instead.</p>`}`;
    $('#meme-prev').onclick = () => this.fittings.memes.next(-1);
    $('#meme-next').onclick = () => this.fittings.memes.next(1);
    $('#meme-cat').onclick = () => this.fittings.memes.cycleCategory();
  }

  _renderBounty() {
    const box = $('#bounty-body');
    if (!box) return;
    if (!this.bounty) { box.innerHTML = '<p class="lab-note">STILL COMING OVER THE WIRE…</p>'; return; }
    const { entries, sources } = this.bounty;
    const status = Object.entries(sources)
      .map(([k, v]) => `${k}: ${v.ok ? `${v.count} live` : 'no answer'}`).join(' · ');
    box.innerHTML = `
      <p class="lab-note">${status}</p>
      ${entries.length ? entries.map((e) => `
        <div class="bounty-row">
          <span class="bounty-rank">${e.rank}</span>
          <span class="bounty-name">${e.name}</span>
          <span class="bounty-src">${e.source}</span>
          <span class="bounty-charge">${e.charges}</span>
        </div>`).join('')
    : '<p class="lab-note">Nothing came over the wire, so the wall is empty. The muppets refuse to make anyone up.</p>'}`;
  }

  /* ================= UI ================= */

  _buildLabUI() {
    for (const btn of document.querySelectorAll('[data-close]')) {
      btn.onclick = () => this._closePanel();
    }
    const venue = $('#opt-venue');
    if (venue) {
      venue.value = this.venue;
      venue.onchange = () => this._setVenue(venue.value);
    }
    $('#walk-btn')?.addEventListener('click', () => this._toggleWalk());
    this._buildTablePicker();

    const time = $('#opt-time');
    if (time) {
      let saved = 'night';
      try { saved = localStorage.getItem('fuzz-and-feather:time') || 'night'; } catch { /* ignore */ }
      time.value = saved;
      this._applyTime(saved);
      time.onchange = () => {
        try { localStorage.setItem('fuzz-and-feather:time', time.value); } catch { /* ignore */ }
        this._applyTime(time.value);
      };
    }
  }

  /* ================= frame ================= */

  _frame() {
    // walking suspends the shot camera entirely; everything else still ticks
    if (this.mode === 'walk') {
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.time += dt;
      for (let i = this.timers.length - 1; i >= 0; i--) {
        const t = this.timers[i];
        t.t -= dt;
        if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); }
      }
      if (!this.panel) this.walker.update(dt, this.camera);
      if (this.sim.moving()) this.sim.step(dt);
      this._drainSim();
      this._syncBalls();
      this.chaos.update(dt, this.time, { rolling: false, aiming: false });
      this.crowd.update(this.time, dt);
      this.hypeSmoothed += (this.crowd.globalHype - this.hypeSmoothed) * Math.min(1, dt * 4);
      for (const d of this.bar.dyn) d.update(this.time, dt, this.hypeSmoothed);
      for (const d of this.fittings?.dyn ?? []) d.update(this.time, dt, this.hypeSmoothed);
      this.audio.update(dt, this.hypeSmoothed);
      this.renderer.render(dt, this.time, this.hypeSmoothed);
      return;
    }

    super._frame();
    for (const d of this.fittings?.dyn ?? []) d.update(this.time, 1 / 60, this.hypeSmoothed);
  }

  /* the drink is not free: it widens every shot until it wears off */
  _shoot(ev) {
    if (this.drinkWobble) {
      const w = this.drinkWobble;
      ev = { ...ev, yaw: ev.yaw + (Math.random() - 0.5) * w, straight: ev.straight * (1 - w * 2) };
      this.drinkWobble = Math.max(0, w - 0.004);
    }
    super._shoot(ev);
  }

  _gameOver() {
    super._gameOver();
    const won = this.match.winner === 0;
    this.wallet.earn(won ? 300 : 40, 'pool');
    this.wallet.record(won ? 'racksWon' : 'racksLost');
    this.hud.chaos(won ? '+300 POINTS' : '+40 FOR TURNING UP');
  }
}

new LabGame();

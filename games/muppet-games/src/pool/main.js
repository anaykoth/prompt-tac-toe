import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { Renderer, STYLES, STYLE_KEYS } from '../core/render.js';
import { Audio } from '../core/audio.js';
import { Crowd } from '../world/crowd.js';

import { PoolSim, rackEight, mulberry32, TABLE, BALL_R } from './physics.js';
import { buildTable, buildBalls } from './table.js';
import { buildBarRoom, barSeats } from './barroom.js';
import { Match, AI_LEVELS, aiShot, aiPlacement, groupOf } from './rules.js';
import { CueControl, CueRig, traceAim } from './cue.js';
import { Chaos } from './chaos.js';
import { PoolHud, shotReaction } from './hud.js';
import { LocalTransport, encodeShot } from './net.js';
import { resolveStroke, StrokeFeedback } from './stroke-feedback.js';

const $ = (s) => document.querySelector(s);
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

const AIM_FOV = 52;

export class Game {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(AIM_FOV, innerWidth / innerHeight, 0.03, 60);
    this.scene.add(this.camera);

    this.renderer = new Renderer($('#stage'), this.scene, this.camera);
    this.audio = new Audio();
    this.hud = new PoolHud();
    this.net = new LocalTransport();

    this.opts = {
      opponent: 'ai-local', crowd: 38, chaos: 1, sens: 1, power: 1,
      sound: true, autocam: true, aimline: true, strokeTrace: true,
    };

    this.timers = [];
    this.phase = 'intro';
    this.clock = new THREE.Clock();
    this.time = 0;
    this.hypeSmoothed = 0;
    this.runOfPots = 0;
    this.shotClock = 0;

    this.seed = (Math.random() * 1e9) | 0;
    this._buildWorld();
    this._buildControls();
    this._buildUI();
    this._newRack(true);

    addEventListener('keydown', (e) => this._key(e));
    this.renderer.renderer.setAnimationLoop(() => this._frame());
    window.pool = this;
  }

  /* ================= world ================= */

  /** Overridden by builds that offer more than one table design. */
  _tableDesign() { return null; }

  /** Overridden by builds that offer more than one venue. */
  _makeVenue() { return buildBarRoom(); }

  _venueSeats(n) { return barSeats(n); }

  _buildWorld() {
    this.bar = this._makeVenue();
    this.scene.add(this.bar.group);

    /* A design supplies its own geometry, mesh, rack and — if its bed is not
       flat — its height field. Without one this is the house bar box, which is
       what the stable build always gets. */
    this.design = this._tableDesign();
    if (this.design) {
      this.tableGeo = this.design.buildGeometry();
      this.tableMesh = this.design.buildMesh(this.tableGeo);
      this.scene.add(this.tableMesh);
      this.bounds = this.design.bounds;
      this.tableHeight = this.design.height;
    } else {
      this.table = buildTable();
      this.scene.add(this.table.group);
      this.tableGeo = null;
      this.bounds = { halfLen: TABLE.halfLen, halfWid: TABLE.halfWid };
      this.tableHeight = TABLE.height;
    }

    this.sim = new PoolSim({
      rng: mulberry32(this.seed),
      geo: this.tableGeo ?? undefined,
      terrain: this.design?.terrain ?? null,
      inBounds: this.design?.inBounds ?? null,
    });

    const balls = buildBalls([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    this.ballMeshes = balls.meshes;
    this.scene.add(balls.group);

    this.pocketed = [];        // meshes falling into the nets
    this.cueRig = new CueRig(this.scene);

    this._makeCrowd(this.opts.crowd);

    this.chaos = new Chaos({
      scene: this.scene, sim: this.sim, crowd: this.crowd, audio: this.audio,
      rng: mulberry32(this.seed ^ 0x5bf03),
      onEvent: (e) => this._onChaos(e),
    });

    this.rig = {
      pos: new THREE.Vector3(0, TABLE.height + 0.9, 2.4),
      look: new THREE.Vector3(0, TABLE.height, 0),
      fov: AIM_FOV,
      tPos: new THREE.Vector3(0, TABLE.height + 0.9, 2.4),
      tLook: new THREE.Vector3(0, TABLE.height, 0),
      tFov: AIM_FOV,
      rate: 4.5,
    };
    this.camera.position.copy(this.rig.pos);

    this.orbit = new OrbitControls(this.camera, this.renderer.renderer.domElement);
    this.orbit.target.set(0, TABLE.height, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.minDistance = 0.6;
    this.orbit.maxDistance = 9;
    this.orbit.enabled = false;
    this.freeCam = false;
  }

  _makeCrowd(n) {
    this.crowd?.dispose();
    this.crowd = new Crowd(this.scene, this._venueSeats(n), {
      focus: new THREE.Vector3(0, TABLE.height + 0.1, 0),
      scale: 0.88,          // chest-height on the rail: they can lean on the table
      trackHands: true,
      mugs: 0.55,
    });
    if (this.chaos) this.chaos.crowd = this.crowd;
  }

  /* ================= match ================= */

  _newRack(first = false) {
    this.sim.balls.length = 0;
    this.sim.puddles.length = 0;
    this.chaos?.clearAll();
    const rack = this.design ? this.design.rack(mulberry32(this.seed))
      : rackEight(mulberry32(this.seed));
    for (const b of rack) this.sim.add(b);
    for (const m of this.pocketed) this.scene.remove(m.mesh);
    this.pocketed.length = 0;

    for (const [, mesh] of this.ballMeshes) mesh.visible = false;
    for (const b of this.sim.balls) {
      const mesh = this.ballMeshes.get(b.num);
      if (mesh) mesh.visible = true;
    }

    if (first || !this.match) {
      this.match = new Match({
        names: ['YOU', this.opts.opponent === 'hotseat' ? 'PLAYER TWO' : AI_LEVELS[this.opts.opponent].name],
      });
    } else {
      this.match.reset();
      this.match.names[1] = this.opts.opponent === 'hotseat' ? 'PLAYER TWO' : AI_LEVELS[this.opts.opponent].name;
    }
    this.hud.setNames(this.match.names[0], this.match.names[1]);
    this.chaos?.setDrunk(0.08);
    this.matchStart = this.time;
    this.runOfPots = 0;
    this._syncBalls(true);
    this.hud.sync(this.match, this.sim);
  }

  get aiSeat() { return this.opts.opponent === 'hotseat' ? -1 : 1; }

  _isAITurn() { return this.match.current === this.aiSeat && !this.match.finished; }

  _start() {
    this.audio.init();
    this.audio.resume();
    this.audio.enabled = this.opts.sound;
    this.hud.hideIntro();
    this.phase = 'aim';
    this.control.enabled = true;
    this.crowd.react(0.5, 0.9);
    this.audio.roar(0.5);
    this._beginTurn();
  }

  _beginTurn() {
    if (this.match.finished) return;
    this.chaos.endShot();
    this.hud.sync(this.match, this.sim);

    if (this.match.ballInHand || this.match.isBreak()) {
      this._beginPlacement();
      return;
    }
    this._beginAim();
  }

  _beginAim() {
    const ai = this._isAITurn();
    this.phase = ai ? 'ai' : 'aim';
    this.control.enabled = !ai;
    this.cueRig.setVisible(true);
    if (ai) {
      this.control.idle();
      this._aimCam();
      this._after(0.9, () => this._aiTakeShot());
    } else {
      this.control.rearm();
      // point the cue at something sensible to start with
      this._autoAim();
      this._aimCam();
      this.hud.hint(this.control.meta?.hint ?? 'CLICK TO TAKE THE CUE');
    }
  }

  /** Face the nearest legal ball so the player is never aiming at the wall. */
  _autoAim() {
    const cue = this.sim.cue;
    if (!cue?.live) return;
    const targets = this.match.legalTargets(this.sim)
      .map((n) => this.sim.byNum(n)).filter(Boolean);
    if (!targets.length) return;
    targets.sort((a, b) => Math.hypot(a.x - cue.x, a.z - cue.z) - Math.hypot(b.x - cue.x, b.z - cue.z));
    const t = targets[0];
    this.control.yaw = Math.atan2(t.z - cue.z, t.x - cue.x);
  }

  _beginPlacement() {
    const ai = this._isAITurn();
    if (ai) {
      const spot = aiPlacement(this.sim, this.match, () => this.sim.rng());
      this.sim.placeCue(spot.x, spot.z);
      this.match.ballInHand = false;
      this._after(0.6, () => this._beginAim());
      this.phase = 'ai';
      this._overheadCam();
      return;
    }
    this.phase = 'place';
    this.control.enabled = true;
    this.control.placing();
    const cue = this.sim.cue;
    const bounds = this._placementBounds();
    const start = cue?.live
      ? { x: clamp(cue.x, bounds.minX, bounds.maxX), z: clamp(cue.z, bounds.minZ, bounds.maxZ) }
      : { x: -TABLE.halfLen * 0.55, z: 0 };
    this.control.placeTarget.set(start.x, start.z);
    this.sim.placeCue(start.x, start.z);
    this.cueRig.setVisible(false);
    this._overheadCam();
    this.hud.hint(this.match.isBreak()
      ? 'BALL IN HAND — behind the head string. MOUSE to move, CLICK to place'
      : 'BALL IN HAND — MOUSE to move, CLICK to place');
  }

  /** The match's rectangle, narrowed to whatever the current design allows. */
  _placementBounds() {
    const b = this.match.placementBounds();
    if (!this.design) return b;
    const { halfLen, halfWid } = this.bounds;
    return {
      minX: Math.max(b.minX, -halfLen + BALL_R * 2),
      maxX: Math.min(b.maxX, halfLen - BALL_R * 2),
      minZ: Math.max(b.minZ, -halfWid + BALL_R * 2),
      maxZ: Math.min(b.maxZ, halfWid - BALL_R * 2),
    };
  }

  _placeCue() {
    const b = this._placementBounds();
    const p = this.control.placeTarget;
    p.x = clamp(p.x, b.minX, b.maxX);
    p.y = clamp(p.y, b.minZ, b.maxZ);
    if (!this.sim.freeAt(p.x, p.y, BALL_R, this.sim.cue)) return false;
    this.sim.placeCue(p.x, p.y);
    this.match.ballInHand = false;
    this.audio.click();
    this._beginAim();
    return true;
  }

  /* ================= shooting ================= */

  _shoot(ev) {
    if (this.phase !== 'aim' && this.phase !== 'ai') return;
    const cue = this.sim.cue;
    if (!cue?.live) return;

    const resolved = resolveStroke(ev, this.opts.assistLess);
    const { yaw, tipX } = resolved;
    if (this.phase === 'aim') this.control.trace.finish(resolved);

    this.net.send(encodeShot({ ...ev, yaw, tipX }));
    this.sim.strike(yaw, ev.speed, tipX, ev.tipY, ev.elevation);

    this.cueRig.strike(ev.speed);
    this.audio.cueStrike(ev.speed);
    this.chaos.beginShot();
    this.phase = 'rolling';
    this.control.enabled = false;
    this.shotClock = 0;
    this.crowd.react(0.12, 0.3);
    this.hud.power(0, 'off');
    this.hud.hint('');
    if (this.opts.autocam && !this.freeCam) this._actionCam();
  }

  _aiTakeShot() {
    if (!this._isAITurn()) return;
    const shot = aiShot(this.sim, this.match, this.opts.opponent, () => this.sim.rng());
    if (!shot) { this._endShot(); return; }
    this.control.yaw = shot.yaw;
    this.control.tipX = shot.tipX ?? 0;
    this.control.tipY = shot.tipY ?? 0.15;
    this.control.elevation = 0;
    // let the cue settle on the line before it goes
    this._after(0.65, () => {
      if (!this._isAITurn()) return;
      this._shoot({ ...shot, elevation: 0, straight: 1, pull: 0 });
    });
  }

  _endShot() {
    const log = this.sim.log;
    const res = this.match.applyShot(this.sim, log);

    // spot the 8 if it went down on the break
    if (log.pocketed.includes(8) && !res.win && !res.lose) {
      const spot = this.sim.nearestFree(TABLE.halfLen * 0.5, 0);
      const eight = this.sim.byNum(8);
      if (eight) {
        Object.assign(eight, { x: spot.x, z: spot.z, y: 0, live: true, pocketed: false, asleep: true });
        const mesh = this.ballMeshes.get(8);
        if (mesh) mesh.visible = true;
      }
    }

    const potted = res.potted.length;
    this.runOfPots = potted ? this.runOfPots + potted : 0;
    const r = shotReaction(res, {
      run: this.runOfPots,
      safety: !potted && !res.foul,
      long: potted === 1 && log.contacts <= 2,
    });
    this.hud.toast(r.big, r.small, r.color);
    this.crowd.react(r.hype, r.hype > 0.9 ? 0.25 : 0.5);
    this.audio.roar(r.hype);
    if (res.assigned) this.hud.chaos(`${this.match.names[this.match.finished ? 0 : 1 - this.match.current]} — ${res.assigned.toUpperCase()}`);

    this.hud.sync(this.match, this.sim);

    if (this.match.finished) {
      this._gameOver();
      return;
    }
    if (res.turnOver) this.runOfPots = 0;

    const pause = potted ? 0.8 : 1.0;
    this._after(pause, () => {
      if (this.opts.autocam && !this.freeCam) this._aimCam();
      this._beginTurn();
    });
  }

  _gameOver() {
    this.phase = 'over';
    this.control.enabled = false;
    this.control.unlock();
    this.cueRig.setVisible(false);
    const won = this.match.winner === 0;
    this.crowd.react(won ? 1.9 : 1.2, 0.2);
    this.crowd.burstConfetti(700, new THREE.Vector3(0, TABLE.height + 1.4, 0));
    this.audio.roar(1.8);
    this.audio.bell();
    this._crowdCam();
    const name = this.match.names[this.match.winner];
    const line = this.match.lastResult?.lose
      ? 'ON THE BLACK. THE ROOM WILL NEVER LET IT GO.'
      : 'CLEARED UP AND CALLED IT.';
    this._after(3.2, () => this.hud.showWin(name, line, () => {
      this.seed = (Math.random() * 1e9) | 0;
      this.sim.rng = mulberry32(this.seed);
      this.hud.els.intro.classList.remove('win');
      this.hud.hideIntro();
      this._newRack();
      this.phase = 'aim';
      this.control.enabled = true;
      this._beginTurn();
    }));
  }

  /* ================= events from the sim ================= */

  _drainSim() {
    for (const e of this.sim.drainEvents()) {
      switch (e.type) {
        case 'click':
          this.audio.ballClick(e.speed);
          if (e.speed > 2.2) this.crowd.react(0.1, 0.4);
          break;
        case 'rail':
          if (e.speed > 0.35) this.audio.railThud(e.speed);
          break;
        case 'pocket': {
          this.audio.pocketDrop();
          this.crowd.react(0.55, 0.25);
          const mesh = this.ballMeshes.get(e.ball);
          if (mesh) this.pocketed.push({ mesh, t: 0, x: e.x, z: e.z });
          break;
        }
        case 'junkpocket':
          this.audio.clatter();
          this.hud.chaos('THAT WENT IN A POCKET AND NOBODY IS GETTING IT OUT');
          this.crowd.react(0.8, 0.3);
          break;
        case 'junkhit':
          this.audio.thud(0.5);
          this.crowd.react(0.45, 0.3);
          break;
        case 'land':
          if (e.speed > 0.6) this.audio.thud(clamp(e.speed / 3, 0.2, 1));
          break;
        case 'offtable':
          this.audio.clatter();
          this.crowd.react(0.9, 0.2);
          this.hud.chaos('THAT IS SOMEWHERE UNDER THE JUKEBOX NOW');
          break;
        default: break;
      }
    }
  }

  _onChaos(e) {
    this.hud.chaos(e.say);
    if (e.type === 'throw' || e.type === 'vomit') this.audio.roar(0.5);
  }

  /* ================= rendering sync ================= */

  _syncBalls(snap = false) {
    const q = new THREE.Quaternion();
    for (const b of this.sim.balls) {
      if (b.junk) continue;
      const mesh = this.ballMeshes.get(b.num);
      if (!mesh) continue;
      if (!b.live) { continue; }
      mesh.visible = true;
      mesh.position.set(b.x, TABLE.height + BALL_R + b.y, b.z);
      q.set(b.q[0], b.q[1], b.q[2], b.q[3]);
      mesh.quaternion.copy(q);
    }
    // balls on their way down a pocket
    for (let i = this.pocketed.length - 1; i >= 0; i--) {
      const p = this.pocketed[i];
      p.t += 1 / 60;
      const u = Math.min(1, p.t / 0.55);
      p.mesh.position.set(
        lerp(p.mesh.position.x, p.x, 0.25),
        TABLE.height + BALL_R - u * u * 0.42,
        lerp(p.mesh.position.z, p.z, 0.25),
      );
      p.mesh.rotateX(0.3);
      if (u >= 1) { p.mesh.visible = false; this.pocketed.splice(i, 1); }
    }
    if (snap) for (const p of this.pocketed) p.mesh.visible = false;
  }

  /* ================= cameras ================= */

  _setCam(pos, look, fov, rate = 4.5) {
    this.rig.tPos.copy(pos);
    this.rig.tLook.copy(look);
    this.rig.tFov = fov;
    this.rig.rate = rate;
  }

  /** Down the line of the shot, from behind and just above the cue ball. */
  _aimCam() {
    const cue = this.sim.cue;
    if (!cue?.live) return this._overheadCam();
    const yaw = this.control.yaw;
    // far enough back and high enough that the bridge hand frames the shot
    // instead of sitting on top of the cue ball
    const back = 1.02 + this.control.elevation * 0.22;
    const high = TABLE.height + 0.42 + this.control.elevation * 0.6;
    this._setCam(
      new THREE.Vector3(cue.x - Math.cos(yaw) * back, high, cue.z - Math.sin(yaw) * back),
      new THREE.Vector3(cue.x + Math.cos(yaw) * 0.75, TABLE.height + 0.03, cue.z + Math.sin(yaw) * 0.75),
      AIM_FOV, 7,
    );
  }

  _overheadCam() {
    this._setCam(
      new THREE.Vector3(0, TABLE.height + 2.15, 0.9),
      new THREE.Vector3(0, TABLE.height, 0),
      50, 3.2,
    );
  }

  /** Wide enough to watch the whole table while the balls run. */
  _actionCam() {
    const yaw = this.control.yaw;
    this._setCam(
      new THREE.Vector3(-Math.cos(yaw) * 1.5, TABLE.height + 1.15, -Math.sin(yaw) * 1.5),
      new THREE.Vector3(0, TABLE.height, 0),
      54, 2.4,
    );
  }

  _crowdCam() {
    const s = Math.random() < 0.5 ? -1 : 1;
    this._setCam(
      new THREE.Vector3(s * 1.5, TABLE.height + 0.75, 1.9),
      new THREE.Vector3(s * 3.2, 1.15, -0.6),
      50, 2.2,
    );
  }

  /* ================= ui ================= */

  _buildControls() {
    let mode = 'contact';
    try { mode = localStorage.getItem('fuzz-and-feather:controls') || mode; } catch { /* private browsing */ }
    if (mode !== 'classic' && mode !== 'contact') mode = 'contact';
    this.control = new CueControl(this.renderer.renderer.domElement, {
      mode,
      onShoot: (ev) => this._shoot(ev),
      onPlace: () => this._placeCue(),
      onMode: (id, status) => this._syncControlUI(id, status),
      onState: (state, locked) => {
        document.body.classList.toggle('locked', !!locked);
        if (state === 'aim' && !locked) this.hud.hint('CLICK TO TAKE THE CUE');
      },
    });
    this.opts.assistLess = 0.45;
  }

  _syncControlUI(id, status) {
    const waiting = status === 'loading' || status === 'pending';
    const desc = status === 'error' ? 'Could not load those controls. Try selecting them again.'
      : status === 'pending' ? 'Will switch after this stroke.'
        : status === 'loading' ? 'Loading controls…' : this.control?.meta?.description ?? '';
    $('#control-description')?.replaceChildren(document.createTextNode(desc));
    $('#intro-control-description')?.replaceChildren(document.createTextNode(desc));
    const select = $('#opt-controls');
    if (select) select.value = status === 'error' ? this.control?.mode ?? id : id;
    for (const button of document.querySelectorAll('[data-control-mode]')) {
      const selected = button.dataset.controlMode === id;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    const badge = $('#control-badge');
    if (badge) badge.textContent = `${id === 'classic' ? 'CLASSIC' : 'CONTACT'} STROKE${waiting ? '…' : ''} · TAB`;
    const start = $('#btn-start');
    if (start && this.phase === 'intro') start.disabled = !this.control?.stroke;
    if (status === 'ready') {
      try { localStorage.setItem('fuzz-and-feather:controls', id); } catch { /* private browsing */ }
      if (this.phase === 'aim') this.hud.hint(this.control.meta.hint);
    }
  }

  _buildUI() {
    this.strokeFeedback = new StrokeFeedback($('#stroke-feedback'));
    const room = new URLSearchParams(location.search).get('room');
    for (const link of document.querySelectorAll('.pub-return')) {
      link.href = `/pub.html${room ? `?room=${encodeURIComponent(room)}` : ''}`;
    }
    const labels = {};
    for (const k of STYLE_KEYS) labels[k] = STYLES[k].label;
    this.hud.buildStyleButtons(STYLE_KEYS, labels, (k) => this._setStyle(k));
    this._setStyle('alley');

    $('#btn-start').onclick = () => this._start();
    $('#opt-controls')?.addEventListener('change', (e) => this.control.setMode(e.target.value));
    for (const button of document.querySelectorAll('[data-control-mode]')) {
      button.onclick = () => this.control.setMode(button.dataset.controlMode);
    }
    $('#control-badge')?.addEventListener('click', () => this._togglePanel(true));
    $('#panel-toggle').onclick = () => this._togglePanel();
    $('#btn-rack').onclick = () => { this.seed = (Math.random() * 1e9) | 0; this.sim.rng = mulberry32(this.seed); this._newRack(); this._beginTurn(); };

    const bind = (id, key, fn) => {
      const el = $(id);
      if (!el) return;
      const read = () => (el.type === 'checkbox' ? el.checked : (isNaN(+el.value) ? el.value : +el.value));
      const apply = () => { this.opts[key] = read(); fn?.(this.opts[key]); };
      el.addEventListener('input', apply);
      el.addEventListener('change', apply);
    };
    bind('#opt-opponent', 'opponent', () => {
      this.match.names[1] = this.opts.opponent === 'hotseat' ? 'PLAYER TWO' : AI_LEVELS[this.opts.opponent].name;
      this.hud.setNames(this.match.names[0], this.match.names[1]);
      this.hud.sync(this.match, this.sim);
    });
    bind('#opt-crowd', 'crowd', (v) => this._makeCrowd(v));
    bind('#opt-chaos', 'chaos', (v) => this.chaos.setLevel(v));
    bind('#opt-sens', 'sens', (v) => { this.control.sens = v; });
    bind('#opt-power', 'power', (v) => { this.control.power = v; });
    bind('#opt-sound', 'sound', (v) => { this.audio.enabled = v; });
    bind('#opt-autocam', 'autocam');
    bind('#opt-aimline', 'aimline', (v) => { this.cueRig.line.visible = v; });
    bind('#opt-stroke-trace', 'strokeTrace');

    setTimeout(() => this.hud.hideLoading(), 300);
  }

  _togglePanel(force) {
    const p = $('#panel');
    const open = force !== undefined ? force : p.classList.contains('collapsed');
    p.classList.toggle('collapsed', !open);
    document.body.classList.toggle('uiopen', open);
    this.control.suspended = open || this.freeCam;
    this.control.keys.clear();
    if (open) this.control.unlock();
  }

  _setStyle(k) {
    this.renderer.setStyle(k);
    this.hud.markStyle(k);
    this.styleKey = k;
    /* The style owns the grade; the time of day owns the room. Re-applying the
       time after the style is what stops a shader preset quietly resetting the
       lights to midnight when you picked the afternoon. */
    this._applyTime(this.timeKey ?? 'night');
  }

  /** Set the hour, and re-assert whatever the current style wants on top. */
  _applyTime(key) {
    this.timeKey = key;
    if (!this.bar?.setTime) return;
    const t = this.bar.setTime(key);
    const s = STYLES[this.styleKey ?? 'alley'];

    // a style may pull the room darker or push the rims; it multiplies, not sets
    if (s?.lights?.hemi !== undefined) this.bar.lights.hemi.intensity *= s.lights.hemi / 0.45;
    this.styleRimBoost = s?.lights?.rimBoost ?? 1;

    if (t?.fog) {
      this.scene.fog = new THREE.Fog(t.fog.color, t.fog.near, t.fog.far);
      this.scene.background = new THREE.Color(t.fog.color);
    }
    this.hud.setTime?.(key);
  }

  _key(e) {
    if (e.key === 'Tab') { e.preventDefault(); this._togglePanel(); return; }
    if (e.target?.closest?.('input, select, textarea, button, [contenteditable="true"]')) return;
    /* 1-9 then 0 for the tenth, which is how a numeric row actually reads. */
    if (/^[0-9]$/.test(e.key)) {
      const idx = e.key === '0' ? 9 : +e.key - 1;
      if (idx < STYLE_KEYS.length) { this._setStyle(STYLE_KEYS[idx]); return; }
    }
    const k = e.key.toLowerCase();
    if (k === 'c') this._toggleFreeCam();
    if (k === 'v') this._overheadCam();
    if (k === 'e') this.control.centreTip();
    if (k === 'r' && this.phase !== 'intro') {
      this.seed = (Math.random() * 1e9) | 0;
      this.sim.rng = mulberry32(this.seed);
      this._newRack();
      this._beginTurn();
    }
    if (e.key === ' ') { e.preventDefault(); if (this.phase === 'aim') this._aimCam(); }
  }

  _toggleFreeCam() {
    this.freeCam = !this.freeCam;
    this.control.suspended = this.freeCam || !$('#panel').classList.contains('collapsed');
    this.orbit.enabled = this.freeCam;
    document.body.classList.toggle('freecam', this.freeCam);
    if (this.freeCam) {
      this.control.unlock();
      this.orbit.target.set(0, TABLE.height, 0);
      this.camera.position.set(2.2, TABLE.height + 1.5, 2.2);
      this.orbit.update();
    } else if (this.phase === 'aim') {
      this._aimCam();
    }
  }

  _after(sec, fn) { this.timers.push({ t: sec, fn }); }

  /* ================= frame ================= */

  _frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); }
    }

    this.control.tick(dt);
    this.control.update(dt);
    const rawPreview = this.control.previewShot();
    const strokePreview = rawPreview ? resolveStroke(rawPreview, this.opts.assistLess) : null;
    this.strokeFeedback.update(this.control, strokePreview,
      this.opts.strokeTrace && this.phase !== 'intro' && this.phase !== 'place' && !this.freeCam);

    /* ---- physics ---- */
    if (this.phase === 'rolling') {
      this.sim.step(dt);
      this.shotClock += dt;
      if (!this.sim.moving() || this.shotClock > 25) {
        this.phase = 'settle';
        this._after(0.35, () => this._endShot());
      }
    } else if (this.phase !== 'intro') {
      // junk that landed between shots still has to skid to a stop
      if (this.sim.moving()) this.sim.step(dt);
    }
    this._drainSim();
    this._syncBalls();

    /* ---- cue ---- */
    const aiming = this.phase === 'aim' || this.phase === 'ai';
    if (aiming || this.phase === 'rolling') {
      const cue = this.sim.cue;
      const showCue = aiming && cue?.live;
      this.cueRig.setVisible(!!showCue);
      if (showCue) {
        const trace = this.opts.aimline ? traceAim(this.sim, this.control.yaw) : null;
        const pull = this.control.visualPull;
        this.cueRig.update(cue, this.control, trace, dt, pull,
          this.opts.strokeTrace && this.phase === 'aim' ? strokePreview?.yaw ?? null : null);
        this.cueRig.line.visible = this.opts.aimline;
        this.hud.spin(this.control.tipX, this.control.tipY, this.control.elevation);
        const contact = this.control.mode === 'contact';
        const guide = $('#contact-guide');
        guide?.classList.toggle('hidden', !contact || this.phase !== 'aim');
        if (contact) {
          this.hud.power(0, 'off');
          const model = this.control.contactModel;
          const stroking = this.control.state === 'stroke';
          const distance = stroking ? model.distance : model.gap;
          $('#contact-marker')?.style.setProperty('left', `${94 - Math.min(320, distance) / 320 * 88}%`);
          const label = $('#contact-label');
          if (label) label.textContent = !stroking ? 'HOLD LEFT MOUSE · DRAW BACK · PUSH THROUGH'
            : !model.armed ? 'DRAW BACK TO SET YOUR STROKE'
              : `${Math.round(distance)} px TO CONTACT · RELEASE TO CANCEL`;
          guide?.classList.toggle('armed', stroking && model.armed);
        } else if (this.control.state === 'stroke') {
          this.hud.power(
            this.control.pushing ? Math.min(1, this.control.peak / 2600) : this.control.back / 320,
            this.control.pushing ? 'push' : 'back',
          );
        } else if (this.phase === 'aim') {
          this.hud.power(0, 'ready');
        }
        if (this.phase === 'aim' && !this.freeCam) this._aimCam();
      }
    } else {
      this.cueRig.setVisible(false);
      this.hud.power(0, 'off');
    }
    if (this.phase !== 'aim') $('#contact-guide')?.classList.add('hidden');

    /* ---- ball in hand ghost ---- */
    if (this.phase === 'place') {
      const b = this._placementBounds();
      const p = this.control.placeTarget;
      p.x = clamp(p.x, b.minX, b.maxX);
      p.y = clamp(p.y, b.minZ, b.maxZ);
      const cue = this.sim.cue;
      if (cue) {
        cue.x = p.x; cue.z = p.y;
        const ok = this.sim.freeAt(p.x, p.y, BALL_R, cue);
        const mesh = this.ballMeshes.get(0);
        if (mesh) {
          mesh.visible = true;
          mesh.position.set(p.x, TABLE.height + BALL_R, p.y);
          mesh.material.emissive?.setHex(ok ? 0x000000 : 0x551111);
        }
      }
    }

    /* ---- crowd, chaos, room ---- */
    if (this.phase !== 'intro') {
      const elapsed = this.time - (this.matchStart ?? this.time);
      this.chaos.setDrunk(Math.min(1, 0.08 + elapsed / 240));
      this.hud.drunk(this.chaos.drunk);
      this.chaos.update(dt, this.time, {
        rolling: this.phase === 'rolling',
        aiming: this.phase === 'aim',
      });
    }

    this.crowd.update(this.time, dt);
    this.hypeSmoothed += (this.crowd.globalHype - this.hypeSmoothed) * Math.min(1, dt * 4);
    for (const d of this.bar.dyn) d.update(this.time, dt, this.hypeSmoothed);
    this.audio.update(dt, this.hypeSmoothed);

    const rims = this.bar.lights.rims;
    /* Coloured rims are a night-time effect: at four in the afternoon they read
       as a fault, so the hour scales them along with everything else. */
    const rimK = (rims[0].userData.dayScale ?? 1) * (this.styleRimBoost ?? 1);
    rims[0].intensity = (7 + this.hypeSmoothed * 22 + Math.sin(this.time * 9) * this.hypeSmoothed * 6) * rimK;
    rims[1].intensity = (7 + this.hypeSmoothed * 22 + Math.cos(this.time * 7.4) * this.hypeSmoothed * 6) * rimK;
    rims[2].intensity = 5 * rimK;

    /* ---- camera ---- */
    if (this.freeCam) {
      this.orbit.update();
    } else {
      const r = this.rig;
      const k = 1 - Math.exp(-r.rate * dt);
      r.pos.lerp(r.tPos, k);
      r.look.lerp(r.tLook, k);
      r.fov = lerp(r.fov, r.tFov, k);
      const shake = this.hypeSmoothed * 0.006;
      this.camera.position.set(
        r.pos.x + (Math.random() - 0.5) * shake,
        r.pos.y + Math.sin(this.time * 2.1) * 0.002 + (Math.random() - 0.5) * shake,
        r.pos.z + (Math.random() - 0.5) * shake,
      );
      this.camera.lookAt(r.look);
      if (Math.abs(this.camera.fov - r.fov) > 0.01) {
        this.camera.fov = r.fov;
        this.camera.updateProjectionMatrix();
      }
    }

    this.renderer.render(dt, this.time, this.hypeSmoothed);
  }
}

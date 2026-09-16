import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { Renderer, STYLES, STYLE_KEYS } from '../../darts/src/core/render.js';
import { Audio } from '../../darts/src/core/audio.js';
import { Crowd } from '../../darts/src/world/crowd.js';
import { defaultSpec } from '../../darts/src/world/puppet.js';
import { Maker, loadSpec } from '../../darts/src/game/maker.js';
import { Bar, DRINKS } from '../../darts/src/game/bar.js';
import { mulberry32, newSeed } from '../../darts/src/game/rng.js';

import { buildLists, crowdSeats, ROYAL_BOX } from './world/lists.js';
import { Rider } from './world/rider.js';
import { MASKS } from './world/masks.js';

import { PassSim, newPassSeed } from './game/pass.js';
import { Match, passSummary } from './game/rules.js';
import { Hud, eventReaction } from './game/hud.js';
import { Cpu, KNIGHTS } from './game/cpu.js';
import { Store } from './game/store.js';
import {
  packInput, IMPACT, RIDER, SEAT, TICK, DEFAULT_PASSES, LANE_HALF, IDLE_INPUT,
} from './game/spec.js';
import { JoustSession, readToken } from './net/online.js';
import { LiveLink, RemoteLog, denseLog, BATCH_TICKS, LAG_TICKS } from './net/live.js';

const $ = (s) => document.querySelector(s);
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

const ACCENT = ['#ff3d2e', '#2fb6ff'];
const RIDE_FOV = 58;

/* Scratch — the frame loop allocates nothing it can help. */
const _look = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _off = new THREE.Vector3();

/* ================================================================== */

class Game {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(RIDE_FOV, innerWidth / innerHeight, 0.05, 140);
    this.scene.add(this.camera);

    this.renderer = new Renderer($('#stage'), this.scene, this.camera);
    this.audio = new Audio();
    this.hud = new Hud();

    this.opts = {
      passes: DEFAULT_PASSES, unhorse: false, opponent: 'cpu-knight',
      crowd: 132, sens: 1, sound: true, bar: true,
    };

    this.bar = new Bar();
    this.store = new Store(this.bar);

    /* online: nothing here assumes "me = rider 0" once a seat is dealt */
    this.mySeat = 0;          // 0 offline; the server decides it from the token
    this.net = null;          // JoustSession — the authoritative tier
    this.live = null;         // LiveLink — the tick stream, spectacle only
    this.theirSpec = null;    // the other seat's puppet, from presence
    this.theirDrunk = 0;
    this.liveSeats = new Set();
    this.armedPass = null;    // the server's armed pass row while we count down
    this.remote = null;       // RemoteLog for the pass being ridden
    this.passNo = 0;
    this._sentTicks = 0;
    this._countShown = null;

    this.timers = [];
    this.tweens = [];
    this.phase = 'intro';
    this.clock = new THREE.Clock();
    this.time = 0;            // real seconds
    this.simTime = 0;         // slow-mo-scaled seconds, what the sim rides on
    this.timeScale = 1;
    this.slowUntil = 0;
    this.hypeSmoothed = 0;

    /* live input, one object, never reallocated */
    this.input = {
      aimX: 0, aimY: 0, leanX: 0, leanY: 0,
      couch: false, guard: false, spur: false, fling: false,
    };
    this.keys = Object.create(null);

    this._buildWorld();
    this._buildCamera();
    this._buildRiders();
    this._buildInput();
    this._buildUI();

    this.match = new Match({ passes: this.opts.passes, toUnhorsing: this.opts.unhorse });
    this.hud.sync(this.match, null);
    this._syncNames();

    addEventListener('keydown', (e) => this._key(e));
    addEventListener('keyup', (e) => this._keyUp(e));
    addEventListener('blur', () => { this.keys = Object.create(null); this._readKeys(); });

    this.renderer.renderer.setAnimationLoop(() => this._frame());
    window.game = this;
  }

  /* ---------------- who is who ---------------- */

  get theirSeat() { return 1 - this.mySeat; }
  get isOnline() { return !!(this.net && this.net.connected); }
  /**
   * Is the pass being ridden an online one? Not the same question as
   * `isOnline`: one failed fetch drops `connected` for a moment, and a pass
   * that started against the other seat must not fall back to a CPU that was
   * never built half way down the lane.
   */
  get livePass() { return !!(this.net && this.remote); }
  /** What we are carrying into the pass, and what the server freezes. */
  _drunk() { return this.opts.bar ? this.bar.drunk : 0; }

  /* ---------------- world ---------------- */

  _buildWorld() {
    const lists = buildLists();
    this.lists = lists;
    this.scene.add(lists.group);

    this.lightBase = {
      hemi: lists.lights.hemi.intensity,
      rims: lists.lights.rims.map((r) => r.intensity),
    };
    this.rimBoost = 1;

    this._makeCrowd(this.opts.crowd);
  }

  _makeCrowd(n) {
    this.crowd?.dispose?.();
    this.crowd = new Crowd(this.scene, crowdSeats(n), { focus: new THREE.Vector3(0, 1.5, 0) });
  }

  _buildRiders() {
    this.mySpec = loadSpec() ?? defaultSpec('YOU');
    this.riders = [null, null];
    this._makeRider(0);
    this._makeRider(1);

    this.maker = new Maker(this.scene, {
      podium: new THREE.Vector3(0, 0, 4),
      onDone: (spec) => this._finishMaker(spec),
    });
  }

  /**
   * My seat wears my puppet and my mask; theirs wears the other seat's
   * presence spec online (it carries the mask they bought) and the CPU
   * knight otherwise.
   */
  _makeRider(seat) {
    this.riders[seat]?.dispose?.();
    const knight = KNIGHTS[this._cpuKey()];
    let spec, mask;
    if (seat === this.mySeat) { spec = this.mySpec; mask = this.store.worn; }
    else if (this.isOnline && this.theirSpec) { spec = this.theirSpec; mask = this.theirSpec.mask ?? 'none'; }
    else { spec = knight.spec; mask = knight.mask; }
    this.riders[seat] = new Rider(this.scene, seat, spec, { colour: ACCENT[seat], mask });
  }

  _cpuKey() {
    return KNIGHTS[this.opts.opponent] ? this.opts.opponent : 'cpu-knight';
  }

  _opponentName() {
    if (this.isOnline) {
      const them = this.net.seats?.find((s) => s.seat === this.theirSeat);
      return (them?.name || 'THE OTHER SEAT').toUpperCase();
    }
    return KNIGHTS[this._cpuKey()].name;
  }

  /** The scoreboard is by seat index, so seat 0's name goes on the left. */
  _syncNames() {
    const mine = this.mySpec?.name || 'YOU';
    const theirs = this._opponentName();
    this.hud.setNames(this.mySeat === 0 ? mine : theirs, this.mySeat === 0 ? theirs : mine);
  }

  _openMaker() {
    this.phase = 'maker';
    this.hud.els.intro.classList.add('gone');
    this.maker.show(true);
    for (const r of this.riders) if (r?.group) r.group.visible = false;
    this._cine(
      new THREE.Vector3(2.1, 1.7, 6.0), new THREE.Vector3(0, 1.1, 4), 40, 3.2, 9e5,
    );
  }

  _finishMaker(spec) {
    this.mySpec = spec;
    this.maker.show(false);
    this._makeRider(this.mySeat);
    for (const r of this.riders) if (r?.group) r.group.visible = true;
    this._syncNames();
    this.phase = 'intro';
    this.hud.els.intro.classList.remove('gone');
    this._rideCam(true);
  }

  /* ---------------- camera ---------------- */

  _buildCamera() {
    this.rig = {
      pos: new THREE.Vector3(1.6, 3.4, 30),
      look: new THREE.Vector3(0, 1.4, 0),
      fov: RIDE_FOV,
      tPos: new THREE.Vector3(1.6, 3.4, 30),
      tLook: new THREE.Vector3(0, 1.4, 0),
      tFov: RIDE_FOV,
      rate: 5,
      roll: 0,
    };
    /**
     * Cinematics get an expiry, not a restore timer — exactly the darts trick.
     * A lapsed cinematic falls back to the chase cam every frame, so no path
     * can leave the camera parked on the crowd.
     */
    this.cam = { mode: 'chase', hold: 0 };
    this.camera.position.copy(this.rig.pos);
    this.camera.lookAt(this.rig.look);

    this.orbit = new OrbitControls(this.camera, this.renderer.renderer.domElement);
    this.orbit.target.set(0, 1.5, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxPolarAngle = Math.PI * 0.52;
    this.orbit.minDistance = 1.2;
    this.orbit.maxDistance = 48;
    this.orbit.enabled = false;
    this.freeCam = false;
  }

  _setCam(pos, look, fov, rate = 5) {
    this.rig.tPos.copy(pos);
    this.rig.tLook.copy(look);
    this.rig.tFov = fov;
    this.rig.rate = rate;
  }

  _cine(pos, look, fov, rate, dur) {
    if (this.freeCam) return;
    this._setCam(pos, look, fov, rate);
    this.cam.mode = 'cine';
    this.cam.hold = this.time + dur;
  }

  _rideCam(snap = false) {
    this.cam.mode = 'chase';
    this.cam.hold = 0;
    if (snap) { this._applyChaseCam(); this.rig.pos.copy(this.rig.tPos); this.rig.look.copy(this.rig.tLook); }
  }

  /**
   * Over seat 0's right shoulder, re-derived every frame: back 3.4 m, up 1.9 m,
   * right 0.7 m in the seat's own frame, looking 6 m ahead at chest height.
   * Mouse aim nudges the look point so the view leads the lance.
   */
  _applyChaseCam() {
    const s = SEAT[this.mySeat];
    const r = this.sim?.riders?.[this.mySeat];
    const z = r?.horse?.z ?? s.startZ;
    const x = r?.horse?.x ?? s.laneX;
    const y = (r?.horse?.bobY ?? 0);

    const fx = s.forward[0], fz = s.forward[2];
    const rx = s.right[0], rz = s.right[2];

    _pos.set(
      x - fx * 3.4 + rx * 0.7,
      1.9 + y * 0.6,
      z - fz * 3.4 + rz * 0.7,
    );
    _look.set(x + fx * 6, 1.4, z + fz * 6);

    // aim nudges the look direction by up to 0.35 rad either way
    const ay = this.input.aimX * 0.35, ap = this.input.aimY * 0.35;
    _off.set(_look.x - _pos.x, 0, _look.z - _pos.z);
    const len = _off.length() || 1;
    const ca = Math.cos(ay), sa = Math.sin(ay);
    _look.x = _pos.x + (_off.x * ca - _off.z * sa);
    _look.z = _pos.z + (_off.x * sa + _off.z * ca);
    _look.y += Math.tan(ap) * len;

    // a skinful moves the whole view, so the world slides under the reticle
    const d = this.opts.bar ? this.bar.sway : 0;
    if (d > 0) {
      const t = this.time;
      _look.x += Math.sin(t * 0.63) * d * 0.5 + Math.sin(t * 1.7) * d * 0.16;
      _look.y += Math.cos(t * 0.48) * d * 0.3;
      _pos.x += Math.sin(t * 0.55) * d * 0.09;
      _pos.y += Math.sin(t * 0.79) * d * 0.05;
      this.rig.roll = Math.sin(t * 0.41) * d * 0.13;
    } else {
      this.rig.roll *= 0.9;
    }

    // the torso rolls the camera a touch, so leaning feels like leaning
    if (r?.torso) this.rig.roll += r.torso.roll * 0.25;

    this._setCam(_pos, _look, RIDE_FOV, 7);
  }

  /** Side-on at the crossing, for the slow-mo. */
  _impactCam(point, dur = 1.5) {
    const p = point || { x: 0, y: 1.6, z: 0 };
    this._cine(
      new THREE.Vector3(-4.5, 1.9, (p.z ?? 0) + 0.6),
      new THREE.Vector3(p.x ?? 0, p.y ?? 1.6, p.z ?? 0),
      38, 6.5, dur,
    );
  }

  _crowdCam(dur = 1.9) {
    const b = ROYAL_BOX ?? { x: 6, y: 3, z: 0 };
    this._cine(
      new THREE.Vector3((b.x ?? 6) * 0.45, 2.6, (b.z ?? 0) + 5.5),
      new THREE.Vector3(b.x ?? 6, (b.y ?? 3) - 0.6, b.z ?? 0),
      50, 2.4, dur,
    );
  }

  _overCam() {
    this._cine(
      new THREE.Vector3(7.5, 5.2, 9.5), new THREE.Vector3(0, 1.4, 0), 46, 1.6, 9e5,
    );
  }

  /* ---------------- input ---------------- */

  _buildInput() {
    const dom = this.renderer.renderer.domElement;
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    addEventListener('mousemove', (e) => {
      const s = this.opts.sens;
      this.input.aimX = clamp(((e.clientX / innerWidth) * 2 - 1) * s, -1, 1);
      this.input.aimY = clamp((1 - (e.clientY / innerHeight) * 2) * s, -1, 1);
      this._mouse = this._mouse || { x: 0, y: 0 };
      this._mouse.x = e.clientX; this._mouse.y = e.clientY;
    }, { passive: true });

    addEventListener('mousedown', (e) => {
      if (this.phase === 'intro' || this.phase === 'maker' || this.freeCam) return;
      if (e.button === 0) this.input.couch = true;
      if (e.button === 2) { e.preventDefault(); this.input.guard = true; }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.input.couch = false;
      if (e.button === 2) this.input.guard = false;
    });
  }

  _readKeys() {
    const k = this.keys;
    this.input.leanY = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    this.input.leanX = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    this.input.spur = !!k.Space;
  }

  _key(e) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'Tab') { e.preventDefault(); this._togglePanel(); return; }
    if (e.code === 'Space') e.preventDefault();

    this.keys[e.code] = true;
    this._readKeys();

    const n = +e.key;
    if (n >= 1 && n <= STYLE_KEYS.length) { this._setStyle(STYLE_KEYS[n - 1]); return; }
    if (e.code === 'KeyC') this._toggleFreeCam();
    else if (e.code === 'KeyR') this._restart();
    else if (e.code === 'KeyB') this._toggleBar();
    else if (e.code === 'KeyM') this._toggleStore();
    else if (e.code === 'KeyH' && !e.repeat) this._fling = true;   // one tick only
  }

  _keyUp(e) {
    delete this.keys[e.code];
    this._readKeys();
  }

  /* ---------------- UI ---------------- */

  _buildUI() {
    const labels = {};
    for (const k of STYLE_KEYS) labels[k] = STYLES[k].label;
    this.hud.buildStyleButtons(STYLE_KEYS, labels, (k) => this._setStyle(k));
    this._setStyle(STYLE_KEYS.includes('alley') ? 'alley' : STYLE_KEYS[0]);

    $('#btn-start').onclick = () => this._start();
    $('#btn-make').onclick = () => this._openMaker();
    $('#panel-toggle').onclick = () => this._togglePanel();
    $('#btn-restart').onclick = () => this._restart();

    const bind = (id, key, fn) => {
      const el = $(id);
      if (!el) return;
      const read = () => (el.type === 'checkbox' ? el.checked : (isNaN(+el.value) ? el.value : +el.value));
      const apply = () => { this.opts[key] = read(); fn?.(this.opts[key]); };
      el.addEventListener('change', apply);
      if (el.type === 'range') el.addEventListener('input', () => { this.opts[key] = read(); });
    };
    bind('#opt-passes', 'passes', () => this._restart());
    bind('#opt-unhorse', 'unhorse', () => this._restart());
    bind('#opt-opponent', 'opponent', () => this._applyOpponent());
    bind('#opt-crowd', 'crowd', (v) => this._makeCrowd(v));
    bind('#opt-sens', 'sens');
    bind('#opt-sound', 'sound', (v) => { this.audio.enabled = v; });
    bind('#opt-bar', 'bar', (v) => { this.bar.enabled = v; this._refreshBar(); });

    this.hud.buildDrinks(DRINKS, (i) => this._buyDrink(i));
    this.barOpen = true;
    this.storeOpen = false;
    this.hud.buildStore(MASKS, this.store.owned, this.store.worn,
      (k) => this._buyMask(k), (k) => this._wearMask(k));
    this.hud.store(false);
    this._refreshBar();

    setTimeout(() => this.hud.hideLoading(), 260);
  }

  _togglePanel(force) {
    const p = $('#panel');
    const open = force !== undefined ? force : p.classList.contains('collapsed');
    p.classList.toggle('collapsed', !open);
    document.body.classList.toggle('uiopen', open);
  }

  _setStyle(k) {
    this.renderer.setStyle(k);
    this.hud.markStyle(k);
    const s = STYLES[k];
    this.rimBoost = s.lights?.rimBoost ?? 1;
    if (this.lists?.lights?.hemi) {
      this.lists.lights.hemi.intensity = (s.lights?.hemi ?? 1) * this.lightBase.hemi;
    }
  }

  /* ---------------- the bar & the armourer ---------------- */

  _toggleBar() {
    if (!this.opts.bar) return;
    this.barOpen = !this.barOpen;
    this._refreshBar();
  }

  _buyDrink(i) {
    const drink = DRINKS[i];
    if (!drink || !this.opts.bar) return;
    if (this.bar.buy(drink)) {
      this.audio.glug();
      this.hud.toast(drink.name, 'DOWN IT', 'var(--gold)');
      this.crowd.react(0.5, 0.7);
    }
    this._refreshBar();
  }

  _refreshBar() {
    this.hud.bar(this.bar, this.barOpen, this.opts.bar, this.phase !== 'pass');
    this.hud.syncStore(this.store.owned, this.store.worn, this.bar.points);
  }

  _toggleStore() {
    this.storeOpen = !this.storeOpen;
    this.hud.store(this.storeOpen);
    this._refreshBar();
  }

  _buyMask(key) {
    if (this.store.buy(key)) {
      this.audio.click();
      this._wearMask(key);
    }
    this._refreshBar();
  }

  _wearMask(key) {
    if (!this.store.wear(key)) return;
    this.riders[this.mySeat]?.setMask?.(key);
    this.audio.click();
    this.hud.toast(MASKS[key]?.label ?? 'MASK', 'THE ARMOURER APPROVES', 'var(--gold)');
    this._refreshBar();
  }

  /* ---------------- online ---------------- */

  /** The darts word ladder, for the other rider's condition. */
  _theirState() {
    const d = this.theirDrunk ?? 0;
    if (d < 0.05) return 'sober';
    if (d < 0.22) return 'loose';
    if (d < 0.45) return 'merry';
    if (d < 0.70) return 'wobbly';
    if (d < 0.90) return 'gone';
    return 'horizontal';
  }

  _setOpponentSelect(v) {
    this.opts.opponent = v;
    const sel = $('#opt-opponent');
    if (sel) sel.value = v;
    this._applyOpponent();
  }

  _applyOpponent() {
    if (this.opts.opponent === 'online') { this._goOnline(); return; }
    if (this.net || this.live) this._goOffline();
    else { this._makeRider(this.theirSeat); this._syncNames(); }
    this._restart();
  }

  /**
   * Take a seat. The token decides which one, so every "me = rider 0"
   * assumption in the shell reads `mySeat` from here on. The authoritative
   * session (join / ready / trace / poll) and the live tick stream come up
   * together; the stream is spectacle, the session is the verdict.
   */
  async _goOnline() {
    const token = readToken();
    if (!token) {
      this.hud.toast('NO TOKEN', 'OPEN YOUR PLAYER LINK FIRST', 'var(--hot)');
      this._setOpponentSelect('cpu-knight');
      return;
    }
    this.net?.stop();
    this.live?.stop();
    this.net = new JoustSession({
      token,
      onState: (v) => this._onNetState(v),
      onPassArmed: (p) => this._onPassArmed(p),
      onPassResolved: (row, o) => this._onPassResolved(row, o),
      onError: (e) => this._onNetError(e),
    });
    this.hud.toast('CONNECTING', 'FINDING THE OTHER SEAT', 'var(--dim)');

    const r = await this.net.join({ ...this.mySpec, mask: this.store.worn }, { drunk: this._drunk() });
    if (!r) {
      this.net.stop();
      this.net = null;
      this._setOpponentSelect('cpu-knight');
      return;
    }
    this.mySeat = r.seat;
    this.armedPass = null;
    this.remote = null;

    this.live = new LiveLink({
      seat: r.seat,
      onTicks: (p) => this._onLiveTicks(p),
      onPresence: (s) => this._onLivePresence(s),
    });
    this.live.connect();

    this._makeRider(0);
    this._makeRider(1);
    if (this.net.match) this.match.adopt(this.net.match);
    this.hud.sync(this.match, null);
    this._syncNames();
    this.hud.toast('CONNECTED', `YOU ARE ${(r.name || '').toUpperCase()}`, 'var(--green)');
    this._rideCam(true);

    // mid-match switch: ride at once. From the title card, the START button does it.
    if (this.hud.els.intro.classList.contains('gone')) this._restart();
  }

  _goOffline() {
    this.net?.stop();
    this.net = null;
    this.live?.stop();
    this.live = null;
    this.mySeat = 0;
    this.theirSpec = null;
    this.theirDrunk = 0;
    this.armedPass = null;
    this.remote = null;
    this.liveSeats = new Set();
    this.hud.presence(false, null);
    this._makeRider(0);
    this._makeRider(1);
    this._syncNames();
  }

  /* ---------------- online: the session ---------------- */

  _onNetState(v) {
    if (!this.net) return;
    const them = v?.seats?.find((s) => s.seat === this.theirSeat);
    if (them) {
      this.theirDrunk = them.drunk ?? 0;
      const spec = them.spec ?? null;
      if (spec && (spec.name !== this.theirSpec?.name || spec.mask !== this.theirSpec?.mask)) {
        this.theirSpec = spec;
        if (this.phase !== 'pass') this._makeRider(this.theirSeat);
      }
      this.hud.presence(
        !!(them.online || this.liveSeats?.has(this.theirSeat)),
        (them.name || '').toUpperCase(),
        this._theirState(),
      );
    }
    this._syncNames();

    // a pass armed while we were still settling the last one is announced
    // once and only once by the session: pick it up here or sit out the ride
    if (this.phase === 'ready' && !this.armedPass && v?.open) this._onPassArmed(v.open);

    // never yank the match out from under a pass being ridden or judged
    if (v?.match && this.phase !== 'pass' && this.phase !== 'awaiting') {
      this.match.adopt(v.match);
      this.hud.sync(this.match, null);
    }
  }

  /** Both seats are in the saddle: the server picked the seed and the instant. */
  _onPassArmed(pass) {
    if (this.phase !== 'ready' || !pass) return;
    this.armedPass = pass;
    this._countShown = null;
    this.audio.bell();
    this.hud.toast('BOTH IN THE SADDLE', 'THE HERALD RAISES THE CLOTH', 'var(--gold)');
  }

  /**
   * The herald's verdict. The server re-ran both logs, so it wins over the
   * local preview — which can differ when their ticks arrived late.
   */
  _onPassResolved(row, o = {}) {
    if (!this.net || !row) return;
    if (o.replayAll || row.pass_no !== this.passNo) {
      if (this.net.match && this.phase !== 'pass') {
        this.match.adopt(this.net.match);
        this.hud.sync(this.match, null);
      }
      return;
    }
    // the server defaulted our log because we were too slow: stop riding
    if (this.phase === 'pass') {
      if (this.sim) this.sim.done = true;
      this._settle(true);
    }

    const before = [this.match.score[0], this.match.score[1]];
    if (this.net.match) this.match.adopt(this.net.match);
    this.hud.setLast(this.match.score[0] - before[0], this.match.score[1] - before[1]);
    this.hud.sync(this.match, null);
    this._refreshBar();

    const served = row.result?.score;
    const local = this.sim?.result?.()?.score;
    if (served && local && (served[0] !== local[0] || served[1] !== local[1])) {
      const sum = passSummary(row.result);
      this.hud.toast(sum.big, "THE HERALD'S CALL", sum.hype > 0.6 ? 'var(--gold)' : 'var(--ink)');
    }
    this.hud.nameplate(null);
    this._after(1.6, () => {
      if (this.match.finished) this._over(this.match.winner);
      else this._ready();
    });
  }

  _onNetError(e) {
    if (e === 'conflict') return;                 // the poll will sort it out
    this.hud.toast('THE HERALD BALKS', String(e).toUpperCase().replace(/-/g, ' '), 'var(--hot)');
  }

  /* ---------------- online: the live stream ---------------- */

  _onLiveTicks(p) {
    if (!p || p.seat !== this.theirSeat) return;
    if (this.remote && p.pass === this.passNo) this.remote.add(p);
  }

  _onLivePresence(seats) {
    this.liveSeats = seats ?? new Set();
    const them = this.net?.seats?.find((s) => s.seat === this.theirSeat);
    if (!them) return;
    this.hud.presence(
      this.liveSeats.has(this.theirSeat) || them.online,
      (them.name || '').toUpperCase(),
      this._theirState(),
    );
  }

  /**
   * Push our own ticks out in batches. The sim can cross several ticks in one
   * frame while only the first was written, so the holes are held first —
   * exactly what the sim itself did — and the batch is dense by construction.
   */
  _streamTicks(force = false) {
    const sim = this.sim;
    if (!sim || !this.live || !this.livePass) return;
    const log = (sim.logs[this.mySeat] ||= []);
    const upto = sim.tick | 0;
    if (upto <= this._sentTicks) return;
    const dense = denseLog(log, upto);
    for (let i = this._sentTicks; i < upto; i++) log[i] = dense[i];
    if (!force && upto - this._sentTicks < BATCH_TICKS) return;
    this.live.sendTicks(this.passNo, this._sentTicks, log.slice(this._sentTicks, upto));
    this._sentTicks = upto;
  }

  /* ---------------- match flow ---------------- */

  _start() {
    this.audio.init();
    this.audio.resume();
    this.audio.enabled = this.opts.sound;
    this.hud.hideIntro();
    this.hud.els.intro.classList.remove('win');
    this._restart();
  }

  _restart() {
    this.timers.length = 0;
    this.tweens.length = 0;
    this.timeScale = 1;
    this.slowUntil = 0;
    this.armedPass = null;
    this.bar.reset();
    this.hud.setLast(null, null);
    this.hud.els.intro.classList.add('gone');
    if (this.isOnline) { this._restartOnline(); return; }
    this.match = new Match({ passes: this.opts.passes, toUnhorsing: this.opts.unhorse });
    this.hud.sync(this.match, null);
    this._refreshBar();
    this._ready();
  }

  /**
   * Online there is no local match to make: the server owns it. Rejoining is
   * how we ask for a new one, and only once the old one is actually over.
   */
  async _restartOnline() {
    this._refreshBar();
    const r = await this.net.join(
      { ...this.mySpec, mask: this.store.worn },
      { newMatch: this.match.finished, drunk: this._drunk() },
    );
    if (!r) return;
    this.mySeat = r.seat;
    if (this.net.match) this.match.adopt(this.net.match);
    this.hud.sync(this.match, null);
    this._syncNames();
    this._ready();
  }

  /** Riders at the pavilions, trumpet, then go. */
  _ready() {
    this.phase = 'ready';
    this.sim = null;
    this.tick = 0;
    this.evCursor = 0;

    const n = Math.min(this.match.pass + 1, this.match.passes);
    this.hud.nameplate(`PASS ${n} OF ${this.match.passes}`,
      `${this.mySpec?.name || 'YOU'} vs ${this._opponentName()}`);
    this.hud.showCouch(false);
    this.hud.showBalance(false);
    this.hud.showReticle(false);
    this._rideCam(true);

    /**
     * Online the countdown is not ours to run: the pass arms when the other
     * seat is also in the saddle, and `_frame` counts down to the server's
     * own start instant on the shared clock.
     */
    if (this.isOnline) {
      this.armedPass = null;
      this._countShown = null;
      this.hud.toast('IN THE SADDLE', `WAITING FOR ${this._opponentName()}`, 'var(--dim)');
      this.net.ready(this._drunk());
      return;
    }

    let count = 3;
    const beat = () => {
      if (this.phase !== 'ready') return;
      if (count > 0) {
        this.audio.bell();
        this.hud.toast(String(count), count === 3 ? 'TO YOUR MARKS' : '', 'var(--gold)');
        count--;
        this._after(0.75, beat);
      } else {
        this.audio.bell();
        this.hud.toast('RIDE', 'THE HERALD DROPS THE CLOTH', 'var(--gold)');
        this.crowd.react(0.8, 0.8);
        this._beginPass();
      }
    };
    this._after(0.7, beat);
  }

  /**
   * The online 3-2-1, read off the shared clock rather than a local timer.
   *
   * Both browsers start their sim LAG_TICKS after the server's T0, so the
   * first ticks of the other rider have had time to arrive before either
   * horse moves. The server's own lagTicks wins if it sent one.
   */
  _countdown() {
    if (!this.net || !this.armedPass) return;
    const lag = this.net.timing?.lagTicks ?? LAG_TICKS;
    const s = this.net.clock.until(this.armedPass.starts_at) + lag * TICK;
    if (s > 0) {
      const c = Math.ceil(s);
      if (c <= 3 && c >= 1 && c !== this._countShown) {
        this._countShown = c;
        this.audio.bell();
        this.hud.toast(String(c), c === 3 ? 'TO YOUR MARKS' : '', 'var(--gold)');
      }
      return;
    }
    this._countShown = null;
    this.audio.bell();
    this.hud.toast('RIDE', 'THE HERALD DROPS THE CLOTH', 'var(--gold)');
    this.crowd.react(0.8, 0.8);
    this._beginPass();
  }

  _beginPass() {
    this.phase = 'pass';
    this.hud.nameplate(null);
    this.hud.showCouch(true);
    this.hud.showBalance(true);
    this.hud.showReticle(true);

    // online: the seed and both riders' frozen drunk levels come from the
    // armed pass, so the two browsers and the server ride the same pass
    const armed = this.isOnline ? this.armedPass : null;
    const seed = armed ? armed.seed : (newPassSeed ? newPassSeed() : newSeed());
    this.passSeed = seed;
    const mine = { drunk: this._drunk() };
    this.sim = new PassSim({
      seed,
      riders: armed
        ? [{ drunk: armed.riders?.[0]?.drunk ?? 0 }, { drunk: armed.riders?.[1]?.drunk ?? 0 }]
        : (this.mySeat === 0 ? [mine, { drunk: 0 }] : [{ drunk: 0 }, mine]),
    });
    if (armed) {
      this.passNo = armed.pass_no;
      this.remote = new RemoteLog(this.passNo);
      this._sentTicks = 0;
      this.cpu = null;
      this.live?.sendReady(this.passNo);
    } else {
      this.remote = null;
      this.cpu = new Cpu(this._cpuKey(), mulberry32((seed ^ 0x9e3779b9) >>> 0));
    }
    this.evCursor = 0;
    this.impactDone = false;
    this.input.couch = false;
    this.input.guard = false;
    this._fling = false;
    this._rideCam(true);
    this.audio.whoosh();
  }

  /**
   * The pass is over: score it, show it, then set up the next one.
   *
   * Online, everything shown here is a PREVIEW — the local sim rode the other
   * rider off a stream that may have stuttered. The log goes to the server and
   * the phase parks on 'awaiting' until the herald answers.
   * @param {boolean} quiet  the verdict already landed; skip the fanfare
   */
  _settle(quiet = false) {
    if (this.phase === 'settle' || this.phase === 'awaiting' || this.phase === 'over') return;
    const online = this.livePass;
    this.phase = online ? 'awaiting' : 'settle';
    this.timeScale = 1;
    this.hud.showCouch(false);
    this.hud.showReticle(false);
    if (quiet) return;

    const sum = passSummary?.(this.sim) ?? { big: 'PASS', small: '', hype: 0.2 };
    this.hud.toast(sum.big, sum.small, sum.hype > 0.6 ? 'var(--gold)' : 'var(--ink)');
    this.crowd.react(sum.hype ?? 0.2, 0.6);
    if ((sum.hype ?? 0) > 0.7) this.crowd.burstConfetti(160);
    this._crowdCam(1.9);

    if (online) {
      this._streamTicks(true);
      const log = denseLog(this.sim.logs[this.mySeat] ?? [], Math.max(1, this.sim.tick | 0));
      this.live?.sendEnded(this.passNo, log.length);
      this.net.submitTrace(this.passNo, log, this._drunk());
      this.hud.nameplate('THE HERALD CONFERS', `WAITING ON ${this._opponentName()}`);
      return;
    }

    const before = [this.match.score[0], this.match.score[1]];
    const res = this.match.applyPass(this.sim) ?? {};
    this.hud.setLast(this.match.score[0] - before[0], this.match.score[1] - before[1]);
    this.hud.sync(this.match, null);
    this._refreshBar();

    this._after(2.4, () => {
      if (res.finished || this.match.finished) this._over(res.winner ?? this.match.winner);
      else this._ready();
    });
  }

  _over(winner) {
    this.phase = 'over';
    this.hud.showCouch(false);
    this.hud.showBalance(false);
    this.hud.showReticle(false);
    this.hud.nameplate(null);
    this._overCam();
    this.crowd.react(1.4, 1);
    this.crowd.burstConfetti(340);
    this.audio.roar(1);
    const name = winner === this.mySeat ? 'YOU'
      : winner === this.theirSeat ? this._opponentName() : 'NOBODY';
    const me = this.riders[this.mySeat], them = this.riders[this.theirSeat];
    if (me) me.hype = winner === this.mySeat ? 1.5 : -1.2;
    if (them) them.hype = winner === this.theirSeat ? 1.5 : -1.2;
    this.hud.showWin(name, this.match.score, () => this._start(), this.bar);
  }

  _after(sec, fn) { this.timers.push({ t: sec, fn }); }

  /* ---------------- per-tick simulation ---------------- */

  _stepSim(dt) {
    const sim = this.sim;
    if (!sim || sim.done) return;

    // sample this tick's input for both seats, then advance
    const packed = packInput({
      leanX: this.input.leanX, leanY: this.input.leanY,
      aimX: this.input.aimX, aimY: this.input.aimY,
      couch: this.input.couch, guard: this.input.guard,
      spur: this.input.spur, fling: this._fling,
    });
    this._fling = false;

    const t = sim.tick | 0;
    (sim.logs[this.mySeat] ||= [])[t] = packed;
    const theirs = (sim.logs[this.theirSeat] ||= []);
    // online the other rider is driven by their own ticks off the wire, held
    // across any gap; offline by the knight
    theirs[t] = this.remote
      ? this.remote.at(t)
      : (this.cpu ? this.cpu.input(sim, this.theirSeat) : IDLE_INPUT);
    sim.step(dt);
    this._streamTicks(sim.done);

    this._consumeEvents();
    if (sim.done) this._settle();
  }

  _consumeEvents() {
    const evs = this.sim?.events;
    if (!evs) return;
    while (this.evCursor < evs.length) {
      const ev = evs[this.evCursor++];
      this._onEvent(ev);
    }
  }

  _onEvent(ev) {
    if (ev.type === 'pass-end') { this._settle(); return; }

    const r = eventReaction(ev);
    if (r.big) this.hud.toast(r.big, r.small, r.color);
    this.crowd.react(r.hype, 0.55);
    if (r.hype > 0.9) this.crowd.burstConfetti(120, ev.point ? new THREE.Vector3(...ev.point) : null);

    // audio
    switch (ev.type) {
      case 'break': this.audio.clatter(); this.audio.thud(1.2); break;
      case 'unseat': this.audio.thud(1.4); this.audio.clatter(); break;
      case 'helm': case 'helmet-hit': this.audio.wire(); this.audio.thud(1); break;
      case 'hit': this.audio.thud(0.9); break;
      case 'glance': this.audio.wire(); break;
      case 'barrier': this.audio.thud(0.7); break;
      case 'foul': this.audio.clatter(); break;
      case 'helmet-miss': this.audio.whoosh(); break;
      default: break;
    }

    // the bar takes its cut of anything that scored
    if (this.opts.bar && ev.seat === this.mySeat && ev.points > 0) {
      const gained = Math.round(ev.points * this.bar.multiplier);
      this.bar.points += gained;
      this.bar.earned += gained;
      this.hud.points(gained, this.bar.multiplier);
    }

    // gloat / sulk
    if (ev.seat === 0 || ev.seat === 1) {
      const win = this.riders[ev.seat], lose = this.riders[ev.seat ^ 1];
      if (ev.points > 0) {
        if (win) win.hype = Math.min(1.5, (win.hype ?? 0) + r.hype);
        if (lose) lose.hype = Math.max(-1.5, (lose.hype ?? 0) - r.hype * 0.6);
      }
    }

    // first real contact buys the slow-mo cinematic
    const contact = ev.type === 'hit' || ev.type === 'break' || ev.type === 'helm'
      || ev.type === 'unseat' || ev.type === 'helmet-hit' || ev.type === 'barrier';
    if (contact && !this.impactDone) {
      this.impactDone = true;
      this.timeScale = IMPACT.slowmo;
      this.slowUntil = this.time + IMPACT.slowmoDur;
      const p = ev.point;
      this._impactCam(p ? { x: p[0], y: p[1], z: p[2] } : null, IMPACT.slowmoDur + 0.6);
    }
  }

  /* ---------------- free cam ---------------- */

  _toggleFreeCam() {
    this.freeCam = !this.freeCam;
    this.orbit.enabled = this.freeCam;
    document.body.classList.toggle('freecam', this.freeCam);
    if (this.freeCam) {
      this.hud.showReticle(false);
      this.orbit.target.set(0, 1.5, 0);
      this.orbit.object.position.set(9, 5, 12);
      this.orbit.update();
    } else {
      this._rideCam(true);
      this.hud.showReticle(this.phase === 'pass');
    }
  }

  /* ---------------- the frame ---------------- */

  _frame() {
    const real = Math.min(this.clock.getDelta(), 0.05);
    this.time += real;

    if (this.slowUntil && this.time >= this.slowUntil) {
      this.slowUntil = 0;
      this.timeScale = 1;
    }
    const dt = real * this.timeScale;
    this.simTime += dt;

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= real;
      if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); }
    }
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += real;
      const u = Math.min(1, tw.t / tw.dur);
      tw.step(u);
      if (u >= 1) { this.tweens.splice(i, 1); tw.done?.(); }
    }

    this.bar.update(real);
    this.renderer.setDrunk(this.opts.bar ? this.bar.drunk : 0);
    this.audio.drunk = this.opts.bar ? this.bar.drunk : 0;
    this.crowd.setDrunk(this.opts.bar ? this.bar.drunk * 0.8 : 0);
    if ((this._barTick = (this._barTick | 0) + 1) % 8 === 0) this._refreshBar();

    if (this.phase === 'pass') this._stepSim(dt);
    else if (this.phase === 'ready' && this.armedPass) this._countdown();

    // riders
    const rs = this.sim?.riders;
    for (let i = 0; i < 2; i++) {
      const rider = this.riders[i];
      if (!rider) continue;
      rider.update(dt, this.simTime, rs ? rs[i] : null);
      if (rider.hype) rider.hype *= 1 - Math.min(1, real * 1.2);
    }
    this.maker.update(real, this.time);

    // HUD from the live sim
    const me = rs?.[this.mySeat];
    if (me) {
      if (this.phase === 'pass') {
        this.hud.couch(me.lance?.couch ?? 0, me.lance?.fatigue ?? 0);
        this._placeReticle(me);
      }
      this.hud.balance(me.torso?.pitch ?? 0, me.torso?.roll ?? 0, RIDER.fallAngle);
    }

    // crowd + lists
    this.crowd.update(this.simTime, dt);
    const hype = this.crowd.globalHype;
    this.hypeSmoothed += (hype - this.hypeSmoothed) * Math.min(1, real * 4);
    for (const d of this.lists.dyn) d.update(this.simTime, dt, this.hypeSmoothed);
    this.audio.update(real, this.hypeSmoothed);

    const l = this.lists.lights;
    const h = this.hypeSmoothed, boost = this.rimBoost;
    if (l?.rims) {
      l.rims[0].intensity = this.lightBase.rims[0] * boost * (1 + h * 1.9 + Math.sin(this.time * 9) * h * 0.4);
      l.rims[1].intensity = this.lightBase.rims[1] * boost * (1 + h * 1.9 + Math.cos(this.time * 7.4) * h * 0.4);
      l.rims[2].intensity = this.lightBase.rims[2] * boost * (1 + h * 1.6);
    }

    // camera
    if (this.freeCam) {
      this.orbit.update();
    } else {
      if (this.cam.mode === 'cine' && this.time >= this.cam.hold) this.cam.mode = 'chase';
      if (this.cam.mode === 'chase') this._applyChaseCam();

      const r = this.rig;
      const k = 1 - Math.exp(-r.rate * real);
      r.pos.lerp(r.tPos, k);
      r.look.lerp(r.tLook, k);
      r.fov = lerp(r.fov, r.tFov, k);
      const shake = this.hypeSmoothed * 0.02;
      this.camera.position.set(
        r.pos.x + (Math.random() - 0.5) * shake,
        r.pos.y + (Math.random() - 0.5) * shake,
        r.pos.z,
      );
      this.camera.lookAt(r.look);
      if (r.roll) this.camera.rotateZ(r.roll);
      if (Math.abs(this.camera.fov - r.fov) > 0.01) {
        this.camera.fov = r.fov;
        this.camera.updateProjectionMatrix();
      }
    }

    this.renderer.render(real, this.time, this.hypeSmoothed);
  }

  /** Project the lance tip to the screen so the reticle is literally the tip. */
  _placeReticle(me) {
    const tip = me.lance?.tipWorld;
    if (!tip) { this.hud.showReticle(false); return; }
    _tip.set(tip.x ?? tip[0] ?? 0, tip.y ?? tip[1] ?? 0, tip.z ?? tip[2] ?? 0);
    _tip.project(this.camera);
    if (_tip.z > 1) { this.hud.showReticle(false); return; }
    this.hud.showReticle(true);
    const x = (_tip.x * 0.5 + 0.5) * innerWidth - 32;
    const y = (-_tip.y * 0.5 + 0.5) * innerHeight - 32;
    const couch = me.lance?.couch ?? 0;
    this.hud.reticle(x, y,
      me.lance?.broken ? 'dead' : couch >= 0.999 ? 'locked' : couch > 0 ? 'charging' : '');
  }
}

addEventListener('resize', () => window.game?.renderer?.resize?.());

new Game();

export { Game, LANE_HALF, TICK };

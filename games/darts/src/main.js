import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { Renderer, STYLES, STYLE_KEYS } from './core/render.js';
import { Audio } from './core/audio.js';
import { buildArena, crowdSeats } from './world/arena.js';
import { buildDartboard, buildBoardLight, BOARD_HEIGHT, OCHE_DIST, scoreAt } from './world/dartboard.js';
import { Crowd } from './world/crowd.js';
import { Dart, buildDartMesh } from './game/dart.js';
import { solveAim, ballisticVelocity } from './game/physics.js';
import { ThrowControl, offSweet, SWEET_MID } from './game/throwcontrol.js';
import { Match, AI_LEVELS, aiAim } from './game/match.js';
import { Hud, dartReaction, visitReaction } from './game/hud.js';
import { Bar, DRINKS } from './game/bar.js';
import { Walk } from './game/walk.js';
import { OnlineSession, readToken } from './net/online.js';
import { LiveLink, SeenSeeds } from './net/live.js';
import { launchMessage, readLaunch } from './game/replay.js';
import { newSeed } from './game/rng.js';
import { Cast, CHARACTERS, opponentSpec } from './game/cast.js';
import { Maker, loadSpec } from './game/maker.js';
import { RELEASE_AT, defaultSpec } from './world/puppet.js';

const $ = (s) => document.querySelector(s);
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const ACCENT = ['#ff3d2e', '#2fb6ff'];
/** Wide enough that the wall crowd sits in the corners of the aiming view. */
const THROW_FOV = 46;

const _look = new THREE.Vector3();
const _pos = new THREE.Vector3();

/* ================================================================== */

class Game {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(THROW_FOV, innerWidth / innerHeight, 0.05, 60);
    this.scene.add(this.camera);

    this.renderer = new Renderer($('#stage'), this.scene, this.camera);
    this.audio = new Audio();
    this.hud = new Hud();

    this.opts = {
      start: 501, doubleOut: true, opponent: 'ai-shark',
      crowd: 132, sens: 1, assist: 0.35, sound: true, boardCam: true, bar: true,
    };

    this.bar = new Bar();

    this.world = {
      stuck: [], planeZ: 0,
      stageH: 0.17, stageZ0: 1.55, stageZ1: 4.3,
    };

    this.timers = [];
    this.tweens = [];
    this.phase = 'intro';
    this.clock = new THREE.Clock();
    this.time = 0;
    this.hypeSmoothed = 0;

    this._buildWorld();
    this._buildCamera();
    this._buildCast();
    this._buildHeldDart();
    this._buildControls();
    this._buildUI();

    this.match = new Match({ start: this.opts.start, doubleOut: this.opts.doubleOut });
    this._applyOpponent();
    this.hud.sync(this.match);

    this.activeDarts = [];
    this.dartPool = [];
    this._liveSeeds = new SeenSeeds();
    this._ghostData = null;

    addEventListener('keydown', (e) => this._key(e));
    addEventListener('keyup', (e) => this._keyUp(e));
    addEventListener('blur', () => this._endWalk());
    addEventListener('mousemove', (e) => {
      if (this.walk.active) this.walk.look(e.movementX || 0, e.movementY || 0);
    }, { passive: true });
    this.renderer.renderer.setAnimationLoop(() => this._frame());
    window.game = this;   // handy from the console
  }

  /* -------------------------------------------------------------- */

  _buildWorld() {
    const arena = buildArena();
    this.arena = arena;
    this.scene.add(arena.group);
    this.world.stageH = arena.stageH;

    // baselines the style picker and the hype response scale against
    this.lightBase = {
      hemi: arena.lights.hemi.intensity,
      rims: arena.lights.rims.map((r) => r.intensity),
    };
    this.rimBoost = 1;

    this.board = buildDartboard();
    this.scene.add(this.board);
    this.boardLight = buildBoardLight();
    this.scene.add(this.boardLight);

    this._makeCrowd(this.opts.crowd);
  }

  _buildCast() {
    this.cast = new Cast(this.scene, this.board.position);
    this.mySpec = loadSpec() ?? defaultSpec('YOU');
    this.cast.set(0, this.mySpec);

    this.maker = new Maker(this.scene, {
      podium: new THREE.Vector3(0, this.arena.stageH, 3.45),
      onDone: (spec) => this._finishMaker(spec),
    });
  }

  _openMaker() {
    this.phase = 'maker';
    this.hud.els.intro.classList.add('gone');
    this.maker.show(true);
    this.cast.setVisible(0, false);
    this.cast.setVisible(1, false);
    // framed so the puppet sits left of the controls panel, full height
    this._cine(
      new THREE.Vector3(-0.52, 1.16, 0.12),
      new THREE.Vector3(-0.52, 1.02, 3.45),
      42, 3.2, 1e6,
    );
    document.body.classList.add('makermode');
  }

  _finishMaker(spec) {
    this.mySpec = spec;
    this.cast.set(0, spec);
    this.maker.show(false);
    document.body.classList.remove('makermode');
    this.hud.setNames(spec.name || 'YOU', this._opponentName());
    this.phase = 'intro';
    this.hud.els.intro.classList.remove('gone');
    this._throwCam();
  }

  _opponentName() {
    if (this.isOnline) {
      const them = this.net.seats?.find((s) => s.seat === this.theirSeat);
      return (them?.name || 'THE OTHER ONE').toUpperCase();
    }
    return this.ai ? CHARACTERS[this.ai].name : (this.cast.get(1)?.spec.name ?? 'PLAYER TWO');
  }

  /* ---------------- seats ---------------- */

  /** Which seat the local player is. Always 0 offline; the server decides online. */
  get mySeat() { return this.net?.seat ?? 0; }
  get theirSeat() { return 1 - this.mySeat; }
  get isOnline() { return !!(this.net && this.net.connected); }
  /** True when the local player may pick up a dart. */
  _myTurn() { return this.match.current === this.mySeat; }
  /** True when the seat throwing right now is driven by something other than this mouse. */
  _remoteTurn() {
    if (this.isOnline) return !this._myTurn();
    return !!this.ai && this.match.current === 1;
  }

  _makeCrowd(n) {
    this.crowd?.dispose();
    this.crowd = new Crowd(this.scene, crowdSeats(n), {
      focus: new THREE.Vector3(0, 1.2, 2.2),
    });
  }

  _buildCamera() {
    this.walk = new Walk(this.arena, OCHE_DIST);

    this.rig = {
      pos: this.walk.eye.clone(),
      look: new THREE.Vector3(0, BOARD_HEIGHT, 0),
      fov: THROW_FOV,
      tPos: this.walk.eye.clone(),
      tLook: new THREE.Vector3(0, BOARD_HEIGHT, 0),
      tFov: THROW_FOV,
      rate: 5,
      roll: 0,
    };
    /**
     * Cinematics get an expiry, not a restore timer. A timer can be cleared,
     * outlive its context, or fire after a later cinematic has started — which
     * is how the camera used to end up parked on the crowd. With an expiry the
     * throwing camera is simply re-asserted every frame once the hold lapses,
     * so every path self-heals.
     */
    this.cam = { mode: 'throw', hold: 0 };
    this.camera.position.copy(this.rig.pos);
    this.camera.lookAt(this.rig.look);

    this.orbit = new OrbitControls(this.camera, this.renderer.renderer.domElement);
    this.orbit.target.set(0, 1.5, 1.2);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxPolarAngle = Math.PI * 0.52;
    this.orbit.minDistance = 0.8;
    this.orbit.maxDistance = 12;
    this.orbit.enabled = false;
    this.freeCam = false;
  }

  _setCam(pos, look, fov, rate = 5) {
    this.rig.tPos.copy(pos);
    this.rig.tLook.copy(look);
    this.rig.tFov = fov;
    this.rig.rate = rate;
  }

  /** Hold a cinematic for `dur` seconds, then fall back to the throwing camera. */
  _cine(pos, look, fov, rate, dur) {
    if (this.freeCam) return;
    this._setCam(pos, look, fov, rate);
    this.cam.mode = 'cine';
    this.cam.hold = this.time + dur;
  }

  /** Whichever view is the resting state right now. */
  _baseCamMode() {
    return (this.match && this._remoteTurn()) ? 'opponent' : 'throw';
  }

  /** Cut straight back to whatever the resting view is. */
  _throwCam() {
    this.cam.mode = this._baseCamMode();
    this.cam.hold = 0;
  }

  /**
   * Broadcast angle on whoever is at the oche. Anchored to the thrower with a
   * fixed offset over their right shoulder — the far side from the waiting
   * spot, so it can't clip the other player or the pit crowd.
   */
  _applyOpponentCam() {
    const m = this.cast.members[this.theirSeat];
    const p = m ? m.pos : new THREE.Vector3(0.16, this.arena.stageH, OCHE_DIST + 0.22);
    // while their aim is streaming in (or their dart is airborne off the live
    // echo), a side-on broadcast angle keeps thrower AND board in frame — the
    // shoulder angle faces away from the board and would hide the aim ghost
    if (this._liveFresh() || (this.flying && this.flying.remote)) {
      _pos.set(2.95, 1.72, OCHE_DIST * 0.62);
      _look.set(p.x * 0.35, 1.5, OCHE_DIST * 0.52);
      this._setCam(_pos, _look, 44, 3.2);
      return;
    }
    // front quarter, between thrower and board: you see the face and the arm
    // come through, and the dart flies past camera on its way out
    _pos.set(p.x + 1.8, p.y + 1.42, p.z - 2.3);
    _look.set(p.x, p.y + 0.8, p.z);
    this._setCam(_pos, _look, 50, 4);
  }

  /** Re-derived every frame while in throw mode — stance, aim, and the wobbles. */
  _applyThrowCam() {
    const aim = this.control?.state === 'aim' ? this.control.target : this.control?.frozenTarget;
    _look.set(0, BOARD_HEIGHT, 0);
    if (aim && aim.lengthSq() > 0) _look.lerp(aim, 0.4);

    // a skinful moves the whole view, so the reticle stays put and the world
    // slides under it — visible, and therefore something you can time
    const d = this.bar.sway;
    if (d > 0) {
      const t = this.time;
      _look.x += Math.sin(t * 0.63) * d * 0.16 + Math.sin(t * 1.7) * d * 0.05;
      _look.y += Math.cos(t * 0.48) * d * 0.11 + Math.cos(t * 2.1) * d * 0.035;
      this.rig.roll = Math.sin(t * 0.41) * d * 0.13;
    } else {
      this.rig.roll *= 0.9;
    }

    _pos.copy(this.walk.eye);
    if (d > 0) {
      _pos.x += Math.sin(this.time * 0.55) * d * 0.045;
      _pos.y += Math.sin(this.time * 0.79) * d * 0.03;
    }
    this._setCam(_pos, _look, THROW_FOV, 6);
  }

  _buildHeldDart() {
    this.held = new THREE.Group();
    const dart = buildDartMesh(ACCENT[0]);
    this.heldDartMesh = dart;
    this.held.add(dart);

    // a small green hand pinching the barrel — kept low and small so it frames
    // the throw without eating the board
    const hand = new THREE.Group();
    const furMat = new THREE.MeshStandardMaterial({ color: '#6cc95c', roughness: 1 });
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 10), furMat);
    palm.scale.set(1, 0.78, 1.15);
    palm.position.set(0.026, -0.03, -0.082);
    hand.add(palm);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0082, 0.03, 3, 6), furMat);
      f.position.set(0.008 - i * 0.0015, -0.004, -0.048 - i * 0.017);
      f.rotation.set(0.24, 0, -1.2);
      hand.add(f);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0092, 0.026, 3, 6), furMat);
    thumb.position.set(-0.006, -0.012, -0.062);
    thumb.rotation.set(-0.3, 0, 1.25);
    hand.add(thumb);
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 0.14, 10), furMat);
    wrist.position.set(0.055, -0.058, -0.152);
    wrist.rotation.set(1.05, 0, -0.6);
    hand.add(wrist);
    this.held.add(hand);
    this.handGroup = hand;

    this.held.position.set(0.155, -0.145, -0.50);
    this.held.rotation.set(0.05, -0.26, 0.10);
    this.camera.add(this.held);
    this.heldBase = this.held.position.clone();
  }

  _setHeldAccent(i) {
    this.held.remove(this.heldDartMesh);
    this.heldDartMesh.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    this.heldDartMesh = buildDartMesh(ACCENT[i]);
    this.held.add(this.heldDartMesh);
  }

  _buildControls() {
    this.control = new ThrowControl(this.renderer.renderer.domElement, this.camera, {
      onThrow: (ev) => this._playerThrow(ev),
      onAim: (p, mouse) => {
        this.hud.reticle(mouse.x, mouse.y,
          this.control.state === 'wind' ? 'charging'
            : this.control.state === 'flick' ? 'locked' : '');
      },
      onCharge: (v, mode) => this.hud.power(v, mode),
    });
    this.control.boardY = BOARD_HEIGHT;
    this.control.setBoardPlane(0);
  }

  _buildUI() {
    const labels = {};
    for (const k of STYLE_KEYS) labels[k] = STYLES[k].label;
    this.hud.buildStyleButtons(STYLE_KEYS, labels, (k) => this._setStyle(k));
    this._setStyle('alley');

    $('#btn-start').onclick = () => this._start();
    $('#btn-make').onclick = () => this._openMaker();
    $('#panel-toggle').onclick = () => this._togglePanel();
    $('#btn-restart').onclick = () => this._restart();

    // `onRelease` for anything expensive — the crowd slider tears down and
    // rebuilds ~130 puppets, which must not run on every pixel of a drag
    const bind = (id, key, fn, onRelease = false) => {
      const el = $(id);
      const read = () => (el.type === 'checkbox' ? el.checked : (isNaN(+el.value) ? el.value : +el.value));
      const apply = () => { this.opts[key] = read(); fn?.(this.opts[key]); };
      if (!onRelease) el.addEventListener('input', apply);
      el.addEventListener('change', apply);
    };
    bind('#opt-start', 'start', () => this._restart());
    bind('#opt-doubleout', 'doubleOut', () => this._restart());
    bind('#opt-opponent', 'opponent', () => { this._applyOpponent(); this._restart(); });
    bind('#opt-crowd', 'crowd', (v) => this._makeCrowd(v), true);
    bind('#opt-sens', 'sens', (v) => { this.control.sens = v; });
    bind('#opt-assist', 'assist', (v) => { this.control.assist = v; });
    bind('#opt-sound', 'sound', (v) => { this.audio.enabled = v; });
    bind('#opt-boardcam', 'boardCam');
    bind('#opt-bar', 'bar', () => { this.bar.enabled = this.opts.bar; this._refreshBar(); });

    this._buildBar();

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
    // multipliers off the arena's own baselines — never hard-coded intensities,
    // or the frame loop and the style picker end up fighting each other
    this.rimBoost = s.lights?.rimBoost ?? 1;
    this.arena.lights.hemi.intensity = (s.lights?.hemi ?? 1) * this.lightBase.hemi;
  }

  /* ---------------- online ---------------- */

  _theirState() {
    const d = this.theirDrunk ?? 0;
    if (d < 0.05) return 'sober';
    if (d < 0.22) return 'loose';
    if (d < 0.45) return 'merry';
    if (d < 0.70) return 'wobbly';
    if (d < 0.90) return 'gone';
    return 'horizontal';
  }

  async _goOnline() {
    const token = readToken();
    if (!token) {
      this.hud.toast('NO TOKEN', 'OPEN YOUR PLAYER LINK FIRST', 'var(--hot)');
      this._setOpponentSelect('ai-shark');
      return;
    }
    this.net = new OnlineSession({
      token,
      onState: (s) => this._onNetState(s),
      onThrow: (t, o) => this._onNetThrow(t, o),
      onError: (e) => this._onNetError(e),
    });
    this.hud.toast('CONNECTING', 'FINDING THE OTHER ONE', 'var(--dim)');
    const r = await this.net.join(this.mySpec);
    if (!r) { this.net = null; this._setOpponentSelect('ai-shark'); return; }

    this.ai = null;
    this.cast.stanceSeat = r.seat;
    this.cast.set(r.seat, this.mySpec);
    this.hud.toast('CONNECTED', `YOU ARE ${r.name}`, 'var(--green)');
    this._syncNames();

    // the live layer: aim stream + instant launch echo over a broadcast
    // channel; the poll stays underneath as the authoritative safety net
    this.live?.stop();
    this.live = new LiveLink({
      seat: r.seat,
      onAim: (p) => this._onLiveAim(p),
      onLaunch: (p) => this._onLiveLaunch(p),
      onPresence: (s) => this._onLivePresence(s),
    });
    this.live.connect();
  }

  _goOffline() {
    this.net?.stop();
    this.net = null;
    this.live?.stop();
    this.live = null;
    this._ghostData = null;
    this.theirDrunk = 0;
    this.cast.stanceSeat = 0;
    this.cast.set(0, this.mySpec);
  }

  _setOpponentSelect(v) {
    this.opts.opponent = v;
    const el = $('#opt-opponent');
    if (el) el.value = v;
    this._applyOpponent();
  }

  _syncNames() {
    const seats = this.net?.seats ?? [];
    const mine = seats.find((s) => s.seat === this.mySeat);
    const theirs = seats.find((s) => s.seat === this.theirSeat);
    this.hud.setNames(
      (mine?.name || this.mySpec.name || 'YOU').toUpperCase(),
      (theirs?.name || 'WAITING…').toUpperCase(),
      { swap: this.mySeat === 1 },
    );
  }

  /** Server state arrived: adopt it, and rebuild if we are behind. */
  _onNetState({ match, seats, replayAll }) {
    if (!match) return;
    const them = seats?.find((s) => s.seat === this.theirSeat);
    if (them) {
      this.theirDrunk = them.drunk ?? 0;
      if (them.spec && them.spec.name !== this.cast.get(this.theirSeat)?.spec.name) {
        this.cast.set(this.theirSeat, them.spec);
      }
      this.hud.presence(them.online, (them.name || '').toUpperCase(), this._theirState());
    }
    this._syncNames();

    const turnWas = this.match.current;
    // never yank state out from under a dart that is still resolving — with
    // the live echo, remote darts can be airborne well before the poll lands
    const mine = this.flying && !this.flying.remote;
    if (mine || this.phase === 'flight') return;
    this.match.adopt(match);
    this.hud.sync(this.match);
    if (replayAll || this.match.current !== turnWas) this._beginVisit();
  }

  _onNetThrow(t) {
    if (t.seat === this.mySeat) return;      // already flew locally
    // the live echo may have flown this dart seconds ago
    if (!this._liveSeeds.fresh(t.launch?.seed)) return;
    this._remoteThrow(t.seat, t.launch);
  }

  _onNetError(e) {
    if (e === 'not-your-turn' || e === 'conflict') return;   // the poll will fix it
    this.hud.toast('OFFLINE', String(e).toUpperCase().replace(/-/g, ' '), 'var(--hot)');
  }

  /* ---------------- live layer ---------------- */

  _onLiveAim(p) {
    if (!this.isOnline || p.seat !== this.theirSeat) return;
    this._ghostData = { x: p.x, y: p.y, k: p.k ?? 0, t: this.time };
  }

  _onLiveLaunch(p) {
    if (!this.isOnline || p.seat !== this.theirSeat || this.phase === 'over') return;
    if (!this._liveSeeds.fresh(p.launch?.seed)) return;
    this._ghostData = null;
    this._remoteThrow(p.seat, p.launch);
  }

  _onLivePresence(seats) {
    this.liveSeats = seats;
    const them = this.net?.seats?.find((s) => s.seat === this.theirSeat);
    if (them) {
      this.hud.presence(
        seats.has(this.theirSeat) || them.online,
        (them.name || '').toUpperCase(),
        this._theirState(),
      );
    }
  }

  /** Their aim is on screen only while packets keep arriving. */
  _liveFresh() { return !!this._ghostData && this.time - this._ghostData.t < 1.2; }

  /** The other player's reticle: a ring on the board in their accent. */
  _ensureGhost() {
    if (this.ghost) return this.ghost;
    const g = new THREE.Group();
    this.ghostMat = new THREE.MeshBasicMaterial({
      color: ACCENT[this.theirSeat], transparent: true, opacity: 0.8,
      side: THREE.DoubleSide, depthWrite: false,
    });
    g.add(new THREE.Mesh(new THREE.RingGeometry(0.022, 0.032, 26), this.ghostMat));
    g.add(new THREE.Mesh(new THREE.CircleGeometry(0.006, 12), this.ghostMat));
    g.position.set(0, BOARD_HEIGHT, 0.012);
    g.visible = false;
    this.scene.add(g);
    this.ghost = g;
    return g;
  }

  _applyOpponent() {
    const o = this.opts.opponent;
    if (o === 'online') { this._goOnline(); return; }
    if (this.net) this._goOffline();
    this.ai = o === 'hotseat' ? null : o;
    this.cast.set(1, opponentSpec(this.ai));
    this.hud.setNames((this.mySpec?.name || 'YOU').toUpperCase(), this._opponentName());
  }

  /* -------------------------------------------------------------- */

  _start() {
    this.audio.init();
    this.audio.resume();
    this.audio.enabled = this.opts.sound;
    this.hud.hideIntro();
    this.maker.show(false);
    document.body.classList.remove('makermode');
    this.phase = 'aim';
    this.crowd.react(0.4, 0.9);
    this.audio.roar(0.45);
    this._refreshBar();
    this._beginVisit();
  }

  _restart() {
    if (this.isOnline) {
      // the leg belongs to both of you; ask the server for a new one
      this.net.join(this.mySpec, { newLeg: true });
      return;
    }
    this.timers.length = 0;
    this.tweens.length = 0;
    this._clearDarts(true);
    this.match = new Match({ start: this.opts.start, doubleOut: this.opts.doubleOut });
    this.bar.reset();
    this.walk.reset();
    this._endWalk();
    this._throwCam();
    this.hud.sync(this.match);
    this._refreshBar();

    // changing settings before the match has begun shouldn't skip the intro
    if (this.phase === 'intro') return;

    this.hud.els.intro.classList.remove('win');
    this.hud.els.intro.classList.add('gone');
    this.phase = 'aim';
    this._beginVisit();
  }

  _beginVisit() {
    const p = this.match.current;
    this._setHeldAccent(p);
    this.cast.setActive(p);
    this.hud.sync(this.match);

    if (this._remoteTurn()) {
      this.phase = 'ai';
      this._throwCam();
      const them = this.theirSeat;
      this.hud.nameplate(
        this._opponentName(),
        this.isOnline
          ? `${this.match.score[them]} left · ${this._theirState()}`
          : `avg ${(this.match.average(them) ?? 0).toFixed(1)} · ${this.match.score[them]}`,
      );
      this._syncThrowAvailability();
      // online, their dart arrives over the wire; offline the CPU throws it
      if (!this.isOnline) this._after(1.35, () => this._aiThrow());
    } else {
      this.phase = 'aim';
      this._throwCam();
      this.hud.nameplate(null);
      this._syncThrowAvailability();
      this._refreshBar();
    }
  }

  _after(sec, fn) { this.timers.push({ t: sec, fn }); }

  /* -------------------------------------------------------------- */

  _handPos() {
    const v = new THREE.Vector3(0, 0, 0);
    this.held.localToWorld(v);
    return v;
  }

  _spawnDart(accent) {
    let d = this.dartPool.find((x) => x.free && x.accent === accent);
    if (!d) {
      d = new Dart(this.scene, accent);
      d.free = false;
      this.dartPool.push(d);
    }
    d.free = false;
    this.activeDarts.push(d);
    return d;
  }

  _playerThrow(ev) {
    if (this.phase !== 'aim' || this.walk.active) return;
    if (!this.walk.legal) { this.hud.foul(true); this.audio.click(); return; }
    this.phase = 'flight';
    this.held.visible = false;
    this.hud.showReticle(false);
    this.hud.foul(false);

    const off = offSweet(ev.power01);
    const straightErr = 1 - ev.straight;

    // player error model: bad power = scatter, crooked flick = pull
    // sensitivity already shapes the power curve, so it must not double-dip here
    const sigma = 0.024 * (0.30 + off * 2.7 + straightErr * 1.1)
      * (1 - this.opts.assist * 0.55)
      * (1 + this.bar.sway * 2.4);        // the drink adds scatter on top of the visible sway

    const target = ev.target.clone();
    target.x += gauss() * sigma + ev.lateralPx * 0.00020;
    target.y += gauss() * sigma * 1.15 + (ev.power01 - SWEET_MID) * 0.075;

    const speed = lerp(4.3, 11.2, ev.power01);   // below ~4.9 it cannot reach the board
    const from = this._handPos();
    let vel = solveAim(from, target, speed);
    if (!vel) {
      // not enough on it — it drops out of the sky
      vel = new THREE.Vector3(target.x - from.x, 0, target.z - from.z).normalize()
        .multiplyScalar(speed * 0.94);
      vel.y = speed * 0.28;
    }

    // the wire message *is* the launch: same numbers here, on their screen,
    // and on the server that scores it
    const msg = launchMessage({
      from, vel, seed: newSeed(),
      wobble: 0.02 + off * 0.16 + straightErr * 0.13 + this.bar.sway * 0.22,
      roll: -ev.lateralPx * 0.05 + (Math.random() - 0.5) * 6,
      magnus: -ev.lateralPx * 0.0004,
    });
    // echo first — their screen starts the flight before our POST round-trips
    this.live?.sendLaunch(msg);
    this._launchLocal(this.match.current, msg);
    if (this.isOnline) this.net.submit(msg, this.bar.drunk);
  }

  /**
   * Fly a dart from a wire message. Identical path for every source.
   * `remote` darts are a replay of something that already happened on the
   * other machine — they are pure spectacle, and must not touch the local
   * Match, because the server's state (which already counts them) is what
   * polling adopts. Scoring them here too double-counts every dart.
   */
  _launchLocal(seat, msg, remote = false) {
    const { from, vel, opts } = readLaunch(msg);
    const dart = this._spawnDart(ACCENT[seat]);
    dart.remote = remote;
    dart.launch(from, vel, opts);
    this.flying = dart;
    this.audio.whoosh();
    this.crowd.react(0.06, 0.2);
    return dart;
  }

  /** A dart thrown on the other machine: animate their puppet, then fly it. */
  _remoteThrow(seat, msg) {
    if (this.phase === 'over') return;
    this.phase = 'flight';
    const puppet = this.cast.get(seat);
    const delay = puppet ? puppet.startThrow(0.9) : 0;
    this._after(delay, () => this._launchLocal(seat, msg, true));
  }

  _aiThrow() {
    const puppet = this.cast.get(1);
    this.phase = 'flight';
    // play the animation first; the dart leaves the hand at the release frame
    const delay = puppet ? puppet.startThrow(0.9) : 0;
    this._after(delay, () => this._aiRelease());
  }

  _aiRelease() {
    const aim = aiAim(this.match, this.ai);
    const target = new THREE.Vector3(aim.x, BOARD_HEIGHT + aim.y, 0);
    const puppet = this.cast.get(1);
    const from = puppet
      ? puppet.handWorld(new THREE.Vector3())
      : new THREE.Vector3(0.16, 1.5, OCHE_DIST + 0.1);

    const speed = 7.6 + Math.random() * 1.1;
    let vel = solveAim(from, target, speed) ?? ballisticVelocity(from, target, speed + 2.5);
    if (!vel) {
      // hand ended up somewhere the ballistic solve can't cover; nudge and retry
      vel = ballisticVelocity(from, target, speed + 4) ?? new THREE.Vector3(0, 1, -speed);
    }

    this._launchLocal(1, launchMessage({
      from, vel, seed: newSeed(), wobble: 0.03 + Math.random() * 0.04,
    }));
  }

  /* -------------------------------------------------------------- */

  _onDartEvent(dart, ev) {
    // non-terminal noise
    if (ev.type === 'bounceout') {
      if (ev.wire) this.audio.wire(); else this.audio.thud(0.6);
      return;
    }
    if (ev.type === 'clatter') { this.audio.clatter(); return; }

    // terminal
    this.flying = null;
    let res = null;
    if (ev.type === 'stick' && ev.surface === 'board') {
      const lx = ev.point.x, ly = ev.point.y - BOARD_HEIGHT;
      res = scoreAt(lx, ly);
      this.audio.thud(clamp(ev.speed / 9, 0.4, 1.2));
      this._flashBoard(res.value);
    } else if (ev.type === 'robin') {
      res = null;
      this.audio.wire();
    } else if (ev.type === 'stick') {
      this.audio.thud(0.5);
    } else if (ev.type === 'floor' || ev.type === 'lost') {
      this.audio.clatter();
    }

    const r = dartReaction(res, ev);
    // the thrower is pleased with themselves; the other one is not
    const thrower = this.match.current;
    this.cast.react(thrower, r.hype);
    this.cast.react(1 - thrower, -r.hype * 0.45);
    this.crowd.react(r.hype, r.hype > 0.6 ? 0.28 : 0.5);
    this.audio.roar(r.hype);
    this.hud.toast(r.big, r.small, r.color);

    if (dart.remote) {
      // spectating: the server already scored this, so just react and wait for
      // the next poll to bring the authoritative state
      if (this.opts.boardCam && !this.freeCam) this._boardCam(ev.point, 1.35);
      this.phase = 'settle';
      this._after(Math.abs(r.hype) > 0.6 ? 1.25 : 0.9, () => {
        if (this.phase === 'settle') this.phase = this._remoteTurn() ? 'ai' : 'aim';
        this._syncThrowAvailability();
      });
      return;
    }

    const outcome = this.match.applyDart(res && res.value > 0 ? res : null);
    this.hud.sync(this.match);

    // only the human drinks, so only the human earns
    if (this.opts.bar && outcome.player === this.mySeat && res && res.value > 0) {
      const gained = this.bar.scoreDart(res.value);
      this.hud.points(gained, this.bar.multiplier);
      this._refreshBar();
    }

    const spectating = outcome.player !== this.mySeat;
    if (this.opts.boardCam && !this.freeCam
        && (Math.abs(r.hype) > 0.5 || outcome.win || spectating)) {
      // you're not at the oche for their darts, so always show you the result
      this._boardCam(ev.point, spectating ? 1.35 : 1.15);
    }

    this.phase = 'settle';
    const pause = outcome.win ? 1.5 : (Math.abs(r.hype) > 0.6 ? 1.25 : 0.85);
    this._after(pause, () => this._afterDart(outcome));
  }

  _afterDart(outcome) {
    if (outcome.win) return this._win(outcome.player);

    if (outcome.visitOver) {
      const total = outcome.bust ? 0 : outcome.total;
      const vr = visitReaction(total, outcome.bust);
      this.hud.toast(vr.big, vr.small, vr.color);
      this.cast.react(outcome.player, vr.hype);
      this.crowd.react(vr.hype, 0.35);
      this.audio.roar(vr.hype);
      if (vr.hype > 1.2) this.audio.bell();
      this._crowdCam(1.75);
      this._after(1.9, () => {
        this._clearDarts();
        this.match.endVisit();
        this.hud.sync(this.match);
        this._beginVisit();
      });
    } else {
      this._throwCam();
      this.phase = this._remoteTurn() ? 'ai' : 'aim';
      this._syncThrowAvailability();
      this._refreshBar();
      if (this.phase === 'ai' && !this.isOnline) {
        this._after(0.55 + Math.random() * 0.5, () => this._aiThrow());
      }
    }
  }

  _win(p) {
    this.phase = 'over';
    this._endWalk();
    this._syncThrowAvailability();
    this.cast.react(p, 1.7);
    this.cast.react(1 - p, -0.9);
    this.crowd.react(1.7, 0.2);
    this.crowd.burstConfetti(700);
    this.audio.roar(1.6);
    this.audio.bell();
    this._crowdCam(999);
    const name = p === this.mySeat ? 'YOU' : this._opponentName();
    this._after(3.4, () => {
      this.hud.showWin(name, this.match.average(p), () => this._restart(),
        this.opts.bar ? this.bar : null);
    });
  }

  _flashBoard(v) {
    this.boardLight.intensity = 1.2 + v / 30;
    this.tweens.push({
      t: 0, dur: 0.5,
      step: (u) => { this.boardLight.intensity = (1.2 + v / 30) * (1 - u); },
    });
  }

  _boardCam(point, dur = 1.15) {
    const p = point;
    const look = new THREE.Vector3(p.x * 0.55, BOARD_HEIGHT + (p.y - BOARD_HEIGHT) * 0.55, 0);
    this._cine(new THREE.Vector3(p.x * 0.5, look.y + 0.04, 0.78), look, 26, 3.6, dur);
  }

  _crowdCam(dur = 1.8) {
    const s = Math.random() < 0.5 ? -1 : 1;
    this._cine(
      new THREE.Vector3(s * 0.9, 2.2, 3.5),
      new THREE.Vector3(s * 3.9, 1.35, 1.1),
      52, 2.4, dur,
    );
  }

  _clearDarts(instant = false) {
    for (const d of this.activeDarts) {
      if (instant) { d.hide(); d.free = true; continue; }
      const start = d.mesh.position.clone();
      const end = start.clone().add(new THREE.Vector3(0.15, -0.25, 1.6));
      this.tweens.push({
        t: 0, dur: 0.42,
        step: (u) => { d.mesh.position.lerpVectors(start, end, u * u); d.mesh.scale.setScalar(1 - u * 0.9); },
        done: () => { d.hide(); d.mesh.scale.setScalar(1); d.free = true; },
      });
    }
    this.activeDarts = [];
    this.world.stuck.length = 0;
  }

  /* -------------------------------------------------------------- */

  _key(e) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'Tab') { e.preventDefault(); this._togglePanel(); return; }

    if (e.key === 'Shift') { this._beginWalk(); return; }
    if (this.walk.active) { this.walk.key(e.code, true); return; }

    const n = +e.key;
    if (n >= 1 && n <= STYLE_KEYS.length) { this._setStyle(STYLE_KEYS[n - 1]); return; }
    if (e.code === 'KeyC') this._toggleFreeCam();
    if (e.code === 'KeyR') this._restart();
    if (e.code === 'KeyB') this._toggleBar();
    if (e.key === ' ') {
      e.preventDefault();
      if (this.phase !== 'over') { this._throwCam(); this.walk.faceBoard(this.board.position); }
    }
  }

  _keyUp(e) {
    if (e.key === 'Shift') { this._endWalk(); return; }
    this.walk.key(e.code, false);
  }

  /* ---------------- walking ---------------- */

  _beginWalk() {
    if (this.walk.active || this.freeCam || this.phase === 'intro' || this.phase === 'over') return;
    this.walk.begin();
    // aiming and throwing are off the table until both feet are behind the line
    this.control.enabled = false;
    this.hud.showReticle(false);
    this.hud.power(0, 'off');
    this.held.visible = false;
    this._throwCam();                       // cancel any cinematic
    document.body.classList.add('walking');
    this.hud.walk(true, this.walk.legal);
  }

  _endWalk() {
    if (!this.walk.active) return;
    this.walk.end();
    document.body.classList.remove('walking');
    this.hud.walk(false, this.walk.legal);
    this.walk.faceBoard(this.board.position);
    this._syncThrowAvailability();
  }

  /**
   * In the first-person throwing view you *are* the active puppet, so hide it;
   * everyone else stays on stage. Any other view shows the full cast.
   */
  _syncCastVisibility() {
    const firstPerson = !this.freeCam && (this.cam.mode === 'throw' || this.walk.active);
    for (let i = 0; i < 2; i++) {
      this.cast.setVisible(i, this.phase === 'maker' ? false
        : !(firstPerson && i === this.match.current));
    }
  }

  /** Throwing is allowed only when it's your turn and you're behind the oche. */
  _syncThrowAvailability() {
    const yours = this.phase === 'aim' && !this._remoteTurn();
    const allowed = yours && !this.walk.active && !this.freeCam && this.walk.legal;
    this.control.enabled = allowed;
    this.held.visible = allowed;
    this.hud.showReticle(allowed);
    if (allowed) this.control.rearm();
    this.hud.foul(yours && !this.walk.legal && !this.walk.active);
  }

  /* ---------------- the bar ---------------- */

  _buildBar() {
    this.hud.buildDrinks(DRINKS, (i) => this._buyDrink(i));
    this.barOpen = true;
    this._refreshBar();
  }

  _toggleBar() {
    if (!this.opts.bar) return;
    this.barOpen = !this.barOpen;
    this._refreshBar();
  }

  _buyDrink(i) {
    const drink = DRINKS[i];
    if (!drink || !this.opts.bar) return;
    if (this.phase !== 'aim' || this.walk.active) return;
    if (!this.bar.buy(drink)) { this.audio.click(); return; }
    this.audio.glug();
    this.hud.toast(drink.name, 'ANOTHER ROUND', 'var(--gold)');
    this.crowd.react(0.75 + drink.kick, 0.3);
    this.audio.roar(0.7 + drink.kick);
    this._refreshBar();
  }

  _refreshBar() {
    this.hud.bar(this.bar, this.barOpen && this.opts.bar, this.opts.bar, this.phase === 'aim');
  }

  _toggleFreeCam() {
    this._endWalk();
    this.freeCam = !this.freeCam;
    this.orbit.enabled = this.freeCam;
    document.body.classList.toggle('freecam', this.freeCam);
    if (this.freeCam) {
      this.control.enabled = false;
      this.held.visible = false;
      this.hud.showReticle(false);
      this.orbit.target.set(0, 1.5, 0.9);
      this.orbit.object.position.set(2.6, 2.1, 3.4);
      this.orbit.update();
    } else {
      this._throwCam();
      this._syncThrowAvailability();
    }
  }

  /* -------------------------------------------------------------- */

  _frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); }
    }
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      const u = Math.min(1, tw.t / tw.dur);
      tw.step(u);
      if (u >= 1) { this.tweens.splice(i, 1); tw.done?.(); }
    }

    this.bar.update(dt);
    this.renderer.setDrunk(this.opts.bar ? this.bar.drunk : 0);
    this.audio.drunk = this.opts.bar ? this.bar.drunk : 0;

    this.walk.update(dt);
    if (this.walk.active) this.hud.walk(true, this.walk.legal);
    // the sobriety meter ticks down live; no need to touch the DOM every frame
    if ((this._barTick = (this._barTick | 0) + 1) % 6 === 0) this._refreshBar();
    if (this.net) this.net.drunk = this.bar.drunk;

    this.control.update(dt);

    // stream my aim to the other seat while I line up
    if (this.live?.up && this.isOnline && this.phase === 'aim'
        && this._myTurn() && this.control.enabled) {
      const c = this.control;
      const aim = c.state === 'aim' ? c.target : c.frozenTarget;
      const pull = c.state === 'wind' || c.state === 'flick' ? clamp(c.pull / 210, 0, 1) : 0;
      const meter = c.state === 'meter' ? c._meterValue() : 0;
      this.live.sendAim({
        x: +aim.x.toFixed(3), y: +aim.y.toFixed(3),
        k: +Math.max(pull, meter).toFixed(2),
      });
    }

    // their reticle ghost, alive only while packets arrive
    if (this.ghost || this._liveFresh()) {
      const g = this._ensureGhost();
      const live = this._liveFresh() && this._remoteTurn() && !this.flying;
      g.visible = live;
      if (live) {
        const d = this._ghostData;
        g.position.x = lerp(g.position.x, d.x, 0.25);
        g.position.y = lerp(g.position.y, d.y, 0.25);
        g.scale.setScalar(1 + d.k * 0.75 + Math.sin(this.time * 6) * 0.05 * (1 - d.k));
        this.ghostMat.opacity = 0.45 + d.k * 0.5;
      }
    }

    // held dart follows the wind-up
    if (this.held.visible) {
      const st = this.control.state;
      const pull = st === 'wind' || st === 'flick' ? clamp(this.control.pull / 210, 0, 1) : 0;
      const meter = st === 'meter' ? this.control._meterValue() : 0;
      const k = Math.max(pull, meter);
      this.heldTarget = k;
      this.held.position.set(
        this.heldBase.x + k * 0.035,
        this.heldBase.y - k * 0.055 + Math.sin(this.time * 1.4) * 0.0022,
        this.heldBase.z + k * 0.085 + Math.sin(this.time * 0.9) * 0.0018,
      );
      this.held.rotation.set(0.06 - k * 0.30, -0.30 + k * 0.06, 0.10 + k * 0.12);
    }

    // darts
    for (const d of this.activeDarts) {
      const ev = d.update(dt, this.world);
      if (ev) this._onDartEvent(d, ev);
    }

    // cast
    this.cast.followStance(this.walk.pos);
    this.cast.lookAt(this.flying ? this.flying.pos : this.board.position);
    this.cast.update(dt, this.time);
    this.cast.members.forEach((m) => {
      if (m) m.puppet.drunk = m.seat === this.mySeat ? this.bar.drunk : (this.theirDrunk ?? 0);
    });
    this._syncCastVisibility();
    this.maker.update(dt, this.time);

    // crowd + arena
    this.crowd.update(this.time, dt);
    const hype = this.crowd.globalHype;
    this.hypeSmoothed += (hype - this.hypeSmoothed) * Math.min(1, dt * 4);
    for (const d of this.arena.dyn) d.update(this.time, dt, this.hypeSmoothed);
    this.audio.update(dt, this.hypeSmoothed);

    // lights react to the room
    const l = this.arena.lights;
    const h = this.hypeSmoothed, boost = this.rimBoost;
    const flickerA = Math.sin(this.time * 9) * h * 0.4;
    const flickerB = Math.cos(this.time * 7.4) * h * 0.4;
    l.rims[0].intensity = this.lightBase.rims[0] * boost * (1 + h * 1.9 + flickerA);
    l.rims[1].intensity = this.lightBase.rims[1] * boost * (1 + h * 1.9 + flickerB);
    l.rims[2].intensity = this.lightBase.rims[2] * boost * (1 + h * 1.6);

    // camera
    if (this.freeCam) {
      this.orbit.update();
    } else {
      // a lapsed cinematic always falls back to the throwing view
      if (this.cam.mode === 'cine' && this.time >= this.cam.hold) this.cam.mode = this._baseCamMode();

      if (this.walk.active) {
        this._setCam(this.walk.eye, this.walk.lookAt, THROW_FOV, 22);
        this.rig.roll *= 0.85;
      } else if (this.cam.mode === 'throw') {
        this._applyThrowCam();
      } else if (this.cam.mode === 'opponent') {
        this._applyOpponentCam();
        this.rig.roll *= 0.85;
      }

      const r = this.rig;
      const k = 1 - Math.exp(-r.rate * dt);
      r.pos.lerp(r.tPos, k);
      r.look.lerp(r.tLook, k);
      r.fov = lerp(r.fov, r.tFov, k);
      const shake = this.hypeSmoothed * 0.007;
      this.camera.position.set(
        r.pos.x + Math.sin(this.time * 1.7) * 0.004 + (Math.random() - 0.5) * shake,
        r.pos.y + Math.sin(this.time * 2.3) * 0.003 + (Math.random() - 0.5) * shake,
        r.pos.z,
      );
      this.camera.lookAt(r.look);
      if (r.roll) this.camera.rotateZ(r.roll);
      if (Math.abs(this.camera.fov - r.fov) > 0.01) {
        this.camera.fov = r.fov;
        this.camera.updateProjectionMatrix();
      }
    }

    this.renderer.render(dt, this.time, this.hypeSmoothed);
  }
}

new Game();

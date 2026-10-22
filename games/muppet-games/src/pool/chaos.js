import * as THREE from 'three';
import { TABLE, makeBall } from './physics.js';
import { buildJunkMesh, buildPuddle } from './table.js';

/**
 * The crowd's contribution to the game.
 *
 * Anything that changes the table — a bottle landing on the cloth, a puddle of
 * sick — goes through the sim as a real body, so the physics does not need to
 * know it is a joke. Anything purely visual (spray, staggering, noise) stays
 * here. Every roll comes off the seeded RNG so that an online rematch replays
 * the same disgrace.
 */

const JUNK = [
  { kind: 'bottle', r: 0.036, m: 0.42, weight: 3, say: 'A BOTTLE. ON THE TABLE.' },
  { kind: 'pint', r: 0.044, m: 0.50, weight: 2, say: 'THAT WAS A FULL PINT' },
  { kind: 'chicken', r: 0.050, m: 0.14, weight: 2, say: 'WHOSE CHICKEN IS THIS' },
  { kind: 'shoe', r: 0.048, m: 0.34, weight: 1, say: 'SOMEBODY IS MISSING A SHOE' },
  { kind: 'ashtray', r: 0.056, m: 0.62, weight: 1, say: 'NOT THE ASHTRAY' },
];

const HECKLE = [
  'MISS IT', 'YOUR BRIDGE IS A DISGRACE', 'I HAVE SEEN BETTER FROM A DOG',
  'PLAY THE SAFETY, COWARD', 'THAT CUE IS BENT AND SO ARE YOU',
  'GERALD SAYS HIT IT HARDER', 'DOUBLE OR NOTHING', 'CHALK IT, YOU ANIMAL',
];

const SICK = [
  'OH NO', 'IT HAS HAPPENED', 'SOMEONE FETCH THE MOP', 'THAT IS ON THE FELT',
];

export class Chaos {
  constructor(opts) {
    this.scene = opts.scene;
    this.sim = opts.sim;
    this.crowd = opts.crowd;
    this.audio = opts.audio;
    this.onEvent = opts.onEvent ?? (() => {});
    this.rng = opts.rng ?? Math.random;
    this.level = 1;                  // 0 off · 1 normal · 2 riot
    this.drunk = 0;                  // 0..1, rises across the match
    this.enabled = true;

    this.flying = [];                // junk mid-air
    this.onCloth = [];               // { ball, mesh, kind, shotsLeft }
    this.puddles = [];               // { p, mesh, shotsLeft, born }
    this.sprays = [];
    this.pending = [];          // delayed effects, ticked on game time
    this.cooldown = 6;
    this.shotActive = false;

    this._buildSpray();
  }

  setLevel(n) { this.level = n; }

  /** 0 at the first break, 1 by the end of a long match. */
  setDrunk(v) {
    this.drunk = Math.max(0, Math.min(1, v));
    this.crowd?.setDrunk(this.drunk * 1.15);
  }

  _buildSpray() {
    const N = 260;
    this.sprayN = N;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) pos[i * 3 + 1] = -50;
    this.sprayVel = new Float32Array(N * 3);
    this.sprayLife = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.spray = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.035, vertexColors: true, transparent: true, opacity: 0.9,
      depthWrite: false, sizeAttenuation: true,
    }));
    this.spray.frustumCulled = false;
    this.scene.add(this.spray);
    this.sprayHead = 0;
  }

  /* ---------------- choosing a culprit ---------------- */

  /** A drunk muppet near the table, ideally one whose hand we can find. */
  _culprit() {
    if (!this.crowd || !this.crowd.m.length) return null;
    const pool = this.crowd.m.filter((m) => m.handW
      && Math.abs(m.home.x) < TABLE.halfLen + 2.2
      && Math.abs(m.home.z) < TABLE.halfWid + 2.2);
    const list = pool.length ? pool : this.crowd.m;
    // the least sober and the most unhinged are the likeliest
    let best = null, bestScore = -1;
    for (let i = 0; i < 7; i++) {
      const m = list[(this.rng() * list.length) | 0];
      const score = m.crazy * (1.2 - m.sober) * (0.4 + this.rng());
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
  }

  _handOf(m) {
    const p = new THREE.Vector3();
    if (m.handW) p.copy(m.handW);
    else p.set(m.home.x, m.home.y + 1.0 * m.scale, m.home.z);
    if (p.y < 0.4) p.y = m.home.y + 1.0 * m.scale;
    return p;
  }

  /* ---------------- the acts ---------------- */

  /** Lob something onto the cloth. Lands as a real obstacle. */
  throwJunk(aimAt = null) {
    const m = this._culprit();
    if (!m) return;
    let pick = JUNK[0], total = JUNK.reduce((s, j) => s + j.weight, 0);
    let roll = this.rng() * total;
    for (const j of JUNK) { roll -= j.weight; if (roll <= 0) { pick = j; break; } }

    const from = this._handOf(m);
    const target = aimAt ?? new THREE.Vector3(
      (this.rng() - 0.5) * TABLE.halfLen * 1.5,
      TABLE.height,
      (this.rng() - 0.5) * TABLE.halfWid * 1.4,
    );

    // a lazy, drunken arc — about a second of hang time
    const flight = 0.75 + this.rng() * 0.45;
    const vel = new THREE.Vector3(
      (target.x - from.x) / flight,
      (target.y - from.y) / flight + 0.5 * 9.8 * flight,
      (target.z - from.z) / flight,
    );

    const mesh = buildJunkMesh(pick.kind);
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.flying.push({
      mesh, vel, spec: pick,
      spin: new THREE.Vector3((this.rng() - 0.5) * 14, (this.rng() - 0.5) * 10, (this.rng() - 0.5) * 14),
    });

    m.pending += 1.2;
    m.delay = 0;
    this.crowd?.react(0.35, 0.5);
    this.audio?.whoosh?.();
    this.onEvent({ type: 'throw', kind: pick.kind, say: pick.say });
  }

  /** The other thing drunks do. Leaves a slick the balls have to cross. */
  vomit() {
    const m = this._culprit();
    if (!m) return;
    const head = new THREE.Vector3(m.home.x, m.home.y + 1.15 * m.scale, m.home.z);
    // aim at the nearest bit of table
    const tx = Math.max(-TABLE.halfLen * 0.9, Math.min(TABLE.halfLen * 0.9, m.home.x * 0.5));
    const tz = Math.max(-TABLE.halfWid * 0.9, Math.min(TABLE.halfWid * 0.9, m.home.z * 0.5));
    const target = new THREE.Vector3(tx, TABLE.height, tz);

    this._spray(head, target);
    m.pending += 1.6;
    m.delay = 0;
    this.crowd?.react(0.5, 0.7);
    this.audio?.clatter?.();
    this.onEvent({ type: 'vomit', say: SICK[(this.rng() * SICK.length) | 0] });

    // the puddle appears a beat after the spray leaves — on game time, not wall
    // time, so it cannot land while the game is paused or a tab is asleep
    this.pending.push({ t: 0.32, fn: () => this._puddle(tx, tz) });
  }

  _puddle(x, z) {
    const r = 0.10 + this.rng() * 0.07;
    const p = this.sim.addPuddle(x, z, r, 0.7 + this.rng() * 0.3);
    const mesh = buildPuddle(r * 1.35);
    mesh.position.set(x, TABLE.height + 0.0025, z);
    this.scene.add(mesh);
    this.puddles.push({ p, mesh, shotsLeft: 3 });
    this.audio?.thud?.(0.4);
  }

  /** Pure noise: no physical effect, plenty of psychological one. */
  heckle() {
    this.crowd?.react(0.25 + this.rng() * 0.3, 0.6);
    this.audio?.roar?.(0.3);
    this.onEvent({ type: 'heckle', say: HECKLE[(this.rng() * HECKLE.length) | 0] });
  }

  /** Someone leans on the rail hard enough to move the balls. */
  slam() {
    const k = 0.10 + this.rng() * 0.12;
    for (const b of this.sim.live()) {
      if (b.junk) continue;
      b.vx += (this.rng() - 0.5) * k;
      b.vz += (this.rng() - 0.5) * k;
      b.asleep = false;
    }
    this.crowd?.react(0.5, 0.3);
    this.audio?.thud?.(1);
    this.onEvent({ type: 'slam', say: 'SOMEBODY FELL ON THE TABLE' });
  }

  /* ---------------- landing junk ---------------- */

  _land(f) {
    const mesh = f.mesh;
    const onTable = Math.abs(mesh.position.x) < TABLE.halfLen - f.spec.r
      && Math.abs(mesh.position.z) < TABLE.halfWid - f.spec.r;

    if (!onTable) {
      // bounced off the rail and onto the floor: smash and vanish
      this.audio?.clatter?.();
      this._smash(mesh.position);
      this.scene.remove(mesh);
      return;
    }

    const ball = this.sim.add(makeBall(-1, mesh.position.x, mesh.position.z, {
      junk: true, r: f.spec.r, m: f.spec.m, kind: f.spec.kind,
    }));
    // it keeps the horizontal speed it arrived with, so it skids a bit
    ball.vx = f.vel.x * 0.35;
    ball.vz = f.vel.z * 0.35;
    ball.asleep = false;
    mesh.position.set(ball.x, TABLE.height, ball.z);
    this.onCloth.push({ ball, mesh, kind: f.spec.kind, shotsLeft: 2 });
    this.audio?.thud?.(0.8);
    this.crowd?.react(0.7, 0.25);
  }

  _smash(pos) {
    const c = new THREE.Color('#8fbf6a');
    const p = this.spray.geometry.attributes.position.array;
    const col = this.spray.geometry.attributes.color.array;
    for (let k = 0; k < 30; k++) {
      const i = this.sprayHead = (this.sprayHead + 1) % this.sprayN;
      p[i * 3] = pos.x; p[i * 3 + 1] = pos.y; p[i * 3 + 2] = pos.z;
      this.sprayVel[i * 3] = (this.rng() - 0.5) * 3;
      this.sprayVel[i * 3 + 1] = this.rng() * 2.4;
      this.sprayVel[i * 3 + 2] = (this.rng() - 0.5) * 3;
      this.sprayLife[i] = 0.9 + this.rng();
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    this.spray.geometry.attributes.position.needsUpdate = true;
    this.spray.geometry.attributes.color.needsUpdate = true;
  }

  _spray(from, to) {
    const c = new THREE.Color('#b9b246');
    const p = this.spray.geometry.attributes.position.array;
    const col = this.spray.geometry.attributes.color.array;
    const flight = 0.5;
    for (let k = 0; k < 70; k++) {
      const i = this.sprayHead = (this.sprayHead + 1) % this.sprayN;
      p[i * 3] = from.x; p[i * 3 + 1] = from.y; p[i * 3 + 2] = from.z;
      this.sprayVel[i * 3] = (to.x - from.x) / flight + (this.rng() - 0.5) * 1.1;
      this.sprayVel[i * 3 + 1] = (to.y - from.y) / flight + 0.5 * 9.8 * flight + (this.rng() - 0.5) * 0.8;
      this.sprayVel[i * 3 + 2] = (to.z - from.z) / flight + (this.rng() - 0.5) * 1.1;
      this.sprayLife[i] = 0.5 + this.rng() * 0.5;
      const j = 0.8 + this.rng() * 0.4;
      col[i * 3] = c.r * j; col[i * 3 + 1] = c.g * j; col[i * 3 + 2] = c.b * 0.7;
    }
    this.spray.geometry.attributes.position.needsUpdate = true;
    this.spray.geometry.attributes.color.needsUpdate = true;
  }

  /* ---------------- housekeeping ---------------- */

  beginShot() { this.shotActive = true; }

  /** Called when the table stops: age out the mess. */
  endShot() {
    this.shotActive = false;

    for (let i = this.onCloth.length - 1; i >= 0; i--) {
      const j = this.onCloth[i];
      if (!j.ball.live) {                 // knocked in a pocket or off the table
        this.scene.remove(j.mesh);
        this.sim.removeBall(j.ball);
        this.onCloth.splice(i, 1);
        continue;
      }
      if (--j.shotsLeft <= 0) {
        this.onEvent({ type: 'cleared', say: 'THE LANDLORD CLEARS THE TABLE' });
        this.scene.remove(j.mesh);
        this.sim.removeBall(j.ball);
        this.onCloth.splice(i, 1);
      }
    }

    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const q = this.puddles[i];
      if (--q.shotsLeft <= 0) {
        this.sim.clearPuddle(q.p);
        this.scene.remove(q.mesh);
        q.mesh.geometry.dispose();
        q.mesh.material.map?.dispose();
        q.mesh.material.dispose();
        this.puddles.splice(i, 1);
      } else {
        q.mesh.material.opacity = 0.35 + 0.65 * (q.shotsLeft / 3);
      }
    }
  }

  clearAll() {
    for (const j of this.onCloth) { this.scene.remove(j.mesh); this.sim.removeBall(j.ball); }
    this.onCloth.length = 0;
    for (const q of this.puddles) { this.sim.clearPuddle(q.p); this.scene.remove(q.mesh); }
    this.puddles.length = 0;
    for (const f of this.flying) this.scene.remove(f.mesh);
    this.flying.length = 0;
    this.pending.length = 0;
  }

  /* ---------------- per frame ---------------- */

  /**
   * @param {object} ctx  { aiming, rolling, phase } — interference is funniest
   *                      while the balls are moving, and cruellest at address.
   */
  update(dt, t, ctx = {}) {
    /* delayed effects */
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) { this.pending.splice(i, 1); p.fn(); }
    }

    /* flying junk */
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.vel.y -= 9.8 * dt;
      f.mesh.position.addScaledVector(f.vel, dt);
      f.mesh.rotation.x += f.spin.x * dt;
      f.mesh.rotation.y += f.spin.y * dt;
      f.mesh.rotation.z += f.spin.z * dt;
      if (f.mesh.position.y <= TABLE.height && f.vel.y < 0) {
        this.flying.splice(i, 1);
        this._land(f);
      } else if (f.mesh.position.y < -0.5) {
        this.scene.remove(f.mesh);
        this.flying.splice(i, 1);
      }
    }

    /* junk resting on the cloth follows its body in the sim */
    for (const j of this.onCloth) {
      const b = j.ball;
      j.mesh.position.set(b.x, TABLE.height + b.y, b.z);
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 0.02) j.mesh.rotation.y += sp * dt * 3;
    }

    /* spray */
    let liveSpray = false;
    const p = this.spray.geometry.attributes.position.array;
    for (let i = 0; i < this.sprayN; i++) {
      if (this.sprayLife[i] <= 0) continue;
      liveSpray = true;
      this.sprayLife[i] -= dt;
      this.sprayVel[i * 3 + 1] -= 9.8 * dt;
      p[i * 3] += this.sprayVel[i * 3] * dt;
      p[i * 3 + 1] += this.sprayVel[i * 3 + 1] * dt;
      p[i * 3 + 2] += this.sprayVel[i * 3 + 2] * dt;
      if (p[i * 3 + 1] < 0.02 || this.sprayLife[i] <= 0) {
        this.sprayLife[i] = 0;
        p[i * 3 + 1] = -50;
      }
    }
    if (liveSpray) this.spray.geometry.attributes.position.needsUpdate = true;

    /* do we cause a scene? */
    if (!this.enabled || this.level === 0) return;
    this.cooldown -= dt;
    if (this.cooldown > 0) return;

    const heat = (0.35 + this.drunk) * this.level;
    const chance = dt * 0.09 * heat;
    if (this.rng() > chance) return;

    const roll = this.rng();
    const physical = ctx.rolling || ctx.aiming;
    if (roll < 0.42 || !physical) {
      this.heckle();
      this.cooldown = 3 + this.rng() * 5;
    } else if (roll < 0.78) {
      this.throwJunk();
      this.cooldown = 9 + this.rng() * 9;
    } else if (roll < 0.92) {
      this.vomit();
      this.cooldown = 16 + this.rng() * 14;
    } else {
      this.slam();
      this.cooldown = 12 + this.rng() * 10;
    }
  }
}

import * as THREE from 'three';
import { integrate, sweep, SUBSTEP, FORWARD } from './physics.js';
import { mulberry32, newSeed } from './rng.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _roll = new THREE.Quaternion();

/** Only ever two accent colours, so build each flight texture once. */
const FLIGHT_TEXTURES = new Map();

function flightTexture(hex) {
  const cached = FLIGHT_TEXTURES.get(hex);
  if (cached) return cached;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = hex; g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(0,0,0,.42)';
  for (let i = 0; i < 8; i++) g.fillRect(0, i * 16, S, 8);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = 'rgba(255,255,255,.5)';
  g.beginPath(); g.moveTo(0, 0); g.lineTo(S, S * 0.4); g.lineTo(0, S * 0.6); g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  FLIGHT_TEXTURES.set(hex, t);
  return t;
}

/** A dart: mesh with the tip at the group origin, nose pointing down +Z. */
export function buildDartMesh(accent = '#ff3d2e') {
  const g = new THREE.Group();

  const point = new THREE.Mesh(
    new THREE.ConeGeometry(0.0024, 0.032, 8).rotateX(Math.PI / 2).translate(0, 0, -0.016),
    new THREE.MeshStandardMaterial({ color: '#c9ccd2', roughness: 0.24, metalness: 1 }),
  );
  g.add(point);

  const barrelMat = new THREE.MeshStandardMaterial({ color: '#2e3138', roughness: 0.3, metalness: 1 });
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0039, 0.0034, 0.05, 12).rotateX(Math.PI / 2).translate(0, 0, -0.057),
    barrelMat,
  );
  g.add(barrel);

  // grip rings
  const ringMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.35, metalness: 0.8 });
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0043, 0.0043, 0.004, 12).rotateX(Math.PI / 2),
      ringMat,
    );
    r.position.z = -0.042 - i * 0.014;
    g.add(r);
  }

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0024, 0.0021, 0.034, 8).rotateX(Math.PI / 2).translate(0, 0, -0.099),
    new THREE.MeshStandardMaterial({ color: '#14151a', roughness: 0.5, metalness: 0.2 }),
  );
  g.add(shaft);

  const ftex = flightTexture(accent);
  for (let i = 0; i < 2; i++) {
    const f = new THREE.Mesh(
      new THREE.PlaneGeometry(0.034, 0.028).rotateY(Math.PI / 2).translate(0, 0, -0.13),
      new THREE.MeshStandardMaterial({
        map: ftex, color: 0xffffff, roughness: 0.6, metalness: 0,
        side: THREE.DoubleSide, transparent: true, opacity: 0.94,
      }),
    );
    f.rotation.z = i * Math.PI / 2;
    g.add(f);
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return g;
}

export class Dart {
  constructor(scene, accent) {
    this.scene = scene;
    this.accent = accent;
    this.mesh = buildDartMesh(accent);
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.state = 'idle';         // idle | flight | stuck | dead
    this.pos = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.tip = new THREE.Vector3();
    this.result = null;
    this.acc = 0;
    this.age = 0;
    this.wobAmp = 0; this.wobFreq = 0; this.wobPhase = 0;
    this.roll = 0; this.rollRate = 0; this.magnus = 0;
    this.stuckT = 0;
    this.settleT = 0;
    this.seed = 0;
    this.rng = mulberry32(1);
    this.deflects = 0;

    /* motion trail */
    const N = 26;
    this.trailN = N;
    const tp = new Float32Array(N * 3);
    const tc = new Float32Array(N * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(tp, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(tc, 3));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    scene.add(this.trail);
    this.trailColor = new THREE.Color(accent);
  }

  showHeld(pos, quat) {
    this.state = 'idle';
    this.mesh.visible = true;
    this.mesh.position.copy(pos);
    this.mesh.quaternion.copy(quat);
    this.trail.visible = false;
  }

  hide() { this.mesh.visible = false; this.trail.visible = false; }

  /**
   * @param {object} opts  wobble/roll/magnus, plus `seed` — pass the same seed
   *   and the same pos/vel and the flight is bit-identical anywhere it runs.
   */
  launch(pos, vel, opts = {}) {
    this.seed = opts.seed ?? newSeed();
    this.rng = mulberry32(this.seed);
    this.pos.copy(pos);
    this.prev.copy(pos);
    this.vel.copy(vel);
    this.age = 0;
    this.acc = 0;
    this.result = null;
    this.state = 'flight';
    this.wobAmp = opts.wobble ?? 0.05;
    this.wobFreq = 26 + this.rng() * 14;
    this.wobPhase = this.rng() * 6.28;
    this.rollRate = opts.roll ?? (this.rng() - 0.5) * 9;
    this.roll = 0;
    this.magnus = opts.magnus ?? 0;
    this.bounced = false;
    this.deflects = 0;

    _v.copy(vel).normalize();
    this.quat.setFromUnitVectors(FORWARD, _v);
    // a scruffy release starts the nose off-axis
    _e.set((this.rng() - 0.5) * this.wobAmp * 4, (this.rng() - 0.5) * this.wobAmp * 4, 0);
    this.quat.multiply(_q.setFromEuler(_e));

    this.mesh.visible = true;
    this.trail.visible = true;
    const tp = this.trail.geometry.attributes.position.array;
    const tc = this.trail.geometry.attributes.color.array;
    for (let i = 0; i < this.trailN; i++) {
      tp[i * 3] = pos.x; tp[i * 3 + 1] = pos.y; tp[i * 3 + 2] = pos.z;
      const f = i / (this.trailN - 1);
      tc[i * 3] = this.trailColor.r * f; tc[i * 3 + 1] = this.trailColor.g * f; tc[i * 3 + 2] = this.trailColor.b * f;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.color.needsUpdate = true;
    this._syncMesh();
  }

  _syncMesh() {
    this.mesh.position.copy(this.pos);
    _q.copy(this.quat).multiply(_roll.setFromAxisAngle(FORWARD, this.roll));
    this.mesh.quaternion.copy(_q);
    this.tip.copy(this.pos);
  }

  _pushTrail() {
    const a = this.trail.geometry.attributes.position.array;
    a.copyWithin(0, 3);
    a[(this.trailN - 1) * 3] = this.pos.x;
    a[(this.trailN - 1) * 3 + 1] = this.pos.y;
    a[(this.trailN - 1) * 3 + 2] = this.pos.z;
    this.trail.geometry.attributes.position.needsUpdate = true;
  }

  /** @returns {null|object} the landing event, once, on the frame it resolves */
  update(dt, world) {
    if (this.state === 'stuck') {
      // impact shiver, then a slow droop under its own weight
      this.stuckT += dt;
      const s = Math.exp(-7 * this.stuckT) * Math.sin(this.stuckT * 46) * 0.09;
      const droop = Math.min(0.05, this.stuckT * 0.05);
      _e.set(s - droop, s * 0.6, 0);
      this.mesh.quaternion.copy(this.quat).multiply(_q.setFromEuler(_e));
      if (this.trail.visible) {
        const m = this.trail.material;
        m.opacity = Math.max(0, m.opacity - dt * 2.4);
        if (m.opacity <= 0) this.trail.visible = false;
      }
      return null;
    }
    if (this.state !== 'flight') return null;

    this.acc += Math.min(dt, 0.05);
    let event = null;

    while (this.acc >= SUBSTEP && !event) {
      this.acc -= SUBSTEP;
      integrate(this, SUBSTEP);
      const hit = sweep(this, world);
      if (hit) event = this._resolve(hit, world);
    }

    this._syncMesh();
    this._pushTrail();

    if (!event && this.age > 6) { this.state = 'dead'; event = { type: 'lost', score: null }; }
    return event;
  }

  _resolve(hit, world) {
    switch (hit.type) {
      case 'stick':
      case 'robin': {
        this.pos.copy(hit.point);
        _v.copy(this.vel).normalize();
        this.pos.addScaledVector(_v, hit.type === 'robin' ? 0.004 : 0.013);
        // settle the attitude to the flight direction it arrived at
        this.quat.setFromUnitVectors(FORWARD, _v);
        this.state = 'stuck';
        this.stuckT = 0;
        this.vel.set(0, 0, 0);
        this._syncMesh();
        world.stuck.push(this);
        return {
          type: hit.type === 'robin' ? 'robin' : 'stick',
          surface: hit.surface ?? 'dart',
          score: hit.score ?? null,
          point: this.pos.clone(),
          speed: hit.speed,
          bounced: this.bounced,
        };
      }
      case 'bounce': {
        this.bounced = true;
        this.pos.copy(hit.point);
        this.pos.z += 0.004;
        const n = new THREE.Vector3(0, 0, 1);
        const rest = hit.wire ? 0.42 : 0.3;
        this.vel.reflect(n).multiplyScalar(rest);
        this.vel.x += (this.rng() - 0.5) * 1.4;
        this.vel.y += (this.rng() - 0.5) * 1.2 + 0.5;
        this.rollRate = (this.rng() - 0.5) * 30;
        this.wobAmp = 0.4; this.age = 0;
        return { type: 'bounceout', surface: hit.surface, wire: hit.wire, point: hit.point.clone(), speed: hit.speed };
      }
      case 'deflect': {
        this.bounced = true;
        const n = _v.copy(hit.point).sub(hit.other.tip);
        if (n.lengthSq() < 1e-9) n.set(0, 1, 0);
        n.normalize();
        // place it clear of the other dart's radius, not on the contact point,
        // or the next substep finds the same collision again
        this.pos.copy(hit.other.tip).addScaledVector(n, 0.015);
        this.vel.reflect(n).multiplyScalar(0.34);
        this.vel.y += 0.6;
        this.rollRate = (this.rng() - 0.5) * 26;
        this.wobAmp = 0.5; this.age = 0;
        this.deflects++;
        return { type: 'clatter', point: hit.point.clone(), speed: hit.speed };
      }
      case 'ground': {
        this.pos.copy(hit.point);
        this.pos.y = hit.groundY + 0.002;
        const sp = this.vel.length();
        if (sp < 0.7) {
          // lie down and stop
          this.state = 'dead';
          this.vel.set(0, 0, 0);
          const dir = new THREE.Vector3(this.rng() - 0.5, 0, this.rng() - 0.5).normalize();
          this.quat.setFromUnitVectors(FORWARD, dir);
          this.pos.y = hit.groundY + 0.004;
          this._syncMesh();
          return { type: 'floor', point: this.pos.clone(), speed: sp };
        }
        this.vel.y = Math.abs(this.vel.y) * 0.26;
        this.vel.x *= 0.62; this.vel.z *= 0.62;
        this.rollRate = (this.rng() - 0.5) * 20;
        this.wobAmp = 0.35; this.age = Math.max(0, this.age - 0.2);
        return null;
      }
    }
    return null;
  }

  dispose() {
    this.scene.remove(this.mesh, this.trail);
    this.mesh.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    this.trail.geometry.dispose();
    this.trail.material.dispose();
  }
}

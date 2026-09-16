import * as THREE from 'three';
import { Puppet } from '../../../darts/src/world/puppet.js';
import { Horse } from './horse.js';
import { buildMask } from './masks.js';
import { SEAT, LANCE, SHIELD, HELMET, RIDER as R_SPEC } from '../game/spec.js';

/**
 * A mounted muppet. This file POSES; it never simulates. Every frame it is
 * handed the physics state `r` and writes it onto the meshes.
 *
 * r = {
 *   horse: { z, x, speed, phase, bobY, rock, lateral },
 *   torso: { pitch, roll },
 *   lance: { pivotWorld, dirWorld, broken },
 *   shield:{ centerWorld, normalWorld },
 *   helmet:{ worn, flying, throwing, body: { pos, quat } },
 *   unseated, fall: { pos, quat }, drunk,
 * }
 */

const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0, ...o });

/* ---- scratch: update() allocates nothing ---- */
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _Z = new THREE.Vector3(0, 0, 1);
const _DOWN = new THREE.Vector3(0, -1, 0);

function heraldTexture(colour, accent) {
  const W = 128, H = 160;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = colour; g.fillRect(0, 0, W, H);
  g.strokeStyle = accent; g.lineWidth = 8; g.strokeRect(6, 6, W - 12, H - 12);
  g.fillStyle = accent;
  g.beginPath();
  g.moveTo(20, 60); g.lineTo(W / 2, 22); g.lineTo(W - 20, 60);
  g.lineTo(W - 20, 84); g.lineTo(W / 2, 46); g.lineTo(20, 84);
  g.closePath(); g.fill();
  g.beginPath(); g.arc(W / 2, 112, 26, 0, 7); g.fill();
  g.fillStyle = colour;
  g.beginPath(); g.arc(W / 2, 112, 12, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Rider {
  constructor(scene, seat, puppetSpec, { colour = '#c4342f', mask = 'none', horseSpec = {} } = {}) {
    this.scene = scene;
    this.seat = seat | 0;
    this.colour = colour;
    this.accent = puppetSpec?.accent ?? '#ffe14a';
    this.fur = puppetSpec?.fur ?? '#7ee06a';
    this.maskKey = mask;
    this.hype = 0;
    this._geos = [];
    this._mats = [];
    this._splintU = -1;
    this._lastHelmState = '';

    this.group = new THREE.Group();          // world-space holder (identity)
    this.group.name = 'rider' + this.seat;
    scene.add(this.group);

    /* ---- horse ---- */
    this.horse = new Horse({ caparison: colour, ...horseSpec });
    this.group.add(this.horse.group);

    // warm follow light so both riders read at night from the far end of the lane
    this.light = new THREE.PointLight(0xffd9a0, 18, 9, 2);
    this.light.position.set(0, 3.2, 0);
    this.horse.group.add(this.light);
    this.firstPerson = false;

    /* ---- puppet, seated ---- */
    this.puppet = new Puppet(puppetSpec);
    this.seatPivot = new THREE.Group();       // rotates the whole rider about the hip
    this.horse.saddle.add(this.seatPivot);
    const sc = this.puppet.scale;
    const B = this.puppet.B;
    this._hipY = 0.16 * B.tall * sc;
    this.puppet.group.position.y = -this._hipY + R_SPEC.hipAboveSaddle;
    this.seatPivot.add(this.puppet.group);
    this._seated = true;

    const mat = (m) => { this._mats.push(m); return m; };
    const geo = (g) => { this._geos.push(g); return g; };
    const steel = mat(std('#9aa2a8', { metalness: 0.72, roughness: 0.34 }));
    const wood = mat(std('#a9834c', { roughness: 0.9 }));
    const band = mat(std(colour, { roughness: 0.82 }));
    this.steel = steel;

    /* ---- helm: bucket + cone with an eye slit ---- */
    this.helm = new THREE.Group();
    this.helm.name = 'helm' + this.seat;
    const bucket = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.255, 0.265, 0.44, 16)), steel);
    bucket.castShadow = true;
    this.helm.add(bucket);
    const crown = new THREE.Mesh(geo(new THREE.ConeGeometry(0.256, 0.2, 16)), steel);
    crown.position.y = 0.3;
    this.helm.add(crown);
    const slit = new THREE.Mesh(geo(new THREE.BoxGeometry(0.34, 0.045, 0.06)), mat(std('#101014', { roughness: 0.9 })));
    slit.position.set(0, 0.07, 0.24);
    this.helm.add(slit);
    for (let i = 0; i < 4; i++) {
      const hole = new THREE.Mesh(geo(new THREE.BoxGeometry(0.03, 0.03, 0.05)), slit.material);
      hole.position.set(-0.09 + i * 0.06, -0.06, 0.245);
      this.helm.add(hole);
    }
    const plume = new THREE.Mesh(geo(new THREE.ConeGeometry(0.07, 0.3, 7)), band);
    plume.position.y = 0.5;
    this.helm.add(plume);
    this.helm.position.y = 0.02;
    this.maskSlot = new THREE.Group();
    this.helm.add(this.maskSlot);
    this.puppet.headPivot.add(this.helm);
    this.setMask(mask);

    /* ---- shield ---- */
    this.shield = new THREE.Group();
    const plate = new THREE.Mesh(
      geo(new THREE.BoxGeometry(SHIELD.w, SHIELD.h, 0.035)),
      mat(std('#ffffff', { map: heraldTexture(colour, this.accent), roughness: 0.86 })),
    );
    plate.castShadow = true;
    this.shield.add(plate);
    const tip = new THREE.Mesh(geo(new THREE.ConeGeometry(SHIELD.w * 0.5, SHIELD.h * 0.42, 4)), plate.material);
    tip.rotation.x = Math.PI / 2;
    tip.rotation.y = Math.PI / 4;
    tip.position.set(0, -SHIELD.h * 0.5 - SHIELD.h * 0.2, 0);
    tip.scale.z = 0.09;
    this.shield.add(tip);
    const boss = new THREE.Mesh(geo(new THREE.SphereGeometry(0.055, 10, 8)), steel);
    boss.position.z = 0.03;
    this.shield.add(boss);
    this.group.add(this.shield);

    /* ---- lance: tapered, striped, vamplate, coronel ---- */
    this.lance = new THREE.Group();
    const BUTT = 0.5;   // shaft continues behind the couch pivot, under the arm
    const shaft = new THREE.Mesh(
      geo(new THREE.CylinderGeometry(0.032, 0.075, LANCE.length + BUTT, 10).rotateX(Math.PI / 2)
        .translate(0, 0, (LANCE.length + BUTT) / 2 - BUTT)),
      wood,
    );
    shaft.castShadow = true;
    this.lance.add(shaft);
    const buttCap = new THREE.Mesh(geo(new THREE.SphereGeometry(0.08, 10, 8)), steel);
    buttCap.position.z = -BUTT;
    this.lance.add(buttCap);
    for (let i = 0; i < 6; i++) {
      const z = 0.45 + i * 0.42;
      const rr = 0.077 - (z / LANCE.length) * 0.046;
      const ring = new THREE.Mesh(geo(new THREE.CylinderGeometry(rr, rr - 0.004, 0.16, 10).rotateX(Math.PI / 2)), band);
      ring.position.z = z;
      this.lance.add(ring);
    }
    const vamp = new THREE.Mesh(geo(new THREE.ConeGeometry(0.2, 0.3, 12, 1, true)), steel);
    vamp.rotation.x = -Math.PI / 2;
    vamp.position.z = 0.36;
    this.lance.add(vamp);
    const coronel = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.06, 0.03, 0.1, 8).rotateX(Math.PI / 2)), steel);
    coronel.position.z = LANCE.length - 0.04;
    this.lance.add(coronel);
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(geo(new THREE.ConeGeometry(0.02, 0.07, 5).rotateX(Math.PI / 2)), steel);
      const a = (i / 3) * Math.PI * 2;
      p.position.set(Math.cos(a) * 0.035, Math.sin(a) * 0.035, LANCE.length + 0.04);
      this.lance.add(p);
    }
    this.group.add(this.lance);

    /* ---- shattered stub + splinters ---- */
    this.stub = new THREE.Group();
    const stubMesh = new THREE.Mesh(
      geo(new THREE.CylinderGeometry(0.05, 0.075, 0.9, 10).rotateX(Math.PI / 2).translate(0, 0, 0.45)),
      wood,
    );
    this.stub.add(stubMesh);
    const vamp2 = new THREE.Mesh(geo(new THREE.ConeGeometry(0.2, 0.3, 12, 1, true)), steel);
    vamp2.rotation.x = -Math.PI / 2;
    vamp2.position.z = 0.36;
    this.stub.add(vamp2);
    this.stub.visible = false;
    this.group.add(this.stub);

    this.splinters = new THREE.Group();
    this.splinters.visible = false;
    this._splintV = [];
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(geo(new THREE.ConeGeometry(0.035, 0.42, 5).rotateX(Math.PI / 2)), wood);
      this.splinters.add(s);
      this._splintV.push(new THREE.Vector3(
        (Math.random() - 0.5) * 4, 1.2 + Math.random() * 3, (Math.random() - 0.5) * 4,
      ));
    }
    this.group.add(this.splinters);
  }

  /* ---------------- api ---------------- */

  setMask(key) {
    this.maskKey = key;
    if (this._mask) {
      this._mask.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
      this.maskSlot.remove(this._mask);
    }
    this._mask = buildMask(key, { accent: this.accent, fur: this.fur });
    this.maskSlot.add(this._mask);
  }

  lookAt(v) { this.puppet.setLook(v); }

  /**
   * First person: the camera sits at this rider's head, so hide the body and
   * the worn helm; the horse, lance and shield stay so you see the neck ahead,
   * the shaft to your right and the shield at the edge of view.
   */
  setFirstPerson(on) {
    this.firstPerson = !!on;
    this._applyFirstPerson(false);
  }

  _applyFirstPerson(unseated) {
    const hide = this.firstPerson && !unseated;
    this.puppet.group.visible = !hide;
    // a worn helm hangs off the hidden head; a thrown one is its own object in the group
    this.helm.visible = !(hide && this._lastHelmState === 'worn');
  }

  /* ---------------- per-frame pose ---------------- */

  update(dt, t, r) {
    const seat = SEAT[this.seat] ?? SEAT[0];

    /* ---- horse ---- */
    this.horse.update(dt, t, r?.horse ?? { x: seat.laneX, z: seat.startZ, speed: 0, phase: 0, bobY: 0, rock: 0 }, seat.forward);

    /* ---- puppet base animation ---- */
    this.puppet.hype = this.hype;
    this.puppet.energy = this.hype;
    this.puppet.drunk = r?.drunk ?? 0;
    this.puppet.speed = 0;
    this.puppet.update(dt, t);

    const unseated = !!r?.unseated;

    /* ---- seat / fall ---- */
    if (unseated && this._seated) {
      this.seatPivot.remove(this.puppet.group);
      this.group.add(this.puppet.group);
      this.puppet.group.position.y = 0;
      this._seated = false;
    } else if (!unseated && !this._seated) {
      this.group.remove(this.puppet.group);
      this.seatPivot.add(this.puppet.group);
      this.puppet.group.position.y = -this._hipY + R_SPEC.hipAboveSaddle;
      this._seated = true;
    }

    if (unseated) {
      const p = r.fall?.pos;
      if (p) this.puppet.group.position.set(p.x, p.y, p.z);
      const q = r.fall?.quat;
      if (q) this.puppet.group.quaternion.set(q.x ?? q._x ?? 0, q.y ?? q._y ?? 0, q.z ?? q._z ?? 0, q.w ?? q._w ?? 1);
      // flail: reuse the puppet's own hype channel
      this.puppet.hype = 1.4;
      this.puppet.energy = 1.4;
      for (let k = 0; k < 2; k++) {
        const leg = this.puppet.legs[k];
        leg.hip.rotation.set(Math.sin(t * 17 + k * 2.1) * 1.1, 0, leg.sx * (0.5 + Math.sin(t * 13 + k) * 0.4));
      }
    } else {
      /* ---- torso lean about the hip ---- */
      const pitch = r?.torso?.pitch ?? 0;
      const roll = r?.torso?.roll ?? 0;
      this.seatPivot.rotation.set(-pitch, 0, -roll);

      /* ---- legs astride: hips out, knees bent, counter the lean ---- */
      for (let k = 0; k < 2; k++) {
        const leg = this.puppet.legs[k];
        leg.hip.rotation.set(-0.55 + pitch, 0, leg.sx * 0.72);
      }
    }

    /* ---- helmet ---- */
    const H = r?.helmet;
    const worn = H ? !!H.worn : true;
    const flying = !!H?.flying;
    const state = worn ? 'worn' : (flying ? 'fly' : 'loose');
    if (state !== this._lastHelmState) {
      if (state === 'worn') {
        this.puppet.headPivot.add(this.helm);
        this.helm.position.set(0, 0.02, 0);
        this.helm.rotation.set(0, 0, 0);
        this.helm.scale.setScalar(1);
      } else if (this.helm.parent !== this.group) {
        this.group.add(this.helm);
        this.helm.scale.setScalar(this.puppet.scale);
      }
      this._lastHelmState = state;
    }
    this._applyFirstPerson(unseated);
    if (state !== 'worn' && H?.body?.pos) {
      const p = H.body.pos;
      this.helm.position.set(p.x, p.y, p.z);
      const q = H.body.quat;
      if (q) this.helm.quaternion.set(q.x ?? q._x ?? 0, q.y ?? q._y ?? 0, q.z ?? q._z ?? 0, q.w ?? q._w ?? 1);
    }

    /* ---- lance / stub / splinters ---- */
    const L = r?.lance;
    const broken = !!L?.broken;
    if (L?.pivotWorld) {
      const pv = L.pivotWorld;
      const d = L.dirWorld;
      _v.set(d?.x ?? 0, d?.y ?? 0, d?.z ?? -1);
      if (_v.lengthSq() < 1e-6) _v.set(0, 0, -1);
      _v.normalize();
      _q.setFromUnitVectors(_Z, _v);
      const m = broken ? this.stub : this.lance;
      m.position.set(pv.x, pv.y, pv.z);
      m.quaternion.copy(_q);
    }
    this.lance.visible = !broken;
    this.stub.visible = broken;
    if (broken && this._splintU < 0) {
      this._splintU = 0;
      this.splinters.visible = true;
      for (let i = 0; i < this.splinters.children.length; i++) {
        this.splinters.children[i].position.copy(this.lance.position);
        this.splinters.children[i].quaternion.copy(this.lance.quaternion);
        this.splinters.children[i].translateZ(LANCE.length * (0.65 + Math.random() * 0.3));
      }
    }
    if (!broken && this._splintU >= 0) { this._splintU = -1; this.splinters.visible = false; }
    if (this._splintU >= 0 && this._splintU < 1) {
      this._splintU += dt / 1.1;
      for (let i = 0; i < this.splinters.children.length; i++) {
        const s = this.splinters.children[i];
        const v = this._splintV[i];
        s.position.x += v.x * dt;
        s.position.y += v.y * dt;
        s.position.z += v.z * dt;
        v.y -= 9.8 * dt;
        s.rotation.x += dt * 9; s.rotation.z += dt * 6;
      }
      if (this._splintU >= 1) this.splinters.visible = false;
    }

    /* ---- shield ---- */
    const S = r?.shield;
    if (S?.centerWorld) {
      const c = S.centerWorld;
      this.shield.position.set(c.x, c.y, c.z);
      const n = S.normalWorld;
      _v2.set(n?.x ?? 0, n?.y ?? 0, n?.z ?? 1);
      if (_v2.lengthSq() < 1e-6) _v2.set(0, 0, 1);
      _v2.normalize();
      _q.setFromUnitVectors(_Z, _v2);
      this.shield.quaternion.copy(_q);
    }
    this.shield.visible = !unseated;

    if (!unseated) this._poseArms(dt, t, r);
  }

  /** Right arm couches the lance, left arm carries the shield / slings the helm. */
  _poseArms(dt, t, r) {
    const right = this.puppet.arms[1];
    const left = this.puppet.arms[0];

    // right: aim the upper arm (which hangs along -y) at the lance pivot
    const target = r?.lance?.broken ? this.stub.position : this.lance.position;
    if (target) {
      right.shoulder.getWorldPosition(_v);
      _v3.set(target.x - _v.x, target.y - _v.y, target.z - _v.z);
      if (_v3.lengthSq() > 1e-6) {
        _v3.normalize();
        right.shoulder.parent.getWorldQuaternion(_q);
        _q.invert();
        _v3.applyQuaternion(_q);
        _q.setFromUnitVectors(_DOWN, _v3);
        right.shoulder.quaternion.copy(_q);
        right.elbow.rotation.set(-0.55, 0, 0);
      }
    }

    // left: shield arm, or the helm wind-up and sling
    const throwing = r?.helmet?.throwing ?? 0;
    if (throwing > 0) {
      const u = Math.min(1, throwing);
      const wind = u < 0.6 ? (u / 0.6) : 1;
      const sling = u < 0.6 ? 0 : (u - 0.6) / 0.4;
      left.shoulder.rotation.set(-0.3 - wind * 2.2 + sling * 3.2, 0, left.sx * (0.5 + wind * 0.5));
      left.elbow.rotation.x = -1.6 + wind * -0.6 + sling * 2.0;
    } else {
      const c = r?.shield?.centerWorld;
      if (c) {
        left.shoulder.getWorldPosition(_v);
        _v3.set(c.x - _v.x, c.y - _v.y, c.z - _v.z);
        if (_v3.lengthSq() > 1e-6) {
          _v3.normalize();
          left.shoulder.parent.getWorldQuaternion(_q);
          _q.invert();
          _v3.applyQuaternion(_q);
          _q.setFromUnitVectors(_DOWN, _v3);
          left.shoulder.quaternion.copy(_q);
          left.elbow.rotation.set(-0.7, 0, 0);
        }
      } else {
        left.shoulder.rotation.set(-0.6, 0, left.sx * 0.5);
        left.elbow.rotation.x = -1.2;
      }
    }
  }

  dispose() {
    if (this.light) { this.light.parent?.remove(this.light); this.light.dispose(); }
    this.horse.dispose();
    this.puppet.dispose();
    if (this._mask) this._mask.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    for (const g of this._geos) g.dispose();
    for (const m of this._mats) {
      if (m.map) m.map.dispose();
      m.dispose();
    }
    this.group.traverse((o) => {
      if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); }
    });
    this.scene.remove(this.group);
  }
}

export { HELMET };

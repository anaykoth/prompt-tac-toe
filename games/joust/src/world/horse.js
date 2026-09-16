import * as THREE from 'three';
import { HORSE } from '../game/spec.js';

/**
 * A muppet destrier, built in the puppet's language: fuzzy spheres, cylinders,
 * googly eyes. Local +z is the horse's forward.
 *
 * update() is allocation free — all scratch lives at module scope.
 */

function fuzzTexture() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const v = 128 + (Math.random() - 0.5) * 190;
    g.strokeStyle = `rgb(${v},${v},${v})`;
    const x = Math.random() * S, y = Math.random() * S, a = Math.random() * 6.28;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 4, y + Math.sin(a) * 4); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}
let FUZZ = null;
const fuzz = () => (FUZZ ||= fuzzTexture());

/* rotary gallop footfalls, as a fraction of the stride cycle */
const FOOTFALL = { LH: 0.0, RH: 0.1, LF: 0.3, RF: 0.4 };

const _fwd = new THREE.Vector3();

export class Horse {
  constructor(spec = {}) {
    this.spec = { coat: '#8b5a2b', mane: '#2b1a0e', blaze: true, caparison: '#c4342f', ...spec };
    this.group = new THREE.Group();
    this.group.name = 'horse';
    this.yaw = 0;
    this._mats = [];
    this._geos = [];
    this.legs = [];
    this.tufts = [];
    this.ears = [];
    this._build();
  }

  _mat(color, opts = {}) {
    const m = new THREE.MeshStandardMaterial({
      color, roughness: 1, metalness: 0, bumpMap: fuzz(), bumpScale: 0.85, ...opts,
    });
    this._mats.push(m);
    return m;
  }

  _geo(g) { this._geos.push(g); return g; }

  _build() {
    const s = this.spec;
    const coat = this._mat(s.coat);
    const mane = this._mat(s.mane);
    const hoof = this._mat('#2a2119', { roughness: 0.6, bumpScale: 0.2 });
    const cloth = this._mat(s.caparison, { roughness: 0.92, side: THREE.DoubleSide });
    const leather = this._mat('#4a3320', { roughness: 0.7, bumpScale: 0.3 });

    const add = (parent, geo, mat, shadow = false) => {
      const m = new THREE.Mesh(this._geo(geo), mat);
      m.castShadow = shadow;
      parent.add(m);
      return m;
    };

    const BODY_Y = HORSE.saddleH - 0.42;   // barrel centre height

    /* ---- barrel ---- */
    this.bodyPivot = new THREE.Group();
    this.bodyPivot.position.y = BODY_Y;
    this.group.add(this.bodyPivot);
    this.body = add(this.bodyPivot, new THREE.SphereGeometry(0.46, 20, 16), coat, true);
    this.body.scale.set(0.82, 0.92, 1.1);

    const rump = add(this.bodyPivot, new THREE.SphereGeometry(0.34, 16, 14), coat, true);
    rump.position.set(0, 0.02, -0.42);
    rump.scale.set(0.92, 0.96, 0.85);

    const chest = add(this.bodyPivot, new THREE.SphereGeometry(0.33, 16, 14), coat);
    chest.position.set(0, -0.02, 0.4);
    chest.scale.set(0.9, 0.95, 0.8);

    /* ---- caparison over the body + scalloped hem ---- */
    for (const sx of [-1, 1]) {
      const skirt = add(this.bodyPivot, new THREE.PlaneGeometry(1.5, 0.62), cloth);
      skirt.position.set(sx * 0.4, -0.22, -0.02);
      skirt.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      for (let i = 0; i < 7; i++) {
        const sc = add(this.bodyPivot, new THREE.CircleGeometry(0.11, 10), cloth);
        sc.position.set(sx * 0.4, -0.53, -0.65 + i * 0.22);
        sc.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
    }
    const back = add(this.bodyPivot, new THREE.PlaneGeometry(0.8, 1.5), cloth);
    back.rotation.x = -Math.PI / 2;
    back.position.y = 0.4;

    /* ---- saddle ---- */
    this.saddle = new THREE.Object3D();
    this.saddle.position.set(0, HORSE.saddleH, -0.02);
    this.group.add(this.saddle);
    const pad = add(this.bodyPivot, new THREE.SphereGeometry(0.28, 14, 10), leather, true);
    pad.position.set(0, 0.4, -0.02);
    pad.scale.set(0.8, 0.34, 1.05);
    for (const dz of [-1, 1]) {
      const cantle = add(this.bodyPivot, new THREE.BoxGeometry(0.34, 0.16, 0.06), leather);
      cantle.position.set(0, 0.5, dz * 0.28);
      cantle.rotation.x = dz * -0.3;
    }
    for (const sx of [-1, 1]) {
      const stirrup = add(this.bodyPivot, new THREE.TorusGeometry(0.07, 0.02, 6, 10), leather);
      stirrup.position.set(sx * 0.33, 0.02, 0.02);
    }

    /* ---- neck ---- */
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.2, 0.52);
    this.neck.rotation.x = -0.62;
    this.bodyPivot.add(this.neck);
    const neckMesh = add(this.neck, new THREE.CylinderGeometry(0.17, 0.25, 0.68, 12).translate(0, 0.34, 0), coat, true);
    neckMesh.scale.set(0.85, 1, 1);

    /* ---- head ---- */
    this.head = new THREE.Group();
    this.head.position.set(0, 0.68, 0);
    this.head.rotation.x = 0.5;
    this.neck.add(this.head);
    const skull = add(this.head, new THREE.SphereGeometry(0.19, 16, 14), coat, true);
    skull.scale.set(0.85, 1, 0.95);
    const snout = add(this.head, new THREE.BoxGeometry(0.19, 0.17, 0.3), coat, true);
    snout.position.set(0, -0.02, 0.24);
    if (s.blaze) {
      const blaze = add(this.head, new THREE.BoxGeometry(0.07, 0.02, 0.3), this._mat('#efe6d2'));
      blaze.position.set(0, 0.075, 0.25);
    }
    for (const sx of [-1, 1]) {
      const nostril = add(this.head, new THREE.SphereGeometry(0.03, 8, 6), this._mat('#3a2419', { bumpScale: 0.2 }));
      nostril.position.set(sx * 0.05, -0.03, 0.39);
    }
    // googly eyes
    const eyeMat = this._mat('#fdfbf4', { roughness: 0.22, bumpScale: 0 });
    const pupMat = this._mat('#0a090c', { roughness: 0.15, bumpScale: 0 });
    this.pupils = [];
    for (const sx of [-1, 1]) {
      const e = add(this.head, new THREE.SphereGeometry(0.075, 14, 12), eyeMat);
      e.position.set(sx * 0.14, 0.11, 0.1);
      const p = add(this.head, new THREE.SphereGeometry(0.036, 10, 8), pupMat);
      p.position.set(sx * 0.17, 0.11, 0.13);
      this.pupils.push(p);
    }
    // floppy ears
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.1, 0.16, -0.03);
      this.head.add(pivot);
      const ear = add(pivot, new THREE.ConeGeometry(0.055, 0.2, 8).translate(0, 0.1, 0), coat);
      ear.rotation.z = -sx * 0.25;
      this.ears.push({ pivot, sx });
    }

    /* ---- mane ---- */
    for (let i = 0; i < 8; i++) {
      const pivot = new THREE.Group();
      pivot.position.set(0, 0.08 + i * 0.085, -0.1);
      this.neck.add(pivot);
      const c = add(pivot, new THREE.ConeGeometry(0.055, 0.2, 6).translate(0, 0.1, 0), mane);
      c.rotation.x = 1.5;
      this.tufts.push({ pivot, i, k: 1 });
    }

    /* ---- tail ---- */
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.2, -0.66);
    this.bodyPivot.add(this.tail);
    for (let i = 0; i < 6; i++) {
      const c = add(this.tail, new THREE.ConeGeometry(0.06 - i * 0.006, 0.26, 6).translate(0, -0.13, 0), mane);
      c.position.set((i - 2.5) * 0.035, -i * 0.11, -i * 0.05);
      c.rotation.x = -0.4 - i * 0.08;
    }

    /* ---- legs ---- */
    const upperGeo = new THREE.CylinderGeometry(0.085, 0.07, 0.42, 9).translate(0, -0.21, 0);
    const lowerGeo = new THREE.CylinderGeometry(0.06, 0.048, 0.42, 9).translate(0, -0.21, 0);
    const hoofGeo = new THREE.CylinderGeometry(0.075, 0.085, 0.1, 9);
    const LEGS = [
      { key: 'LF', sx: -1, z: 0.36, front: true },
      { key: 'RF', sx: 1, z: 0.36, front: true },
      { key: 'LH', sx: -1, z: -0.42, front: false },
      { key: 'RH', sx: 1, z: -0.42, front: false },
    ];
    for (const L of LEGS) {
      const hip = new THREE.Group();
      hip.position.set(L.sx * 0.26, BODY_Y - 0.06, L.z);
      this.group.add(hip);
      const upper = new THREE.Mesh(this._geo(upperGeo.clone()), coat);
      upper.castShadow = true;
      hip.add(upper);
      const knee = new THREE.Group();
      knee.position.y = -0.42;
      hip.add(knee);
      const lower = new THREE.Mesh(this._geo(lowerGeo.clone()), coat);
      knee.add(lower);
      const h = new THREE.Mesh(this._geo(hoofGeo.clone()), hoof);
      h.position.y = -0.45;
      knee.add(h);
      this.legs.push({ hip, knee, upper, lower, hoof: h, off: FOOTFALL[L.key], sx: L.sx, front: L.front });
    }

    this.group.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  }

  /**
   * @param h  rider.horse state: { z, x, speed, phase, bobY, rock, lateral }
   * @param seatForward  [0,0,-1] or [0,0,1]
   */
  update(dt, t, h, seatForward) {
    const x = (h?.x ?? 0) + (h?.lateral ?? 0);
    const z = h?.z ?? 0;
    const speed = h?.speed ?? 0;
    const phase = h?.phase ?? 0;

    this.group.position.set(x, h?.bobY ?? 0, z);
    _fwd.set(seatForward?.[0] ?? 0, 0, seatForward?.[2] ?? -1);
    this.yaw = Math.atan2(_fwd.x, _fwd.z);
    this.group.rotation.set(0, this.yaw, 0);
    this.bodyPivot.rotation.x = h?.rock ?? 0;

    const sp = Math.min(1, speed / HORSE.spurMax);
    const moving = speed > 0.3;
    const amp = 0.25 + sp * 0.95;

    /* ---- legs: rotary gallop, or a standing weight shift ---- */
    for (let i = 0; i < this.legs.length; i++) {
      const L = this.legs[i];
      if (moving) {
        const u = (phase / (Math.PI * 2) - L.off) % 1;
        const p = u < 0 ? u + 1 : u;
        // 0..0.35 stance (leg swings back), 0.35..1 swing (folds and reaches)
        let hipA, kneeA;
        if (p < 0.35) {
          const k = p / 0.35;
          hipA = (0.45 - k * 0.95) * amp;
          kneeA = -0.1 * amp;
        } else {
          const k = (p - 0.35) / 0.65;
          hipA = (-0.5 + k * 0.95) * amp;
          kneeA = -(Math.sin(k * Math.PI) * (L.front ? 1.5 : 1.15)) * amp;
        }
        L.hip.rotation.x = hipA;
        L.knee.rotation.x = kneeA;
      } else {
        const shift = Math.sin(t * 0.7 + i * 1.3) * 0.05;
        L.hip.rotation.x += (shift - L.hip.rotation.x) * Math.min(1, dt * 4);
        L.knee.rotation.x += (-0.06 - L.knee.rotation.x) * Math.min(1, dt * 4);
      }
    }

    /* ---- neck pumps with the gait ---- */
    const pump = moving ? Math.sin(phase) * (0.08 + sp * 0.2) : Math.sin(t * 1.1) * 0.03;
    this.neck.rotation.x = -0.62 + pump;
    this.head.rotation.x = 0.5 - pump * 0.55;
    this.head.rotation.z = Math.sin(t * 1.7) * 0.04 * (1 + sp);

    /* ---- ears and mane flail ---- */
    for (let i = 0; i < this.ears.length; i++) {
      const e = this.ears[i];
      e.pivot.rotation.x = Math.sin(t * (7 + sp * 12) + i * 2.2) * (0.1 + sp * 0.55) - sp * 0.4;
      e.pivot.rotation.z = -e.sx * (0.1 + sp * 0.3);
    }
    for (let i = 0; i < this.tufts.length; i++) {
      const m = this.tufts[i];
      m.pivot.rotation.x = Math.sin(t * (6 + sp * 16) + i * 1.4) * (0.08 + sp * 0.7) - sp * 0.5;
      m.pivot.rotation.z = Math.sin(t * (5 + sp * 9) + i) * (0.05 + sp * 0.3);
    }

    /* ---- tail streams back ---- */
    this.tail.rotation.x = -sp * 0.9 + Math.sin(t * (4 + sp * 10)) * (0.06 + sp * 0.22);
    this.tail.rotation.z = Math.sin(t * (3 + sp * 7) + 1.1) * (0.05 + sp * 0.3);

    /* ---- googly pupils lag ---- */
    const wob = Math.sin(t * 9 + phase) * 0.012 * (0.4 + sp);
    this.pupils[0].position.y = 0.11 + wob;
    this.pupils[1].position.y = 0.11 - wob;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
    });
    for (const g of this._geos) g.dispose();
    for (const m of this._mats) m.dispose();
    this.group.parent?.remove(this.group);
  }
}

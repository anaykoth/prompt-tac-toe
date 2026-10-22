import * as THREE from 'three';

/**
 * A single, fully-articulated puppet built from individual meshes.
 *
 * The crowd draws the same anatomy through InstancedMesh because there are 130
 * of them; named characters get real objects instead — they need a throwing
 * animation, a hand you can spawn a dart from, and accessories the instanced
 * path can't express.
 */

/* ------------------------------------------------------------------ */
/* Palettes — shared with the crowd so the whole cast matches          */
/* ------------------------------------------------------------------ */

export const FUR = [
  '#ff4fa3', '#7ee06a', '#4fd0ff', '#ff8a3d', '#b96cff', '#ffd93d',
  '#ff5b4a', '#3ddbb0', '#cfc4a8', '#8f9bff', '#ff9ec7', '#c2f24a',
  '#f2643f', '#59c9ff', '#d84fff', '#9ad14a', '#d9c59a', '#5fbf8a',
];
export const HAIR = ['#ff2d6f', '#ffe14a', '#43f5c0', '#ff7a1a', '#c86bff', '#f4f1e6', '#2ee0ff', '#ff4a4a'];
export const NOSE = ['#ff6b5b', '#ffcf5b', '#6be0ff', '#ff9ddb', '#a8ff6b', '#e8734a'];

export const BUILDS = {
  round: { label: 'ROUND', fat: 1.34, tall: 0.88 },
  average: { label: 'AVERAGE', fat: 1.0, tall: 1.0 },
  lanky: { label: 'LANKY', fat: 0.74, tall: 1.32 },
  gremlin: { label: 'GREMLIN', fat: 0.9, tall: 0.72 },
};

export const HAIR_STYLES = {
  tufts: 'TUFTS', mohawk: 'MOHAWK', shaggy: 'SHAGGY',
  antennae: 'ANTENNAE', horns: 'HORNS', bald: 'BALD',
};

export const NOSE_SHAPES = { round: 'ROUND', beak: 'BEAK', snout: 'SNOUT', button: 'BUTTON' };

export const ACCESSORIES = {
  none: 'NOTHING', cap: 'FLAT CAP', beanie: 'BOBBLE HAT',
  shades: 'SHADES', bowtie: 'BOW TIE', scarf: 'SCARF',
};

/** Height of the puppet at scale 1, used to convert a spec height to a scale. */
const BASE_HEIGHT = 0.9;

const pick = (a) => a[(Math.random() * a.length) | 0];
const keys = (o) => Object.keys(o);

export function randomSpec(name = 'YOU') {
  return {
    name,
    fur: pick(FUR),
    hair: pick(HAIR),
    hairStyle: pick(keys(HAIR_STYLES)),
    nose: pick(NOSE),
    noseShape: pick(keys(NOSE_SHAPES)),
    accessory: pick(keys(ACCESSORIES)),
    accent: pick(HAIR),
    build: pick(keys(BUILDS)),
    height: 1.42 + Math.random() * 0.36,
    eyeSize: 0.85 + Math.random() * 0.5,
    pupilSize: 0.8 + Math.random() * 0.5,
  };
}

export function defaultSpec(name = 'YOU') {
  return {
    name,
    fur: '#7ee06a', hair: '#ff2d6f', hairStyle: 'tufts',
    nose: '#ff6b5b', noseShape: 'round', accessory: 'none',
    accent: '#ffe14a', build: 'average', height: 1.58,
    eyeSize: 1, pupilSize: 1,
  };
}

/* ------------------------------------------------------------------ */

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

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/* ------------------------------------------------------------------ */

export class Puppet {
  constructor(spec) {
    this.spec = { ...defaultSpec(), ...spec };
    this.group = new THREE.Group();
    this.group.name = 'puppet:' + this.spec.name;

    this.hype = 0;
    this.energy = 0;
    this.throwU = null;       // 0..1 while a throw animation is playing
    this.drunk = 0;
    this.phase = Math.random() * 100;
    this.rate = 0.9 + Math.random() * 0.4;
    this.blink = Math.random() * 5;
    this.crazy = 0.7;
    this.lookTarget = null;
    this.headYaw = 0;
    this.headPitch = 0;
    this.walkCycle = 0;
    this.speed = 0;

    this._build();
  }

  /**
   * Builds scale the torso vertically, so the requested height has to be
   * divided back out — otherwise a ROUND puppet at 1.58 m is visibly
   * shorter than a LANKY one at the same setting and the slider lies.
   */
  get scale() {
    const B = BUILDS[this.spec.build] ?? BUILDS.average;
    return this.spec.height / (BASE_HEIGHT * B.tall);
  }

  _mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({
      color, roughness: 1, metalness: 0, bumpMap: fuzz(), bumpScale: 0.8, ...opts,
    });
  }

  _build() {
    const s = this.spec;
    const B = BUILDS[s.build] ?? BUILDS.average;
    this.B = B;
    const root = new THREE.Group();
    root.scale.setScalar(this.scale);
    this.group.add(root);
    this.root = root;

    const furMat = this._mat(s.fur);
    const noseMat = this._mat(s.nose, { roughness: 0.55, bumpScale: 0.2 });
    const hairMat = this._mat(s.hair);
    const accentMat = this._mat(s.accent, { roughness: 0.7 });
    this.mats = [furMat, noseMat, hairMat, accentMat];

    const add = (parent, geo, mat) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    /* ---- body ---- */
    this.bodyPivot = new THREE.Group();
    this.bodyPivot.position.y = 0.30 * B.tall;
    root.add(this.bodyPivot);
    this.body = add(this.bodyPivot, new THREE.SphereGeometry(0.28, 20, 16), furMat);
    this.body.scale.set(B.fat, B.tall, B.fat * 0.86);

    /* ---- head ---- */
    this.headPivot = new THREE.Group();
    this.headPivot.position.y = 0.60 * B.tall + 0.06;
    root.add(this.headPivot);
    this.head = add(this.headPivot, new THREE.SphereGeometry(0.24, 22, 18), furMat);
    this.head.scale.set(B.fat * 0.92, 1, 0.94);

    // mouth: a hemisphere that opens
    this.mouth = add(
      this.headPivot,
      new THREE.SphereGeometry(0.155, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(s.fur).multiplyScalar(0.22).lerp(new THREE.Color(0x4a1020), 0.55),
        roughness: 0.75, side: THREE.DoubleSide,
      }),
    );
    this.mouth.position.set(0, -0.05, 0.16);
    this.mouth.rotation.x = Math.PI * 0.5 + 0.35;

    /* ---- nose ---- */
    const NS = s.noseShape;
    let noseGeo;
    if (NS === 'beak') noseGeo = new THREE.ConeGeometry(0.062, 0.17, 10).rotateX(Math.PI / 2);
    else if (NS === 'snout') noseGeo = new THREE.SphereGeometry(0.072, 14, 12).scale(1, 0.85, 1.9);
    else if (NS === 'button') noseGeo = new THREE.SphereGeometry(0.045, 12, 10);
    else noseGeo = new THREE.SphereGeometry(0.078, 14, 12);
    this.nose = add(this.headPivot, noseGeo, noseMat);
    this.nose.position.set(0, 0.02, NS === 'beak' ? 0.28 : 0.25);

    /* ---- eyes ---- */
    const es = s.eyeSize;
    this.eyes = []; this.pupils = [];
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xfdfbf4, roughness: 0.25 });
    const pupMat = new THREE.MeshStandardMaterial({ color: 0x0a090c, roughness: 0.18 });
    for (let k = 0; k < 2; k++) {
      const sx = k ? 1 : -1;
      const eye = add(this.headPivot, new THREE.SphereGeometry(0.088 * es, 18, 14), eyeMat);
      eye.position.set(sx * 0.115, 0.185, 0.135);
      eye.castShadow = false;
      this.eyes.push(eye);
      const pup = add(this.headPivot, new THREE.SphereGeometry(0.043 * es * s.pupilSize, 12, 10), pupMat);
      pup.position.set(sx * 0.115, 0.185, 0.135 + 0.062 * es);
      pup.castShadow = false;
      this.pupils.push(pup);
    }

    /* ---- hair ---- */
    this.hair = [];
    const tuft = (x, y, z, r, h, rot) => {
      const m = add(this.headPivot, new THREE.ConeGeometry(r, h, 8).translate(0, h / 2, 0), hairMat);
      m.position.set(x, y, z);
      if (rot) m.rotation.set(rot[0], 0, rot[2]);
      this.hair.push(m);
      return m;
    };
    switch (s.hairStyle) {
      case 'mohawk':
        for (let i = 0; i < 5; i++) {
          const f = 1 - Math.abs(i - 2) / 3;
          tuft(0, 0.225, 0.10 - i * 0.055, 0.035, 0.10 + f * 0.16, [0, 0, 0]);
        }
        break;
      case 'shaggy':
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          tuft(Math.cos(a) * 0.13, 0.19, Math.sin(a) * 0.13, 0.028, 0.11,
            [Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7]);
        }
        break;
      case 'antennae':
        for (let k = 0; k < 2; k++) {
          const sx = k ? 1 : -1;
          const rod = add(this.headPivot, new THREE.CylinderGeometry(0.011, 0.011, 0.2, 6).translate(0, 0.1, 0), hairMat);
          rod.position.set(sx * 0.07, 0.21, 0);
          rod.rotation.z = -sx * 0.3;
          const ball = add(this.headPivot, new THREE.SphereGeometry(0.038, 12, 10), hairMat);
          ball.position.set(sx * 0.13, 0.40, 0);
          this.hair.push(rod, ball);
        }
        break;
      case 'horns':
        for (let k = 0; k < 2; k++) {
          const sx = k ? 1 : -1;
          tuft(sx * 0.13, 0.185, -0.02, 0.05, 0.19, [-0.35, 0, -sx * 0.75]);
        }
        break;
      case 'bald':
        break;
      default:
        for (let i = 0; i < 3; i++) tuft((i - 1) * 0.105, 0.225, -0.01, 0.045, 0.2, [0, 0, (i - 1) * 0.5]);
    }

    /* ---- accessory ---- */
    this.accessory = new THREE.Group();
    this.headPivot.add(this.accessory);
    this._buildAccessory(accentMat, furMat);

    /* ---- arms ---- */
    this.arms = [];
    const limb = (r0, r1, len) => new THREE.CylinderGeometry(r0, r1, len, 10, 1).translate(0, -len / 2, 0);
    for (let k = 0; k < 2; k++) {
      const sx = k ? 1 : -1;
      const shoulder = new THREE.Group();
      // must sit inside the body's silhouette *at shoulder height*, which is
      // narrower than the sphere's equator, or the arm floats free
      shoulder.position.set(sx * 0.225 * B.fat, 0.42 * B.tall + 0.02, 0.02);
      root.add(shoulder);
      const upper = add(shoulder, limb(0.058, 0.05, 0.24), furMat);
      const elbow = new THREE.Group();
      elbow.position.y = -0.24;
      shoulder.add(elbow);
      const lower = add(elbow, limb(0.05, 0.044, 0.22), furMat);
      const hand = add(elbow, new THREE.SphereGeometry(0.072, 14, 12), furMat);
      hand.position.y = -0.22;
      this.arms.push({ shoulder, elbow, upper, lower, hand, sx });
    }
    // right arm throws
    this.throwArm = this.arms[1];

    /* ---- legs ---- */
    this.legs = [];
    for (let k = 0; k < 2; k++) {
      const sx = k ? 1 : -1;
      const hip = new THREE.Group();
      hip.position.set(sx * 0.135 * B.fat, 0.16 * B.tall, 0);
      root.add(hip);
      add(hip, limb(0.066, 0.058, 0.24), furMat);
      const foot = add(hip, new THREE.SphereGeometry(0.08, 12, 10).scale(1, 0.6, 1.55), noseMat);
      foot.position.y = -0.245;
      foot.position.z = 0.03;
      this.legs.push({ hip, foot, sx });
    }

    this.group.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  }

  _buildAccessory(accentMat, furMat) {
    const a = this.spec.accessory;
    const add = (geo, mat, pos, rot) => {
      const m = new THREE.Mesh(geo, mat);
      if (pos) m.position.set(...pos);
      if (rot) m.rotation.set(...rot);
      m.castShadow = true;
      this.accessory.add(m);
      return m;
    };
    const dark = new THREE.MeshStandardMaterial({ color: '#26242c', roughness: 0.6 });
    switch (a) {
      case 'cap':
        add(new THREE.SphereGeometry(0.245, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2.1), accentMat, [0, 0.055, 0]);
        add(new THREE.CylinderGeometry(0.20, 0.20, 0.018, 18, 1, false, -0.9, 1.8), accentMat, [0, 0.06, 0.14]);
        break;
      case 'beanie':
        add(new THREE.SphereGeometry(0.25, 18, 12, 0, Math.PI * 2, 0, Math.PI / 1.9), accentMat, [0, 0.04, 0]);
        add(new THREE.TorusGeometry(0.243, 0.03, 8, 20), accentMat, [0, 0.075, 0], [Math.PI / 2, 0, 0]);
        add(new THREE.SphereGeometry(0.062, 12, 10), this.mats[2], [0, 0.31, 0]);
        break;
      case 'shades': {
        const lensMat = new THREE.MeshStandardMaterial({
          color: '#0b0c10', roughness: 0.12, metalness: 0.6,
        });
        const es = this.spec.eyeSize;
        for (let k = 0; k < 2; k++) {
          add(new THREE.SphereGeometry(0.098 * es, 14, 12).scale(1, 0.85, 0.5), lensMat,
            [(k ? 1 : -1) * 0.115, 0.185, 0.20]);
        }
        add(new THREE.BoxGeometry(0.09, 0.016, 0.02), lensMat, [0, 0.192, 0.215]);
        break;
      }
      case 'bowtie':
        // sits on the chest, so it hangs off the body rather than the head
        this.accessory.position.y = -0.34;
        this.accessory.position.z = 0.02;
        for (let k = 0; k < 2; k++) {
          add(new THREE.ConeGeometry(0.062, 0.09, 10).rotateZ(Math.PI / 2), accentMat,
            [(k ? 1 : -1) * 0.062, 0, 0.2], [0, 0, k ? Math.PI : 0]);
        }
        add(new THREE.SphereGeometry(0.028, 10, 8), dark, [0, 0, 0.21]);
        break;
      case 'scarf':
        this.accessory.position.y = -0.22;
        add(new THREE.TorusGeometry(0.175, 0.045, 8, 20), accentMat, [0, 0, 0], [Math.PI / 2, 0, 0]);
        add(new THREE.BoxGeometry(0.085, 0.30, 0.045), accentMat, [0.08, -0.16, 0.15], [0.2, 0, 0.12]);
        break;
    }
  }

  /* ---------------- animation ---------------- */

  /** Start a throw. Returns the time (s) until the dart leaves the hand. */
  startThrow(duration = 0.95) {
    this.throwU = 0;
    this.throwDur = duration;
    return duration * RELEASE_AT;
  }

  /** World position of the throwing hand — where a dart should spawn. */
  handWorld(out = new THREE.Vector3()) {
    this.throwArm.hand.getWorldPosition(out);
    return out;
  }

  setLook(v) { this.lookTarget = v; }

  update(dt, t) {
    const s = this.spec;
    const B = this.B;
    const ph = t * this.rate + this.phase;
    const ha = Math.max(0, this.hype);
    const h = this.hype;

    /* throw timeline */
    let tu = null;
    if (this.throwU !== null) {
      this.throwU += dt / this.throwDur;
      if (this.throwU >= 1) this.throwU = null;
      else tu = this.throwU;
    }

    /* ---- root: breathing, bounce, drunk lean ---- */
    const bounce = ha > 0.12 ? Math.abs(Math.sin(ph * (5.5 + ha * 6))) * ha * 0.075 : 0;
    const drunkLean = this.drunk * Math.sin(t * 0.6) * 0.09;
    this.root.position.y = bounce + Math.sin(ph * 1.7) * 0.008;
    this.root.rotation.z = drunkLean + Math.sin(ph * 1.3) * 0.02 * (1 + ha);
    this.root.rotation.x = tu !== null ? throwLean(tu) : (h < 0 ? 0.14 : 0) + this.drunk * 0.05;

    /* ---- body squash ---- */
    const squash = 1 + Math.sin(ph * (6 + ha * 8)) * (0.015 + ha * 0.055);
    this.body.scale.set(B.fat * (2 - squash), B.tall * squash, B.fat * 0.86 * (2 - squash));

    /* ---- head ---- */
    let hy = Math.sin(ph * 1.1) * 0.1 * (1 + ha * 0.5);
    let hp = -ha * 0.28 + (h < 0 ? 0.28 : 0);
    if (this.lookTarget) {
      this.headPivot.getWorldPosition(_v);
      const dx = this.lookTarget.x - _v.x, dy = this.lookTarget.y - _v.y, dz = this.lookTarget.z - _v.z;
      const worldYaw = Math.atan2(dx, dz);
      let rel = worldYaw - this.group.rotation.y;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      hy = THREE.MathUtils.clamp(rel, -1.1, 1.1) + Math.sin(ph * 1.6) * 0.04;
      hp = THREE.MathUtils.clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.6, 0.6);
    }
    this.headYaw += (hy - this.headYaw) * Math.min(1, dt * 7);
    this.headPitch += (hp - this.headPitch) * Math.min(1, dt * 7);
    this.headPivot.rotation.set(
      this.headPitch + Math.sin(ph * 2.4) * 0.02,
      this.headYaw,
      Math.sin(ph * 2.1) * 0.05 * (1 + ha * 2) + this.drunk * Math.sin(t * 0.9) * 0.12,
    );
    const hs = 1 + ha * 0.05;
    this.head.scale.set(B.fat * 0.92 * hs, hs, 0.94 * hs);

    /* ---- mouth ---- */
    const gape = 0.12 + ha * 1.5 + (h < 0 ? 0.45 : 0) + (tu !== null ? 0.4 : 0);
    this.mouth.scale.set(0.95, Math.min(1.6, gape), 0.55);

    /* ---- eyes ---- */
    const blinkT = (t + this.blink) % 4.4;
    const blink = blinkT < 0.11 ? 0.1 : 1;
    const bulge = 1 + ha * 0.4 + this.drunk * 0.1;
    for (let k = 0; k < 2; k++) {
      this.eyes[k].scale.set(bulge, bulge * blink, bulge);
      const wob = ha > 0.6 ? 0 : 0.02;
      const px = Math.sin(ph * 1.9 + k) * wob + this.drunk * Math.sin(t * 1.3 + k * 2) * 0.03;
      const py = Math.cos(ph * 1.4 + k * 2) * wob;
      this.pupils[k].position.x = (k ? 1 : -1) * 0.115 + px;
      this.pupils[k].position.y = 0.185 + py;
      this.pupils[k].position.z = 0.135 + 0.062 * s.eyeSize * bulge;
      this.pupils[k].scale.setScalar(blink < 1 ? 0.1 : 1);
    }

    /* ---- hair flail ---- */
    for (let i = 0; i < this.hair.length; i++) {
      const m = this.hair[i];
      if (m.userData.base === undefined) m.userData.base = m.rotation.z;
      m.rotation.z = m.userData.base + Math.sin(ph * (4 + ha * 14) + i * 2.1) * (0.05 + ha * 0.55);
    }

    /* ---- arms ---- */
    for (let k = 0; k < 2; k++) {
      const arm = this.arms[k];
      const isThrower = arm === this.throwArm;
      let uPitch, uRoll, lPitch;

      if (tu !== null && isThrower) {
        const p = throwArmPose(tu);
        uPitch = p.upper; uRoll = arm.sx * 0.16; lPitch = p.lower;
      } else if (tu !== null) {
        uPitch = -0.35; uRoll = arm.sx * 0.4; lPitch = -0.5;
      } else if (h < -0.25) {
        uPitch = -0.4; uRoll = arm.sx * 0.55; lPitch = -1.7;
      } else if (ha > 0.55) {
        const wm = ph * (5 + ha * 12);
        uPitch = Math.sin(wm + k * Math.PI) * (0.7 + ha * 2.2);
        uRoll = arm.sx * (0.3 + ha * 0.85);
        lPitch = Math.cos(wm * 1.3 + k) * (0.4 + ha);
      } else if (ha > 0.16) {
        const clap = Math.max(0, Math.sin(ph * (7 + ha * 9)));
        uPitch = -0.5 - clap * 0.35 * ha;
        uRoll = arm.sx * (0.6 - clap * 0.46) * (0.6 + ha);
        lPitch = -1.15 - clap * 0.25;
      } else {
        uPitch = Math.sin(ph * 1.2 + k) * 0.1 + this.speed * 0.5 * Math.sin(this.walkCycle + k * Math.PI);
        uRoll = arm.sx * (0.2 + Math.sin(ph) * 0.03);
        lPitch = -0.35;
      }
      arm.shoulder.rotation.set(uPitch, 0, uRoll);
      arm.elbow.rotation.x = lPitch;
    }

    /* ---- legs ---- */
    this.walkCycle += this.speed * dt * 9;
    for (let k = 0; k < 2; k++) {
      const leg = this.legs[k];
      const stride = this.speed > 0.02
        ? Math.sin(this.walkCycle + k * Math.PI) * 0.55
        : Math.sin(ph * (3 + ha * 6) + k * 3.14) * (0.04 + ha * 0.4);
      leg.hip.rotation.set(stride, 0, leg.sx * 0.05);
    }

    /* ---- energy decay ---- */
    if (this.energy !== 0) {
      const decay = dt * 0.55;
      this.energy += this.energy > 0 ? -decay : decay * 0.7;
      if (Math.abs(this.energy) < 0.004) this.energy = 0;
    }
    this.hype += (this.energy - this.hype) * Math.min(1, dt * 9);
  }

  react(amount) {
    this.energy = THREE.MathUtils.clamp(this.energy + amount * (0.5 + this.crazy), -0.9, 1.6);
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
    });
    this.group.parent?.remove(this.group);
  }
}

/* ------------------------------------------------------------------ */
/* Throw timeline                                                      */
/* ------------------------------------------------------------------ */

/** Fraction of the animation at which the dart leaves the hand. */
export const RELEASE_AT = 0.56;

function throwArmPose(u) {
  // raise -> cock back behind the ear -> snap forward -> follow through
  if (u < 0.28) {
    const k = u / 0.28;
    return { upper: -0.2 - k * 1.9, lower: -0.3 - k * 1.5 };
  }
  if (u < RELEASE_AT) {
    const k = (u - 0.28) / (RELEASE_AT - 0.28);
    return { upper: -2.1 - k * 0.45, lower: -1.8 - k * 0.55 };
  }
  if (u < 0.72) {
    const k = (u - RELEASE_AT) / (0.72 - RELEASE_AT);
    const e = k * k;
    return { upper: -2.55 + e * 1.5, lower: -2.35 + e * 2.15 };
  }
  const k = (u - 0.72) / 0.28;
  return { upper: -1.05 + k * 0.85, lower: -0.2 - k * 0.15 };
}

function throwLean(u) {
  if (u < 0.28) return -(u / 0.28) * 0.1;
  if (u < RELEASE_AT) return -0.1;
  if (u < 0.8) return -0.1 + ((u - RELEASE_AT) / (0.8 - RELEASE_AT)) * 0.24;
  return 0.14 - ((u - 0.8) / 0.2) * 0.14;
}

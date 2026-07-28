import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* Fur / palette                                                       */
/* ------------------------------------------------------------------ */

const FUR = [
  '#ff4fa3', '#7ee06a', '#4fd0ff', '#ff8a3d', '#b96cff', '#ffd93d',
  '#ff5b4a', '#3ddbb0', '#cfc4a8', '#8f9bff', '#ff9ec7', '#c2f24a',
  '#f2643f', '#59c9ff', '#d84fff', '#9ad14a', '#d9c59a', '#5fbf8a',
];
const HAIR = ['#ff2d6f', '#ffe14a', '#43f5c0', '#ff7a1a', '#c86bff', '#f4f1e6', '#2ee0ff', '#ff4a4a'];
const NOSE = ['#ff6b5b', '#ffcf5b', '#6be0ff', '#ff9ddb', '#a8ff6b'];

function fuzzTexture() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const v = 128 + (Math.random() - 0.5) * 190;
    g.strokeStyle = `rgb(${v},${v},${v})`;
    g.lineWidth = 1;
    const x = Math.random() * S, y = Math.random() * S, a = Math.random() * 6.28;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 4, y + Math.sin(a) * 4); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

function signTexture(text, hue) {
  const W = 256, H = 160;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#efe7d0'; g.fillRect(0, 0, W, H);
  g.strokeStyle = `hsl(${hue},70%,40%)`; g.lineWidth = 7; g.strokeRect(6, 6, W - 12, H - 12);
  g.fillStyle = `hsl(${hue},76%,34%)`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const words = text.split(' ');
  const size = words.length > 2 ? 40 : 54;
  g.font = `700 ${size}px "Barlow Condensed", Impact, sans-serif`;
  words.forEach((w, i) => g.fillText(w, W / 2, H / 2 - (words.length - 1) * size * 0.44 + i * size * 0.88));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SIGN_TEXT = ['180 OR DIE', 'MY SON', 'HE IS UNWELL', 'THROW IT', 'OOOOO', 'FELT & PROUD', 'BULL PLEASE', 'I ATE A DART'];

/* ------------------------------------------------------------------ */

/* Scratch objects — the update loop runs thousands of times a frame and must
   not allocate. */
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _rootQ = new THREE.Quaternion();
const _rootP = new THREE.Vector3();
const _headQ = new THREE.Quaternion();
const _outQ = new THREE.Quaternion();
const _outP = new THREE.Vector3();
const _tmpQ = new THREE.Quaternion();
const _tmpQ2 = new THREE.Quaternion();
const _lp = new THREE.Vector3();
const _lp2 = new THREE.Vector3();
const _shoulder = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _hip = new THREE.Vector3();
const _foot = new THREE.Vector3();
const _headP = new THREE.Vector3();
const _eq = new THREE.Quaternion();
const _IQ = new THREE.Quaternion();

export class Crowd {
  constructor(scene, seats, opts = {}) {
    this.scene = scene;
    this.n = seats.length;
    this.focus = opts.focus ?? new THREE.Vector3(0, 1.2, 1.6);
    this.frame = 0;
    this.globalHype = 0;
    this.parts = {};
    this.meshes = [];

    /* Optional extras, all inert by default so the darts hall behaves exactly
       as it did: a size multiplier, a drunkenness level, tracked hand positions
       (so something can be thrown from an actual hand), and pints. */
    this.scaleMul = opts.scale ?? 1;
    this.drunk = 0;
    this.trackHands = !!opts.trackHands;
    this.withMugs = opts.mugs ?? 0;      // fraction of the room holding a drink

    const fuzz = this.fuzz = fuzzTexture();
    const furMat = () => new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1.0, metalness: 0, bumpMap: fuzz, bumpScale: 0.9,
    });

    const P = (name, geo, mat, per) => {
      const im = new THREE.InstancedMesh(geo, mat, this.n * per);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.castShadow = name === 'body' || name === 'head';
      im.name = 'crowd_' + name;
      scene.add(im);
      this.parts[name] = { mesh: im, per };
      this.meshes.push(im);
      return im;
    };

    // pivots pushed to the joint end so rotation swings correctly
    const limb = (r0, r1, len) => new THREE.CylinderGeometry(r0, r1, len, 6, 1).translate(0, -len / 2, 0);

    P('body', new THREE.SphereGeometry(0.28, 12, 10), furMat(), 1);
    P('head', new THREE.SphereGeometry(0.24, 14, 12), furMat(), 1);
    P('nose', new THREE.SphereGeometry(0.075, 8, 7), new THREE.MeshStandardMaterial({ roughness: 0.55 }), 1);
    P('mouth', new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }), 1);
    P('eye', new THREE.SphereGeometry(0.085, 10, 9), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.28 }), 2);
    P('pupil', new THREE.SphereGeometry(0.042, 8, 7), new THREE.MeshStandardMaterial({ color: 0x0b0a0c, roughness: 0.2 }), 2);
    P('hair', new THREE.ConeGeometry(0.045, 0.2, 6).translate(0, 0.1, 0), furMat(), 3);
    P('armU', limb(0.058, 0.05, 0.24), furMat(), 2);
    P('armL', limb(0.05, 0.044, 0.22), furMat(), 2);
    P('hand', new THREE.SphereGeometry(0.07, 8, 7), furMat(), 2);
    P('legU', limb(0.062, 0.055, 0.26), furMat(), 2);
    P('foot', new THREE.SphereGeometry(0.075, 8, 7).scale(1, 0.62, 1.5), new THREE.MeshStandardMaterial({ roughness: 0.6 }), 2);

    /* ---- per-muppet state ---- */
    this.m = seats.map((seat, i) => {
      const arche = Math.random();
      const scale = (seat.sit ? 0.86 + Math.random() * 0.3 : 0.95 + Math.random() * 0.34) * this.scaleMul;
      const fur = new THREE.Color(FUR[(Math.random() * FUR.length) | 0]);
      return {
        i,
        home: seat.pos.clone(),
        sit: seat.sit,
        wall: !!seat.wall,
        side: seat.side,
        scale,
        fat: arche < 0.34 ? 1.3 : arche > 0.78 ? 0.72 : 1.0,
        tall: arche > 0.78 ? 1.28 : arche < 0.34 ? 0.86 : 1.0,
        fur,
        hair: new THREE.Color(HAIR[(Math.random() * HAIR.length) | 0]),
        nose: new THREE.Color(NOSE[(Math.random() * NOSE.length) | 0]),
        crazy: 0.2 + Math.pow(Math.random(), 0.7) * 0.8,
        flavour: (Math.random() * 5) | 0,
        phase: Math.random() * 100,
        rate: 0.8 + Math.random() * 0.7,
        energy: 0,
        hype: 0,
        pending: 0,
        delay: 0,
        jumpY: 0,
        jumpV: 0,
        spin: 0,
        lean: 0,
        blink: Math.random() * 6,
        sober: Math.random(),            // how well they hold it
        hasMug: Math.random() < this.withMugs,
        handW: this.trackHands ? new THREE.Vector3() : null,
      };
    });

    // face the action
    for (const m of this.m) {
      m.baseYaw = Math.atan2(this.focus.x - m.home.x, this.focus.z - m.home.z);
    }

    this._paintColors();
    this._buildSigns(scene);
    this._buildConfetti(scene);
    if (this.withMugs) this._buildMugs(scene);
  }

  _buildMugs(scene) {
    const holders = this.m.filter((m) => m.hasMug);
    this.mugCount = holders.length;
    if (!this.mugCount) return;
    const mug = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.055, 0.045, 0.13, 10),
      new THREE.MeshStandardMaterial({
        color: 0xd8c07a, roughness: 0.15, metalness: 0.05,
        transparent: true, opacity: 0.72,
      }),
      this.mugCount,
    );
    mug.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mug.frustumCulled = false;
    scene.add(mug);
    this.mugMesh = mug;
    this.mugHolders = holders;
    holders.forEach((m, k) => { m.mugSlot = k; });
    this.meshes.push(mug);
  }

  /** 0 = the first round, 1 = belligerent. Drives sway, not decision-making. */
  setDrunk(v) { this.drunk = Math.max(0, Math.min(1.4, v)); }

  _paintColors() {
    const set = (name, fn) => {
      const { mesh, per } = this.parts[name];
      for (let i = 0; i < this.n; i++) {
        for (let k = 0; k < per; k++) mesh.setColorAt(i * per + k, fn(this.m[i], k));
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    const dark = new THREE.Color();
    set('body', (m) => m.fur);
    set('head', (m) => m.fur);
    set('hair', (m) => m.hair);
    set('nose', (m) => m.nose);
    set('armU', (m) => m.fur);
    set('armL', (m) => m.fur);
    set('hand', (m) => m.fur);
    set('legU', (m) => m.fur);
    set('foot', (m) => dark.copy(m.nose).multiplyScalar(0.55));
    set('eye', () => new THREE.Color(0xfdfbf4));
    set('pupil', () => new THREE.Color(0x0a090c));
    set('mouth', (m) => dark.copy(m.fur).multiplyScalar(0.22).lerp(new THREE.Color(0x4a1020), 0.5));
  }

  _buildSigns(scene) {
    this.signs = [];
    // never the wall row — their signs would sit right across the board
    const holders = this.m.filter((m) => !m.sit && !m.wall).slice(0, 6);
    holders.forEach((m, i) => {
      const tex = signTexture(SIGN_TEXT[i % SIGN_TEXT.length], (i * 61) % 360);
      // two back-to-back faces rather than one double-sided plane: a sign seen
      // from behind should still read, not read backwards
      const signMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.26), signMat);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.26), signMat);
      back.rotation.y = Math.PI;
      back.position.z = -0.004;
      mesh.add(back);
      const stick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.5, 5),
        new THREE.MeshStandardMaterial({ color: '#8b6a42', roughness: 0.8 }),
      );
      stick.position.y = -0.34;
      const g = new THREE.Group();
      g.add(mesh, stick);
      scene.add(g);
      m.hasSign = true;
      this.signs.push({ g, m, phase: Math.random() * 9 });
    });
  }

  _buildConfetti(scene) {
    const N = 900;
    this.confN = N;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    this.confVel = new Float32Array(N * 3);
    this.confLife = new Float32Array(N);
    for (let i = 0; i < N; i++) pos[i * 3 + 1] = -50;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.confetti = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.055, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, sizeAttenuation: true,
    }));
    this.confetti.frustumCulled = false;
    scene.add(this.confetti);
    this.confHead = 0;
  }

  burstConfetti(count = 260, origin = null) {
    const p = this.confetti.geometry.attributes.position.array;
    const c = this.confetti.geometry.attributes.color.array;
    const col = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const i = this.confHead = (this.confHead + 1) % this.confN;
      const side = Math.random() < 0.5 ? -1 : 1;
      const o = origin || new THREE.Vector3(side * (2.4 + Math.random() * 2.6), 2.4 + Math.random() * 1.6, Math.random() * 5 - 1);
      p[i * 3] = o.x; p[i * 3 + 1] = o.y; p[i * 3 + 2] = o.z;
      this.confVel[i * 3] = (Math.random() - 0.5) * 2.4 - side * 1.1;
      this.confVel[i * 3 + 1] = 1.4 + Math.random() * 3.4;
      this.confVel[i * 3 + 2] = (Math.random() - 0.5) * 2.2;
      this.confLife[i] = 2.6 + Math.random() * 2.4;
      col.setHSL(Math.random(), 0.85, 0.6);
      c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
    }
    this.confetti.geometry.attributes.position.needsUpdate = true;
    this.confetti.geometry.attributes.color.needsUpdate = true;
  }

  /**
   * @param {number} amount  -1 (dead silence / boo) … +1.6 (riot)
   * @param {number} spread  how much reaction time varies, seconds
   */
  react(amount, spread = 0.45) {
    for (const m of this.m) {
      const personal = amount * (0.45 + m.crazy * 0.95) * (0.75 + Math.random() * 0.5);
      m.pending += personal;
      m.delay = Math.random() * spread + (amount > 0 ? 0.04 : 0.16);
    }
    if (amount > 0.75) this.burstConfetti(Math.round(120 + amount * 220));
  }

  /** Ambient chatter level between throws. */
  setMood(v) { this.mood = v; }

  update(t, dt) {
    this.frame++;
    let sum = 0;

    for (let i = 0; i < this.n; i++) {
      const m = this.m[i];

      /* ---- energy ---- */
      if (m.pending !== 0) {
        m.delay -= dt;
        if (m.delay <= 0) {
          m.energy = THREE.MathUtils.clamp(m.energy + m.pending, -0.9, 1.7);
          m.pending = 0;
        }
      }
      const decay = dt * (0.42 + (1 - m.crazy) * 0.45);
      m.energy += m.energy > 0 ? -decay : decay * 0.7;
      if (Math.abs(m.energy) < 0.004) m.energy = 0;
      m.hype += (m.energy - m.hype) * Math.min(1, dt * 9);
      const h = m.hype;
      const ha = Math.max(0, h);
      sum += ha;

      /* ---- jumping ---- */
      if (m.jumpY > 0 || m.jumpV > 0) {
        m.jumpV -= 12.5 * dt;
        m.jumpY += m.jumpV * dt;
        if (m.jumpY <= 0) { m.jumpY = 0; m.jumpV = 0; }
      } else if (ha > 0.42 && Math.random() < dt * (ha * 3.4) * m.crazy) {
        m.jumpV = 1.3 + ha * m.crazy * 2.8;
      }

      /* ---- spinning (peak lunacy, flavour 2) ---- */
      const spinning = m.flavour === 2 && ha > 0.85;
      m.spin += spinning ? dt * (7 + ha * 9) * m.crazy : -m.spin * Math.min(1, dt * 4);

      const ph = t * m.rate + m.phase;
      const bob = Math.sin(ph * 1.7) * 0.012 + Math.sin(ph * 5.3) * 0.004;
      const clap = Math.max(0, Math.sin(ph * (7 + ha * 9)));
      const windmill = ph * (5 + ha * 12);

      /* ---- root transform ---- */
      const scl = m.scale;
      const bounce = ha > 0.12 ? Math.abs(Math.sin(ph * (5.5 + ha * 6))) * ha * 0.09 : 0;
      const y = m.home.y + bob + bounce + m.jumpY * 0.34;

      // slumping when the crowd sours
      const slump = h < 0 ? -h * 0.12 : 0;
      m.lean += (((h < 0 ? -0.35 : 0) + Math.sin(ph * 0.9) * 0.04 + ha * 0.22) - m.lean) * Math.min(1, dt * 5);

      /* ---- drink ----
         Drunkenness is a slow wander of the whole body: a wide low-frequency
         sway, a drifting stance, and a head that arrives somewhere near where
         it was aiming. It deliberately does not touch hype — a room can be
         legless and bored. */
      const dr = this.drunk * (0.35 + (1 - m.sober) * 1.2);
      const swayX = dr ? Math.sin(ph * 0.53 + m.phase) * dr * 0.085 : 0;
      const swayZ = dr ? Math.cos(ph * 0.41 + m.phase * 1.7) * dr * 0.07 : 0;
      const swayRoll = dr ? Math.sin(ph * 0.47 + m.phase * 0.3) * dr * 0.26 : 0;

      const yaw = m.baseYaw + m.spin + Math.sin(ph * 0.6) * 0.09 * (1 + ha)
        + (dr ? Math.sin(ph * 0.31 + m.phase) * dr * 0.5 : 0);
      _e.set(m.lean * -0.5 + swayZ * 1.4, yaw, Math.sin(ph * 1.3) * 0.05 * (1 + ha * 2) + swayRoll);
      _rootQ.setFromEuler(_e);
      _rootP.set(m.home.x + swayX, y - slump, m.home.z + swayZ);

      const put = (name, k, lp, lq, sx, sy, sz) => {
        _outP.copy(lp).applyQuaternion(_rootQ).add(_rootP);
        _outQ.copy(_rootQ).multiply(lq);
        _s.set(sx, sy, sz);
        _m.compose(_outP, _outQ, _s);
        const part = this.parts[name];
        part.mesh.setMatrixAt(i * part.per + k, _m);
      };

      const S = scl;

      /* ---- body ---- */
      const squash = 1 + Math.sin(ph * (6 + ha * 8)) * (0.02 + ha * 0.07);
      _lp.set(0, 0.30 * S * m.tall, 0);
      put('body', 0, _lp, _IQ,
        S * m.fat * (2 - squash), S * m.tall * squash, S * m.fat * 0.86 * (2 - squash));

      /* ---- head ---- */
      const headBob = Math.sin(ph * 2.4) * 0.012 + ha * Math.sin(ph * 11) * 0.03;
      const headTilt = Math.sin(ph * 1.1) * 0.14 + (h < 0 ? Math.sin(ph * 3) * 0.5 : 0);
      _e.set(
        -ha * 0.35 + (h < 0 ? 0.25 : 0),
        headTilt * (0.4 + ha),
        Math.sin(ph * 2.1) * 0.1 * (1 + ha * 2),
      );
      _headQ.setFromEuler(_e);
      _headP.set(0, (0.60 * m.tall + 0.06) * S + headBob, 0);
      const headScale = S * (1 + ha * 0.06);
      put('head', 0, _headP, _headQ, headScale * m.fat * 0.92, headScale, headScale * 0.94);

      // a point in head space -> muppet space, written into `out`
      const inHead = (x, yy, z, out) => out.set(x * S, yy * S, z * S).applyQuaternion(_headQ).add(_headP);

      /* ---- mouth (jaw drop scales with hype) ---- */
      const gape = 0.1 + ha * 1.5 + (h < 0 ? 0.5 : 0);
      _e.set(Math.PI * 0.5 + 0.35, 0, 0);
      _tmpQ.copy(_headQ).multiply(_eq.setFromEuler(_e));
      put('mouth', 0, inHead(0, -0.05, 0.17, _lp), _tmpQ,
        S * 0.9, S * Math.min(1.5, gape) * 0.9, S * 0.5);

      /* ---- nose ---- */
      put('nose', 0, inHead(0, 0.03, 0.24, _lp), _headQ, S * 1.1, S * 0.95, S * 1.35);

      /* ---- eyes: googly, bug out with hype ---- */
      const blinkT = (t + m.blink) % 4.2;
      const blink = blinkT < 0.11 ? 0.12 : 1;
      const eyeS = S * (1 + ha * 0.42);
      for (let k = 0; k < 2; k++) {
        const sx = k === 0 ? -1 : 1;
        put('eye', k, inHead(sx * 0.115, 0.185, 0.135, _lp), _headQ, eyeS, eyeS * blink, eyeS);
        // pupils wander, then lock wide open
        const wob = ha > 0.6 ? 0 : 0.022;
        const pxo = Math.sin(ph * 1.9 + k) * wob;
        const pyo = Math.cos(ph * 1.4 + k * 2) * wob;
        inHead(sx * 0.115 + pxo, 0.185 + pyo, 0.135 + 0.062 * (1 + ha * 0.42), _lp2);
        const ps = S * (h < -0.3 ? 0.7 : 1) * (1 + ha * 0.1);
        put('pupil', k, _lp2, _headQ, ps, ps * blink, ps);
      }

      /* ---- hair: three tufts, flail with hype ---- */
      for (let k = 0; k < 3; k++) {
        const a = (k - 1) * 0.5;
        const flail = Math.sin(ph * (4 + ha * 14) + k * 2.1) * (0.12 + ha * 1.05);
        _e.set(flail * 0.7, 0, a * 0.9 + flail);
        _tmpQ.copy(_headQ).multiply(_eq.setFromEuler(_e));
        put('hair', k, inHead(a * 0.11, 0.235, -0.01, _lp), _tmpQ, S, S * (1 + ha * 0.5), S);
      }

      /* ---- arms ---- */
      const shoulderY = (0.46 * m.tall + 0.02) * S;
      for (let k = 0; k < 2; k++) {
        const sx = k === 0 ? -1 : 1;
        let uPitch, uRoll, lPitch;
        if (h < -0.25) {                                   // arms folded, disgusted
          uPitch = -0.4; uRoll = sx * 0.55; lPitch = -1.7;
        } else if (ha < 0.16) {                            // resting
          uPitch = Math.sin(ph * 1.2 + k) * 0.12; uRoll = sx * (0.18 + Math.sin(ph) * 0.04); lPitch = -0.35;
        } else if (m.flavour === 0 || ha > 1.05) {         // windmill
          uPitch = Math.sin(windmill + k * Math.PI) * (0.6 + ha * 2.4);
          uRoll = sx * (0.3 + ha * 0.9);
          lPitch = Math.cos(windmill * 1.3 + k) * (0.4 + ha);
        } else if (m.flavour === 1) {                      // straight up, shaking
          uPitch = -2.5 * ha + Math.sin(ph * 16) * 0.18 * ha;
          uRoll = sx * (0.25 + ha * 0.5);
          lPitch = Math.sin(ph * 18 + k) * 0.35 * ha;
        } else if (m.flavour === 3) {                      // clapping
          uPitch = -0.5 - clap * 0.35 * ha;
          uRoll = sx * (0.62 - clap * 0.5) * (0.6 + ha);
          lPitch = -1.15 - clap * 0.25;
        } else {                                           // fists pumping
          uPitch = -1.1 * ha + Math.sin(ph * (9 + ha * 8) + k * 1.7) * (0.5 + ha * 1.1);
          uRoll = sx * (0.34 + ha * 0.42);
          lPitch = -1.0 + Math.sin(ph * (9 + ha * 8) + k * 1.7 + 1) * 0.6;
        }

        // just proud of the body's silhouette at shoulder height: further out and
        // the arm reads as a detached floating cylinder
        _shoulder.set(sx * 0.265 * S * m.fat, shoulderY, 0.02 * S);
        _e.set(uPitch, 0, uRoll);
        _tmpQ.setFromEuler(_e);                            // upper-arm rotation
        put('armU', k, _shoulder, _tmpQ, S, S, S);

        _elbow.set(0, -0.24 * S, 0).applyQuaternion(_tmpQ).add(_shoulder);
        _e.set(lPitch, 0, 0);
        _tmpQ2.copy(_tmpQ).multiply(_eq.setFromEuler(_e));  // forearm rotation
        put('armL', k, _elbow, _tmpQ2, S, S, S);

        _hand.set(0, -0.22 * S, 0).applyQuaternion(_tmpQ2).add(_elbow);
        const hs = S * (1 + ha * 0.14);
        put('hand', k, _hand, _IQ, hs, hs, hs);

        // the right hand in world space: where a pint sits, and where anything
        // thrown at the table leaves from
        if (k === 1 && m.handW) m.handW.copy(_hand).applyQuaternion(_rootQ).add(_rootP);
        if (k === 1 && m.hasMug && this.mugMesh) {
          _lp2.copy(_hand).add(_s.set(0, 0.055 * S, 0));
          _outP.copy(_lp2).applyQuaternion(_rootQ).add(_rootP);
          // a drink stays roughly upright no matter what its owner is doing
          _tmpQ.set(0, 0, 0, 1).slerp(_rootQ, 0.25);
          _s.set(S, S, S);
          _m.compose(_outP, _tmpQ, _s);
          this.mugMesh.setMatrixAt(m.mugSlot, _m);
        }

        /* ---- legs ---- */
        let legPitch;
        if (m.sit) {
          const kick = ha > 0.3 ? Math.sin(ph * (8 + ha * 7) + k * 2) * ha * 0.7 : Math.sin(ph * 1.4 + k) * 0.09;
          legPitch = 1.15 + kick;                           // knees forward off the bench
        } else {
          legPitch = Math.sin(ph * (3 + ha * 6) + k * 3.14) * (0.06 + ha * 0.5);
        }
        _hip.set(sx * 0.145 * S * m.fat, 0.14 * S * m.tall, 0.08 * S);
        _e.set(legPitch, 0, sx * 0.06);
        _tmpQ.setFromEuler(_e);
        put('legU', k, _hip, _tmpQ, S, S, S);
        _foot.set(0, -0.26 * S, 0).applyQuaternion(_tmpQ).add(_hip);
        put('foot', k, _foot, _tmpQ, S, S, S);
      }
    }

    for (const k in this.parts) this.parts[k].mesh.instanceMatrix.needsUpdate = true;
    if (this.mugMesh) this.mugMesh.instanceMatrix.needsUpdate = true;

    this.globalHype = this.n ? sum / this.n : 0;

    /* ---- signs ride the holder ---- */
    for (const s of this.signs) {
      const m = s.m;
      const ha = Math.max(0, m.hype);
      const shake = Math.sin(t * (5 + ha * 16) + s.phase) * (0.1 + ha * 0.7);
      s.g.position.set(
        m.home.x + Math.sin(t * 1.1 + s.phase) * 0.04,
        m.home.y + (1.42 * m.scale) + m.jumpY * 0.34 + ha * 0.34 + Math.sin(t * 2 + s.phase) * 0.02,
        m.home.z - 0.05,
      );
      s.g.rotation.set(0, m.baseYaw, shake * 0.5);
      s.g.children[0].rotation.z = shake;
    }

    /* ---- confetti ---- */
    const cp = this.confetti.geometry.attributes.position.array;
    let live = false;
    for (let i = 0; i < this.confN; i++) {
      if (this.confLife[i] <= 0) continue;
      live = true;
      this.confLife[i] -= dt;
      this.confVel[i * 3 + 1] -= 2.4 * dt;    // paper flutters down, it doesn't drop
      this.confVel[i * 3] *= 0.985;
      this.confVel[i * 3 + 2] *= 0.985;
      cp[i * 3] += this.confVel[i * 3] * dt + Math.sin(t * 6 + i) * 0.004;
      cp[i * 3 + 1] += this.confVel[i * 3 + 1] * dt;
      cp[i * 3 + 2] += this.confVel[i * 3 + 2] * dt;
      if (cp[i * 3 + 1] < 0.02 || this.confLife[i] <= 0) { this.confLife[i] = 0; cp[i * 3 + 1] = -50; }
    }
    if (live) this.confetti.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    }
    for (const s of this.signs) {
      this.scene.remove(s.g);
      s.g.children.forEach((c) => { c.geometry.dispose(); c.material.map?.dispose(); c.material.dispose(); });
    }
    this.scene.remove(this.confetti);
    this.confetti.geometry.dispose();
    this.confetti.material.dispose();
    this.fuzz.dispose();
  }
}

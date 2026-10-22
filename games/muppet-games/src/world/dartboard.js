import * as THREE from 'three';

/**
 * Regulation clock board, in metres. Radii are the real BDO/WDF spec
 * (bull 12.7mm dia, treble band 99-107mm, double band 162-170mm).
 */
export const R = {
  bull: 0.00635,
  outerBull: 0.0159,
  trebleIn: 0.099,
  trebleOut: 0.107,
  doubleIn: 0.162,
  doubleOut: 0.170,
  numbersIn: 0.178,
  face: 0.2255,
};

/** Wire order, clockwise starting at the top. */
export const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

export const BOARD_HEIGHT = 1.73;   // bull centre off the floor
export const OCHE_DIST = 2.37;      // oche to board face, along the floor

const CREAM = new THREE.Color('#e8dcb8');
const BLACK = new THREE.Color('#15130f');
const RED = new THREE.Color('#c62222');
const GREEN = new THREE.Color('#1d8a3f');

const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

/**
 * Score a hit given board-local coordinates (metres, origin at the bull).
 * Returns null-ish (value 0) for anything off the scoring area.
 */
export function scoreAt(x, y) {
  const r = Math.hypot(x, y);

  if (r <= R.bull) return { value: 50, base: 50, mult: 1, ring: 'bull', label: 'BULL', sector: 50 };
  if (r <= R.outerBull) return { value: 25, base: 25, mult: 1, ring: 'outerBull', label: '25', sector: 25 };
  if (r > R.doubleOut) return { value: 0, base: 0, mult: 0, ring: 'off', label: 'MISS', sector: 0 };

  const deg = Math.atan2(y, x) / DEG;
  let idx = Math.round((90 - deg) / 18) % 20;
  if (idx < 0) idx += 20;
  const base = SECTORS[idx];

  let mult = 1, ring = 'single';
  if (r > R.trebleIn && r <= R.trebleOut) { mult = 3; ring = 'treble'; }
  else if (r > R.doubleIn) { mult = 2; ring = 'double'; }

  const label = mult === 3 ? `T${base}` : mult === 2 ? `D${base}` : `${base}`;
  return { value: base * mult, base, mult, ring, label, sector: base, sectorIndex: idx };
}

/** True when the point sits close enough to a wire to plausibly bounce out. */
export function nearWire(x, y) {
  const r = Math.hypot(x, y);
  if (r > R.doubleOut + 0.004) return false;
  const RADII = [R.bull, R.outerBull, R.trebleIn, R.trebleOut, R.doubleIn, R.doubleOut];
  for (const rr of RADII) if (Math.abs(r - rr) < 0.0016) return true;
  if (r < R.outerBull) return false;
  const deg = Math.atan2(y, x) / DEG;
  const off = ((deg - 90) % 18 + 18 + 9) % 18 - 9;   // signed distance to sector centre, deg
  return Math.abs(Math.abs(off) - 9) * DEG * r < 0.0016;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

function pushWedge(pos, col, nrm, r0, r1, a0, a1, color, z, seg = 8) {
  for (let s = 0; s < seg; s++) {
    const t0 = a0 + (a1 - a0) * (s / seg);
    const t1 = a0 + (a1 - a0) * ((s + 1) / seg);
    const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
    const p = [
      [r0 * c0, r0 * s0], [r1 * c0, r1 * s0], [r1 * c1, r1 * s1],
      [r0 * c0, r0 * s0], [r1 * c1, r1 * s1], [r0 * c1, r0 * s1],
    ];
    for (const [px, py] of p) {
      pos.push(px, py, z);
      nrm.push(0, 0, 1);
      col.push(color.r, color.g, color.b);
    }
  }
}

function ringQuads(pos, nrm, r, half, z, seg = 128) {
  for (let s = 0; s < seg; s++) {
    const t0 = (s / seg) * Math.PI * 2, t1 = ((s + 1) / seg) * Math.PI * 2;
    const a = [Math.cos(t0), Math.sin(t0)], b = [Math.cos(t1), Math.sin(t1)];
    const q = [
      [(r - half) * a[0], (r - half) * a[1]], [(r + half) * a[0], (r + half) * a[1]],
      [(r + half) * b[0], (r + half) * b[1]],
      [(r - half) * a[0], (r - half) * a[1]], [(r + half) * b[0], (r + half) * b[1]],
      [(r - half) * b[0], (r - half) * b[1]],
    ];
    for (const [px, py] of q) { pos.push(px, py, z); nrm.push(0, 0, 1); }
  }
}

function radialQuads(pos, nrm, r0, r1, half, z) {
  for (let i = 0; i < 20; i++) {
    const a = (90 - i * 18 - 9) * DEG;
    const c = Math.cos(a), s = Math.sin(a);
    const nx = -s * half, ny = c * half;
    const q = [
      [r0 * c - nx, r0 * s - ny], [r1 * c - nx, r1 * s - ny], [r1 * c + nx, r1 * s + ny],
      [r0 * c - nx, r0 * s - ny], [r1 * c + nx, r1 * s + ny], [r0 * c + nx, r0 * s + ny],
    ];
    for (const [px, py] of q) { pos.push(px, py, z); nrm.push(0, 0, 1); }
  }
}

function numbersTexture() {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.translate(S / 2, S / 2);
  g.fillStyle = '#efe7d2';
  g.font = '700 62px "Barlow Condensed", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const rPix = ((R.numbersIn + R.face) / 2 / R.face) * (S / 2);
  for (let i = 0; i < 20; i++) {
    const a = (90 - i * 18) * DEG;
    g.save();
    g.translate(Math.cos(a) * rPix, -Math.sin(a) * rPix);
    g.rotate(-(a - Math.PI / 2));
    g.fillText(String(SECTORS[i]), 0, 0);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function buildDartboard() {
  const group = new THREE.Group();
  group.name = 'dartboard';

  /* --- sisal face: coloured wedges ------------------------------- */
  const pos = [], col = [], nrm = [];
  const Z = 0;

  for (let i = 0; i < 20; i++) {
    const a0 = (90 - i * 18 - 9) * DEG;
    const a1 = (90 - i * 18 + 9) * DEG;
    const light = i % 2 === 1;
    const single = light ? CREAM : BLACK;
    const multi = light ? GREEN : RED;
    pushWedge(pos, col, nrm, R.outerBull, R.trebleIn, a0, a1, single, Z);
    pushWedge(pos, col, nrm, R.trebleIn, R.trebleOut, a0, a1, multi, Z);
    pushWedge(pos, col, nrm, R.trebleOut, R.doubleIn, a0, a1, single, Z);
    pushWedge(pos, col, nrm, R.doubleIn, R.doubleOut, a0, a1, multi, Z);
  }
  pushWedge(pos, col, nrm, 0, R.bull, 0, Math.PI * 2, RED, Z, 48);
  pushWedge(pos, col, nrm, R.bull, R.outerBull, 0, Math.PI * 2, GREEN, Z, 48);
  pushWedge(pos, col, nrm, R.doubleOut, R.face, 0, Math.PI * 2, new THREE.Color('#0c0b0a'), Z - 0.0004, 64);

  const faceGeo = new THREE.BufferGeometry();
  faceGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  faceGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  faceGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const face = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.94, metalness: 0.0,
  }));
  face.receiveShadow = true;
  face.name = 'boardFace';
  group.add(face);

  /* --- spider (the wires) ---------------------------------------- */
  const wp = [], wn = [];
  const WZ = 0.0016, HW = 0.00085;
  for (const r of [R.bull, R.outerBull, R.trebleIn, R.trebleOut, R.doubleIn, R.doubleOut]) {
    ringQuads(wp, wn, r, HW, WZ);
  }
  radialQuads(wp, wn, R.outerBull, R.doubleOut, HW, WZ);
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  wireGeo.setAttribute('normal', new THREE.Float32BufferAttribute(wn, 3));
  const wires = new THREE.Mesh(wireGeo, new THREE.MeshStandardMaterial({
    color: '#cfd3d8', roughness: 0.24, metalness: 1.0,
  }));
  wires.name = 'spider';
  group.add(wires);

  /* --- number ring ------------------------------------------------ */
  const nums = new THREE.Mesh(
    new THREE.PlaneGeometry(R.face * 2, R.face * 2),
    new THREE.MeshBasicMaterial({ map: numbersTexture(), transparent: true, depthWrite: false }),
  );
  nums.position.z = 0.0022;
  group.add(nums);

  /* --- surround / backing ----------------------------------------- */
  const surround = new THREE.Mesh(
    new THREE.CylinderGeometry(R.face + 0.028, R.face + 0.028, 0.044, 64, 1, true),
    new THREE.MeshStandardMaterial({ color: '#1b1a1f', roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide }),
  );
  surround.rotation.x = Math.PI / 2;
  surround.position.z = -0.022;
  group.add(surround);

  const back = new THREE.Mesh(
    new THREE.CircleGeometry(R.face + 0.028, 64),
    new THREE.MeshStandardMaterial({ color: '#0e0d10', roughness: 0.9 }),
  );
  back.position.z = -0.044;
  back.rotation.y = Math.PI;
  group.add(back);

  group.position.set(0, BOARD_HEIGHT, 0);
  group.userData.faceMesh = face;
  return group;
}

/** Little arc of light that flares when the board is struck. */
export function buildBoardLight() {
  const l = new THREE.PointLight(0xffe0b0, 0, 2.4, 2);
  l.position.set(0, BOARD_HEIGHT, 0.25);
  return l;
}

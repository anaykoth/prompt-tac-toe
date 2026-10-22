import * as THREE from 'three';
import { mulberry32 } from '../pool/physics.js';
import { hashString, today } from './wallet.js';

/**
 * The guess-the-jar game.
 *
 * The contents are real, separate, non-intersecting bodies: they are dropped
 * into the jar and settled with a small relaxation solver, so the number you
 * are guessing at is the number of things actually in there. Everything is
 * seeded off the date, so every player gets the same jar on the same day and
 * the answer can be checked without a server.
 */

export const CONTENTS = [
  { id: 'beans', name: 'BEANS', r: 0.011, colour: ['#8a5a2b', '#6b4420', '#a06a34'], shape: 'bean' },
  { id: 'marbles', name: 'MARBLES', r: 0.0125, colour: ['#3d7fd8', '#d84f4f', '#4fd88a', '#f0d24a'], shape: 'sphere' },
  { id: 'kiwis', name: 'KIWIS', r: 0.031, colour: ['#7a6135', '#8b6f3c'], shape: 'egg' },
  { id: 'birds', name: 'SMALL BIRDS (CERAMIC)', r: 0.027, colour: ['#e8e2d2', '#d8b04a', '#7fa9d8'], shape: 'bird' },
  { id: 'sand', name: 'PEBBLES', r: 0.008, colour: ['#c9bb9a', '#a89577', '#ded0ad'], shape: 'rock' },
  { id: 'bullets', name: 'BULLETS (SPENT)', r: 0.0105, colour: ['#b8912f', '#9a7a28'], shape: 'cylinder' },
  { id: 'burgers', name: 'TINY BURGERS', r: 0.026, colour: ['#c98a3c', '#8b5a2b'], shape: 'burger' },
  { id: 'fish', name: 'FISH (PLASTIC)', r: 0.024, colour: ['#e07a3a', '#4f9fd8', '#d8d04a'], shape: 'fish' },
  { id: 'teeth', name: 'TEETH', r: 0.0095, colour: ['#efe8d4', '#e2d8bc'], shape: 'tooth' },
  { id: 'eyes', name: 'GOOGLY EYES', r: 0.014, colour: ['#fdfbf4'], shape: 'sphere' },
];

export const JAR = { radius: 0.115, height: 0.30, wall: 0.006 };

/** Which contents, and how many, for a given day. */
export function jarPlanFor(date = today()) {
  const rng = mulberry32(hashString('jar:' + date));
  const kind = CONTENTS[Math.floor(rng() * CONTENTS.length)];
  // fill fraction varies day to day so the answer is never "about the same"
  const fill = 0.42 + rng() * 0.45;
  return { kind, fill, rng, date };
}

/**
 * Drop bodies in and settle them. Returns the resting positions — the length of
 * that array IS the answer, so it must never be fudged.
 */
export function packJar(plan, opts = {}) {
  const { kind, fill } = plan;
  const rng = mulberry32(hashString('pack:' + plan.date));
  const R = JAR.radius - JAR.wall;
  const r = kind.r;

  /* How many to try to fit. Capped at both ends on purpose: a jar of 2,600
     pebbles is neither guessable nor solvable, and six of anything is not a
     competition. */
  const targetH = JAR.height * fill;
  const volume = Math.PI * R * R * targetH;
  const each = (4 / 3) * Math.PI * r * r * r;
  const count = Math.max(28, Math.min(440, Math.floor((volume / each) * 0.58)));

  const items = [];
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * Math.max(0, R - r * 1.2);
    items.push({
      x: Math.cos(a) * rad,
      z: Math.sin(a) * rad,
      // start as a loose column above the jar and let them fall in
      y: r + (i / count) * JAR.height * 3.4 + rng() * r,
      colour: kind.colour[Math.floor(rng() * kind.colour.length)],
      spin: [rng() * 6.3, rng() * 6.3, rng() * 6.3],
      scale: 0.86 + rng() * 0.28,
    });
  }

  const rOf = (it) => r * it.scale;

  /** Back inside the glass: the cylinder wall and the base. */
  const constrain = (it) => {
    const ir = rOf(it);
    if (it.y < ir) it.y = ir;
    const d = Math.hypot(it.x, it.z);
    const lim = R - ir;
    if (lim <= 0) { it.x = 0; it.z = 0; return; }
    if (d > lim) {
      const k = lim / (d || 1);
      it.x *= k; it.z *= k;
    }
  };

  /* A uniform grid keyed on the largest body, so separation stays linear even
     with a few hundred items and can afford enough passes to actually settle. */
  const cell = r * 2.4;
  const grid = new Map();
  const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const rebuild = () => {
    grid.clear();
    for (const it of items) {
      const k = key(it.x, it.y, it.z);
      let arr = grid.get(k);
      if (!arr) grid.set(k, arr = []);
      arr.push(it);
    }
  };

  /** One separation sweep. Returns the worst overlap seen, as a fraction. */
  const separate = () => {
    rebuild();
    let worst = 0;
    for (const it of items) {
      const cx = Math.floor(it.x / cell), cy = Math.floor(it.y / cell), cz = Math.floor(it.z / cell);
      for (let gx = -1; gx <= 1; gx++) {
        for (let gy = -1; gy <= 1; gy++) {
          for (let gz = -1; gz <= 1; gz++) {
            const arr = grid.get(`${cx + gx},${cy + gy},${cz + gz}`);
            if (!arr) continue;
            for (const other of arr) {
              if (other === it) continue;
              const dx = other.x - it.x, dy = other.y - it.y, dz = other.z - it.z;
              const min = rOf(it) + rOf(other);
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 >= min * min) continue;
              let d = Math.sqrt(d2);
              let nx, ny, nz;
              if (d < 1e-9) {                    // exactly coincident: shove apart
                nx = 0; ny = 1; nz = 0; d = 1e-9;
              } else {
                nx = dx / d; ny = dy / d; nz = dz / d;
              }
              const overlap = min - d;
              if (overlap / min > worst) worst = overlap / min;
              const push = overlap * 0.5;
              it.x -= nx * push; it.y -= ny * push; it.z -= nz * push;
              other.x += nx * push; other.y += ny * push; other.z += nz * push;
              constrain(it);
              constrain(other);
            }
          }
        }
      }
    }
    return worst;
  };

  /* ---- settle: gravity, then separation until it stops overlapping ---- */
  const settleSteps = opts.iterations ?? 200;
  for (let step = 0; step < settleSteps; step++) {
    const drop = step < settleSteps * 0.6 ? 0.006 : 0.002;
    for (const it of items) { it.y -= drop; constrain(it); }
    separate();
    separate();
  }

  /* ---- then push until the pack is genuinely clean ---- */
  let worst = 1;
  for (let i = 0; i < 600 && worst > 0.004; i++) worst = separate();

  /* Anything still overlapping after all that does not get to exist — the
     count has to be the truth, so a body we could not place is dropped rather
     than left interpenetrating. */
  if (worst > 0.004) {
    for (let guard = 0; guard < 60 && worst > 0.004; guard++) {
      rebuild();
      let victim = null, victimOverlap = 0;
      for (const it of items) {
        for (const other of items) {
          if (other === it) continue;
          const min = rOf(it) + rOf(other);
          const d = Math.hypot(other.x - it.x, other.y - it.y, other.z - it.z);
          const o = (min - d) / min;
          if (o > victimOverlap) { victimOverlap = o; victim = it; }
        }
      }
      if (!victim || victimOverlap <= 0.004) break;
      items.splice(items.indexOf(victim), 1);
      for (let i = 0; i < 40; i++) worst = separate();
    }
  }

  // and anything sitting proud of the rim has fallen out, so it is not in the jar
  const inside = items.filter((it) => it.y < JAR.height - rOf(it) * 0.5);
  return { kind, items: inside, count: inside.length };
}

/* ------------------------------------------------------------------ */
/* Meshes                                                              */
/* ------------------------------------------------------------------ */

function shapeGeometry(shape, r) {
  switch (shape) {
    case 'bean': {
      const g = new THREE.SphereGeometry(r, 8, 6);
      g.scale(1.5, 0.8, 0.85);
      return g;
    }
    case 'egg': {
      const g = new THREE.SphereGeometry(r, 10, 8);
      g.scale(1.25, 0.85, 0.85);
      return g;
    }
    case 'rock': {
      const g = new THREE.DodecahedronGeometry(r, 0);
      g.scale(1.1, 0.8, 0.95);
      return g;
    }
    case 'cylinder':
      return new THREE.CylinderGeometry(r * 0.55, r * 0.62, r * 2.4, 8);
    case 'tooth': {
      const g = new THREE.ConeGeometry(r * 0.8, r * 2.2, 6);
      g.rotateX(Math.PI);
      return g;
    }
    case 'bird': {
      const g = new THREE.SphereGeometry(r, 8, 7);
      g.scale(1.35, 0.9, 0.8);
      return g;
    }
    case 'burger':
      return new THREE.CylinderGeometry(r, r * 0.92, r * 1.5, 10);
    case 'fish': {
      const g = new THREE.SphereGeometry(r, 8, 6);
      g.scale(1.7, 0.75, 0.45);
      return g;
    }
    default:
      return new THREE.SphereGeometry(r, 10, 8);
  }
}

/** A glass jar with a lid, on a base, filled with the day's contents. */
export function buildJar(packed) {
  const group = new THREE.Group();
  const { kind, items } = packed;

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xdfeee8, roughness: 0.06, metalness: 0,
    transmission: 0.86, thickness: 0.02, transparent: true, opacity: 0.34,
    side: THREE.DoubleSide,
  });
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(JAR.radius, JAR.radius * 0.94, JAR.height, 30, 1, true),
    glass,
  );
  body.position.y = JAR.height / 2;
  group.add(body);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(JAR.radius * 0.94, JAR.radius * 0.94, 0.008, 30),
    glass,
  );
  base.position.y = 0.004;
  group.add(base);

  const lid = new THREE.Mesh(
    new THREE.CylinderGeometry(JAR.radius * 1.04, JAR.radius * 1.04, 0.028, 30),
    new THREE.MeshStandardMaterial({ color: '#8d6a3a', roughness: 0.4, metalness: 0.7 }),
  );
  lid.position.y = JAR.height + 0.012;
  group.add(lid);

  /* contents — one instanced mesh, coloured per item */
  const geo = shapeGeometry(kind.shape, kind.r);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.06 });
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const col = new THREE.Color();
  items.forEach((it, i) => {
    e.set(it.spin[0], it.spin[1], it.spin[2]);
    q.setFromEuler(e);
    v.set(it.x, it.y, it.z);
    s.setScalar(it.scale);
    m.compose(v, q, s);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, col.set(it.colour));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  group.add(mesh);

  // googly eyes get pupils, because of course they do
  if (kind.id === 'eyes') {
    const pupil = new THREE.InstancedMesh(
      new THREE.SphereGeometry(kind.r * 0.45, 6, 5),
      new THREE.MeshStandardMaterial({ color: 0x0a090c, roughness: 0.2 }),
      items.length,
    );
    items.forEach((it, i) => {
      e.set(it.spin[0], it.spin[1], it.spin[2]);
      q.setFromEuler(e);
      v.set(it.x, it.y, it.z).add(
        new THREE.Vector3(0, 0, kind.r * 0.62).applyQuaternion(q),
      );
      s.setScalar(it.scale);
      m.compose(v, q, s);
      pupil.setMatrixAt(i, m);
    });
    pupil.instanceMatrix.needsUpdate = true;
    group.add(pupil);
  }

  return { group, count: items.length, kind };
}

/**
 * The day's jar, computed once and cached. Packing takes about half a second,
 * which is fine once a day and not fine on every page load.
 */
export function dailyJar(storage = globalThis.localStorage, date = today()) {
  const key = `fuzz-and-feather:jar:${date}`;
  try {
    const raw = storage?.getItem(key);
    if (raw) {
      const cached = JSON.parse(raw);
      const kind = CONTENTS.find((c) => c.id === cached.kindId);
      if (kind && Array.isArray(cached.items)) {
        return { kind, items: cached.items, count: cached.items.length };
      }
    }
  } catch { /* fall through and recompute */ }

  const packed = packJar(jarPlanFor(date));
  try {
    // drop yesterday's, there is no reason to keep it
    for (let i = storage.length - 1; i >= 0; i--) {
      const k = storage.key(i);
      if (k && k.startsWith('fuzz-and-feather:jar:') && k !== key) storage.removeItem(k);
    }
    storage?.setItem(key, JSON.stringify({ kindId: packed.kind.id, items: packed.items }));
  } catch { /* private mode: just recompute next time */ }
  return packed;
}

/** The handwritten card taped to the jar. */
export function jarSignTexture(kind) {
  const W = 384, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#efe4c6';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#3a2a18';
  g.lineWidth = 5;
  g.strokeRect(9, 9, W - 18, H - 18);
  g.fillStyle = '#2c2013';
  g.textAlign = 'center';
  g.font = '700 44px "Barlow Condensed", Impact, sans-serif';
  g.fillText('GUESS HOW MANY', W / 2, 68);
  g.font = '700 40px "Barlow Condensed", Impact, sans-serif';
  g.fillText(kind.name, W / 2, 118);
  g.font = '400 24px "Barlow Condensed", Impact, sans-serif';
  g.fillText('ONE GO A DAY', W / 2, 166);
  g.fillText('CLOSEST WINS. NO SHAKING.', W / 2, 196);
  g.font = '400 18px "Barlow Condensed", Impact, sans-serif';
  g.fillText('THE LANDLORD’S DECISION IS FINAL', W / 2, 226);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

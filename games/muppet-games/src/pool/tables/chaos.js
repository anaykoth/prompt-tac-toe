import { TABLE, BALL_R, makeBall, mulberry32, finishGeometry } from '../physics.js';
import { polygonGeometry, polygonMesh, inPolygon, distToEdge } from './polygon.js';

/**
 * The chaos table.
 *
 * A randomly generated slab of slate: irregular outline, pockets at some of the
 * corners, free-standing barriers to bank off, and holes cut straight through
 * the middle of the cloth. A different table every rack, and every one of them
 * obeys the same physics as the bar box.
 *
 * The two things that make an irregular table cheat, both handled here:
 *
 *  - A free-standing wall is a one-way wall. A cushion carries one inward
 *    normal, so a lone segment is invisible from behind and balls pass straight
 *    through it. Every barrier is a pair of opposed segments with capped ends.
 *  - A hole in open cloth is not a rail pocket. Built out of a ring of rail
 *    pockets it acquires a six-pointed star of facings that flick passing balls
 *    inward — a magnet, not a hole. Islands are their own kind: no mouth, no
 *    shelf, no facings, and a ball drops when it is genuinely over the hole.
 */

/* The layout is regenerated per rack. A fixed seed would make "randomly
   generated" a claim rather than a fact, and the point is that you have not
   seen this table before. */
let seed = (Math.random() * 1e9) | 0;

/**
 * An irregular outline, convex by construction.
 *
 * Convexity is not an aesthetic choice: a reflex corner can pinch tighter than
 * a ball and hold it for ever, and it makes "inside" unambiguous for the cloth
 * cut, the rack and ball-in-hand alike.
 */
function buildOutline(rng) {
  const n = 9 + Math.floor(rng() * 6);           // 9 to 14 points before hulling
  const stretch = 1.15 + rng() * 0.45;           // some long, some squat
  const squash = 0.72 + rng() * 0.26;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (rng() - 0.5) * (Math.PI / n) * 0.9;
    const r = 1.0 + rng() * 0.42;
    pts.push({ x: Math.cos(a) * r * stretch, z: Math.sin(a) * r * squash });
  }
  return convexHull(pts);
}

/** Andrew's monotone chain, so the outline can never have a reflex corner. */
function convexHull(pts) {
  const p = pts.slice().sort((a, b) => (a.x - b.x) || (a.z - b.z));
  const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const half = (src) => {
    const out = [];
    for (const q of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return half(p).concat(half(p.slice().reverse()));
}

/**
 * Pockets at corners with cushion to spare either side. Chosen by rule rather
 * than at random, so however the outline came out the table is playable and no
 * two mouths ever eat the same edge.
 */
function choosePockets(outline, mouth) {
  const n = outline.length;
  const edge = (i) => Math.hypot(
    outline[(i + 1) % n].x - outline[i].x, outline[(i + 1) % n].z - outline[i].z);
  const chosen = [];
  for (let i = 0; i < n; i++) {
    const prev = chosen[chosen.length - 1];
    if (prev !== undefined && i - prev < 2) continue;
    if (edge(i) < mouth * 2.2 || edge((i - 1 + n) % n) < mouth * 2.2) continue;
    chosen.push(i);
  }
  if (chosen.length > 2 && chosen[chosen.length - 1] === n - 1 && chosen[0] === 0) chosen.pop();
  return chosen;
}

/** A wall in open cloth: two opposed faces and a rounded cap at each end. */
function barrier(x, z, angle, half, thick = 0.030) {
  const ux = Math.cos(angle), uz = Math.sin(angle);
  const nx = -uz, nz = ux;
  const cushions = [];
  for (const s of [1, -1]) {
    cushions.push({
      ax: x + ux * half + nx * s * (thick / 2), az: z + uz * half + nz * s * (thick / 2),
      bx: x - ux * half + nx * s * (thick / 2), bz: z - uz * half + nz * s * (thick / 2),
      nx: nx * s, nz: nz * s,
    });
  }
  const jaws = [
    { x: x + ux * half, z: z + uz * half, r: thick / 2 },
    { x: x - ux * half, z: z - uz * half, r: thick / 2 },
  ];
  return { cushions, jaws, x, z, angle, half, thick };
}

/* ------------------------------------------------------------------ */

function build(s = seed) {
  const rng = mulberry32(s);
  const outline = buildOutline(rng);
  const MOUTH = 0.125;
  const pocketAt = choosePockets(outline, MOUTH);

  const halfLen = Math.max(...outline.map((p) => Math.abs(p.x)));
  const halfWid = Math.max(...outline.map((p) => Math.abs(p.z)));

  /* Somewhere in open cloth, clear of the rim and of everything already placed.
     Rejection sampling rather than arithmetic, because the outline is a
     different shape every time and there is nothing to solve against. */
  const taken = [];
  const findSpot = (clearance, tries = 400) => {
    for (let i = 0; i < tries; i++) {
      const x = (rng() - 0.5) * halfLen * 1.5;
      const z = (rng() - 0.5) * halfWid * 1.5;
      if (!inPolygon(outline, x, z)) continue;
      if (distToEdge(outline, x, z) < clearance + BALL_R * 3) continue;
      if (taken.some((p) => Math.hypot(p.x - x, p.z - z) < p.clear + clearance)) continue;
      taken.push({ x, z, clear: clearance });
      return { x, z };
    }
    return null;
  };

  const barriers = [];
  for (let i = 0, want = 1 + (rng() < 0.55 ? 1 : 0); i < want; i++) {
    const half = 0.20 + rng() * 0.20;
    const spot = findSpot(half + BALL_R * 3);
    if (spot) barriers.push(barrier(spot.x, spot.z, rng() * Math.PI, half));
  }

  const islands = [];
  for (let i = 0, want = 1 + (rng() < 0.4 ? 1 : 0); i < want; i++) {
    const r = 0.075 + rng() * 0.035;
    const spot = findSpot(r + BALL_R * 3);
    if (spot) islands.push({ x: spot.x, z: spot.z, r });
  }

  return { outline, pocketAt, halfLen, halfWid, barriers, islands, MOUTH, seed: s };
}

let T = build();

/** Generate a fresh table. Exported so tests can hammer many layouts. */
export function reseed(s = (Math.random() * 1e9) | 0) {
  seed = s;
  T = build(s);
  return T;
}

export const layout = () => T;

/* ------------------------------------------------------------------ */

export default {
  meta: {
    id: 'chaos',
    name: 'THE WRONG TABLE',
    blurb: 'A different shape every rack. Walls in the way, holes in the middle.',
  },

  get outline() { return T.outline; },
  get bounds() { return { halfLen: T.halfLen, halfWid: T.halfWid }; },
  height: TABLE.height,

  /** On the cloth, clear of the rim, the barriers and the holes. */
  inBounds(x, z, r) {
    if (!inPolygon(T.outline, x, z)) return false;
    if (distToEdge(T.outline, x, z) < r * 1.6) return false;
    for (const h of T.islands) if (Math.hypot(x - h.x, z - h.z) < h.r + r * 1.4) return false;
    for (const b of T.barriers) {
      const ux = Math.cos(b.angle), uz = Math.sin(b.angle);
      const dx = x - b.x, dz = z - b.z;
      const t = Math.max(-b.half, Math.min(b.half, dx * ux + dz * uz));
      if (Math.hypot(dx - ux * t, dz - uz * t) < b.thick / 2 + r * 1.6) return false;
    }
    return true;
  },

  buildGeometry() {
    const base = polygonGeometry(T.outline, T.pocketAt, {
      mouth: () => T.MOUTH,
      kind: () => 'corner',
    });

    const cushions = base.cushions.slice();
    const extraJaws = [];
    for (const b of T.barriers) {
      cushions.push(...b.cushions);
      extraJaws.push(...b.jaws);
    }

    // finish the rim and the barriers together, so barrier ends get their caps
    const geo = finishGeometry(cushions, base.pockets, base.facings);
    geo.jaws.push(...extraJaws);

    /* Islands are appended after the rim pockets are finished, because they are
       deliberately not built like one: no mouth, no shelf, no facings. */
    T.islands.forEach((h, i) => {
      geo.pockets.push({
        kind: 'island', id: base.pockets.length + i,
        x: h.x, z: h.z, r: h.r,
        dropX: h.x, dropZ: h.z, dropR: h.r,
        shelf: 0, len: 0,
        ax: h.x, az: h.z, bx: h.x, bz: h.z,
        nx: 0, nz: 1, ex: 1, ez: 0,
      });
    });

    geo.islands = T.islands;
    geo.barriers = T.barriers;
    return geo;
  },

  buildMesh(geo) {
    return polygonMesh(geo, T.outline, {
      feltBase: [64, 30, 74],           // a purple nobody asked for
      woodColour: '#5c3a2a',
      legCount: 5,
      extraHoles: T.islands.map((h) => ({ x: h.x, z: h.z, r: h.r })),
      barriers: T.barriers,
    });
  },

  /* A new table every rack — which is the design, and means the layout really
     is generated rather than replayed. */
  rack(rng = Math.random) {
    reseed((rng() * 1e9) | 0);

    const balls = [];
    const place = (n) => {
      for (let i = 0; i < 600; i++) {
        const x = (rng() - 0.5) * T.halfLen * 1.7;
        const z = (rng() - 0.5) * T.halfWid * 1.7;
        if (!this.inBounds(x, z, BALL_R * 1.5)) continue;
        if (balls.some((b) => Math.hypot(b.x - x, b.z - z) < BALL_R * 2.4)) continue;
        balls.push(makeBall(n, x, z));
        return true;
      }
      return false;
    };

    place(0);                                    // the cue ball gets first pick
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) place(n);
    return balls;
  },

  get cueSpot() { return { x: -T.halfLen * 0.6, z: 0 }; },
  terrain: null,
};

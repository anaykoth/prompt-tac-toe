/**
 * Every table design, hammered. `node test/tablecheck.mjs`
 *
 * A design is playable if balls cannot leave it, cannot wedge, and start legal.
 * These are the three things that actually break when the table stops being a
 * rectangle, so they are tested by simulation rather than by inspection.
 */
import { PoolSim, mulberry32, BALL_R, makeBall } from '../src/pool/physics.js';
import { inPolygon, distToEdge } from '../src/pool/tables/polygon.js';
import { designs, getDesign } from '../src/pool/tables/index.js';

import hexagon from '../src/pool/tables/hexagon.js';
import regulation from '../src/pool/tables/regulation.js';
import terrainTable, { terrain } from '../src/pool/tables/terrain.js';
import chaos, { reseed as reseedChaos, layout as chaosLayout } from '../src/pool/tables/chaos.js';

let pass = 0, fail = 0;
const ok = (n, c, i = '') => {
  if (c) { pass++; console.log(`  ok   ${n}${i ? '  ' + i : ''}`); }
  else { fail++; console.log(`  FAIL ${n}  ${i}`); }
};
const round = (v, n = 2) => +v.toFixed(n);

/** A ball is legal if it is inside the outline, pocketed, or gone in a hole. */
/* `outline` is a function, not a value: the chaos table regenerates itself on
   every rack, so a shape captured once goes stale the moment it is used. */
function checkDesign(design, getOutline, shots = 900) {
  const geo = design.buildGeometry();
  let escapes = 0, stalls = 0, potted = 0, worstOut = 0;

  for (let i = 0; i < shots; i++) {
    const rng = mulberry32(i * 7919 + 13);
    const sim = new PoolSim({ rng, geo, terrain: design.terrain ?? null });

    // a ball somewhere legal, fired in some direction, at some speed
    let x, z, guard = 0;
    const pre = getOutline();
    do {
      x = (rng() - 0.5) * design.bounds.halfLen * 1.9;
      z = (rng() - 0.5) * design.bounds.halfWid * 1.9;
    } while (guard++ < 60
      && (!inPolygon(pre, x, z) || distToEdge(pre, x, z) < BALL_R * 2.2));
    if (guard >= 60) continue;

    /* A plain ball, not one borrowed from rack(): on a design that regenerates
       itself per rack, calling rack() here would rebuild the table underneath
       the geometry we are simulating against, and every "escape" would be the
       harness comparing two different tables. */
    sim.add(makeBall(0, x, z));
    sim.strike(rng() * Math.PI * 2, 0.4 + rng() * 5.6, (rng() - 0.5) * 0.8, (rng() - 0.5) * 0.8);
    const t = sim.settle(45);
    if (sim.moving()) stalls++;

    for (const b of sim.balls) {
      if (!b.live) { potted++; continue; }
      if (!inPolygon(pre, b.x, b.z)) {
        escapes++;
        worstOut = Math.max(worstOut, -distToEdge(pre, b.x, b.z));
      }
    }
  }
  return { escapes, stalls, potted, shots };
}

for (const [design, getOutline] of [[hexagon, () => hexagon.outline], [chaos, () => chaos.outline]]) {
  const outline = getOutline();
  console.log(`\n--- ${design.meta.name} ---`);

  const geo = design.buildGeometry();
  ok('cushion normals all point inward', geo.cushions.every((c) => {
    const mx = (c.ax + c.bx) / 2, mz = (c.az + c.bz) / 2;
    // a step along the normal must land inside the table
    return inPolygon(outline, mx + c.nx * 0.02, mz + c.nz * 0.02);
  }), `${geo.cushions.length} cushions`);

  /* Only rail pockets have facings — an island is a hole in open cloth with no
     mouth to face, which is exactly what stops it behaving like a magnet. */
  const rail = geo.pockets.filter((p) => p.kind !== 'island');
  ok('every rail pocket has two facings', geo.facings.length === rail.length * 2,
    `${rail.length} rail pockets, ${geo.pockets.length - rail.length} islands, ${geo.facings.length} facings`);

  /* The rack is what a player sees first, so a bad one is a visible bug. */
  for (const seed of [1, 2, 3, 7, 99]) {
    const balls = design.rack(mulberry32(seed));
    const shape = getOutline();          // rack() may have rebuilt the table
    const overlapping = balls.some((a, i) => balls.some((b, j) =>
      j > i && Math.hypot(a.x - b.x, a.z - b.z) < (a.r + b.r) * 0.999));
    const outside = balls.filter((b) => !inPolygon(shape, b.x, b.z));
    if (seed === 1) {
      ok('rack is 16 balls with a cue ball', balls.length === 16 && balls[0].num === 0);
    }
    if (overlapping || outside.length) {
      ok(`rack seed ${seed} is legal`, false,
        overlapping ? 'balls overlap' : `${outside.length} outside the table`);
    }
  }
  ok('rack is legal across seeds', true);

  const r = checkDesign(design, getOutline);
  ok('no ball ever escapes the table', r.escapes === 0,
    `${r.escapes} escapes over ${r.shots} shots (${r.potted} pocketed)`);
  ok('every shot comes to rest', r.stalls === 0, `${r.stalls} stalls`);
}

/* ------------------------------------------------------------------ */
console.log('\n--- THE NINE FOOTER ---');
{
  const IN = 0.0254;
  const spec = regulation.spec;
  const inch = (v) => v / IN;
  ok('playing surface is 100" x 50"',
    Math.abs(inch(spec.halfLen * 2) - 100) < 0.01 && Math.abs(inch(spec.halfWid * 2) - 50) < 0.01,
    `${round(inch(spec.halfLen * 2), 1)}" x ${round(inch(spec.halfWid * 2), 1)}"`);
  ok('exactly twice as long as wide', Math.abs(spec.halfLen - spec.halfWid * 2) < 1e-9);
  const pct = (spec.noseHeight / (BALL_R * 2)) * 100;
  ok('nose height is 62.5-64.5% of ball diameter', pct >= 62.5 && pct <= 64.5, `${round(pct, 1)}%`);
  ok('corner mouth 4.5-5.5"', inch(spec.cornerMouth) >= 4.5 && inch(spec.cornerMouth) <= 5.5,
    `${round(inch(spec.cornerMouth), 2)}"`);
  ok('side mouth 5-5.5"', inch(spec.sideMouth) >= 5 && inch(spec.sideMouth) <= 5.5,
    `${round(inch(spec.sideMouth), 2)}"`);
  ok('rail width 4-7.5"', inch(spec.railWidth) >= 4 && inch(spec.railWidth) <= 7.5,
    `${round(inch(spec.railWidth), 2)}"`);

  const rect = [
    { x: -spec.halfLen, z: -spec.halfWid }, { x: spec.halfLen, z: -spec.halfWid },
    { x: spec.halfLen, z: spec.halfWid }, { x: -spec.halfLen, z: spec.halfWid },
  ];
  const r = checkDesign(regulation, () => rect, 400);
  ok('no ball escapes', r.escapes === 0, `${r.escapes} over ${r.shots} shots`);
  ok('every shot settles', r.stalls === 0, `${r.stalls} stalls`);
}

/* ------------------------------------------------------------------ */
console.log('\n--- THE SUBSIDENCE ---');
{
  const spec = terrainTable.spec;
  const L = spec.halfLen, W = spec.halfWid;

  /* The gradient is the thing that can silently be wrong: if it disagrees with
     the height, balls accelerate uphill and energy appears from nowhere. */
  let worst = 0;
  const eps = 1e-6;
  for (let i = 0; i < 400; i++) {
    const x = (Math.random() - 0.5) * 2 * L, z = (Math.random() - 0.5) * 2 * W;
    const g = terrain(x, z);
    const nx = (terrain(x + eps, z).h - terrain(x - eps, z).h) / (2 * eps);
    const nz = (terrain(x, z + eps).h - terrain(x, z - eps).h) / (2 * eps);
    worst = Math.max(worst, Math.abs(g.gx - nx), Math.abs(g.gz - nz));
  }
  ok('analytic gradient matches the numerical one', worst < 1e-4,
    `worst error ${worst.toExponential(1)}`);

  let hi = -Infinity, lo = Infinity;
  for (let i = 0; i < 3000; i++) {
    const x = (Math.random() - 0.5) * 2 * L, z = (Math.random() - 0.5) * 2 * W;
    const h = terrain(x, z).h;
    hi = Math.max(hi, h); lo = Math.min(lo, h);
  }
  ok('the warp is millimetres, not centimetres', hi - lo < 0.025,
    `${round((hi - lo) * 1000, 1)}mm peak to trough`);

  /* No perpetual motion: a ball rolling on a slope may gain speed going down,
     but its total energy must never increase. */
  let gained = 0;
  for (let i = 0; i < 60; i++) {
    const rng = mulberry32(i * 31 + 5);
    const sim = new PoolSim({ rng, geo: terrainTable.buildGeometry(), terrain });
    const b = makeBall(0, (rng() - 0.5) * L, (rng() - 0.5) * W);
    sim.add(b);
    sim.strike(rng() * Math.PI * 2, 0.5 + rng() * 2.5, 0, 0.3);
    /* True total energy: linear, rotational and potential. The obvious
       shorthand (7/10)mv² only holds for a ball that is already rolling — while
       it is still sliding, friction converts spin into linear speed, so linear
       KE rises legitimately even as the total falls. Measuring the shorthand
       reports that as energy from nowhere. */
    const I = 0.4 * b.m * b.r * b.r;
    const energy = () => {
      if (!b.live) return 0;
      const v2 = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz;
      const w2 = b.wx * b.wx + b.wy * b.wy + b.wz * b.wz;
      // b.y is already measured on the warped bed, so the terrain height must
      // not be added again — doing so reports every slope as free energy
      return 0.5 * b.m * v2 + 0.5 * I * w2 + b.m * 9.806 * b.y;
    };
    let prev = energy();
    for (let k = 0; k < 900 && sim.moving(); k++) {
      sim.step(1 / 240);
      const e = energy();
      if (e > prev + 1e-4) gained++;
      prev = e;
    }
  }
  ok('a ball never gains energy on its own', gained === 0, `${gained} gains`);

  // and the point of the design: how far does a straight shot bend?
  const geo = terrainTable.buildGeometry();
  let dev = 0;
  for (const z0 of [-W * 0.5, 0, W * 0.5]) {
    const sim = new PoolSim({ rng: mulberry32(4), geo, terrain });
    const b = makeBall(0, -L * 0.92, z0);
    sim.add(b);
    sim.strike(0, 1.5, 0, 0.4);
    for (let k = 0; k < 4000 && sim.moving() && b.x < L * 0.9; k++) sim.step(1 / 240);
    dev = Math.max(dev, Math.abs(b.z - z0));
  }
  ok('a straight shot visibly bends', dev > 0.005 && dev < 0.30,
    `${round(dev * 1000, 0)}mm over a table length`);
}

/* ------------------------------------------------------------------ */
console.log('\n--- the wrong table, across many random layouts ---');
{
  /* One layout proving nothing is the trap here: the whole design is that the
     table is different every time, so containment has to hold for tables
     nobody has looked at. */
  let escapes = 0, stalls = 0, badRacks = 0, shots = 0;
  let minPockets = Infinity, maxSides = 0, islandDrops = 0;

  for (let layoutN = 0; layoutN < 40; layoutN++) {
    reseedChaos(layoutN * 104729 + 17);
    const T = chaosLayout();
    const geo = chaos.buildGeometry();
    minPockets = Math.min(minPockets, geo.pockets.length);
    maxSides = Math.max(maxSides, T.outline.length);

    const balls = chaos.rack(mulberry32(layoutN + 1));
    // rack() reseeds, so re-read the layout it actually produced
    const T2 = chaosLayout();
    if (balls.some((a, i) => balls.some((b, j) =>
      j > i && Math.hypot(a.x - b.x, a.z - b.z) < (a.r + b.r) * 0.999))) badRacks++;
    if (balls.some((b) => !inPolygon(T2.outline, b.x, b.z))) badRacks++;

    const geo2 = chaos.buildGeometry();
    for (let k = 0; k < 25; k++) {
      const rng = mulberry32(layoutN * 977 + k * 31 + 3);
      const sim = new PoolSim({ rng, geo: geo2, inBounds: (x, z, r) => chaos.inBounds(x, z, r) });
      let x, z, guard = 0;
      do {
        x = (rng() - 0.5) * T2.halfLen * 1.6;
        z = (rng() - 0.5) * T2.halfWid * 1.6;
      } while (guard++ < 80 && !chaos.inBounds(x, z, BALL_R * 2));
      if (guard >= 80) continue;
      sim.add(makeBall(0, x, z));
      sim.strike(rng() * Math.PI * 2, 0.5 + rng() * 5.5, (rng() - 0.5) * 0.6, (rng() - 0.5) * 0.6);
      sim.settle(45);
      shots++;
      if (sim.moving()) stalls++;
      for (const b of sim.balls) {
        if (!b.live) {
          if (geo2.pockets[b.pocket]?.kind === 'island') islandDrops++;
          continue;
        }
        if (!inPolygon(T2.outline, b.x, b.z)) escapes++;
      }
    }
  }
  ok('no ball escapes any random layout', escapes === 0,
    `${escapes} over ${shots} shots across 40 tables`);
  ok('no layout ever stalls a shot', stalls === 0, `${stalls} stalls`);
  ok('every random rack is legal', badRacks === 0, `${badRacks} bad racks`);
  ok('every layout has pockets to aim at', minPockets >= 3, `fewest ${minPockets}`);
  ok('balls do fall in the island holes', islandDrops > 0, `${islandDrops} island drops`);
}

/* ------------------------------------------------------------------ */
console.log('\n--- the picker ---');
{
  /* The registry has to be populated the moment it is imported. The game asks
     for its design synchronously while building the world, so a registry that
     fills in asynchronously is empty exactly when it matters — every id falls
     back to the house table and all five tables come out identical, which is
     precisely what happened. */
  const ids = designs().map((d) => d.meta.id);
  ok('every design is registered on import', ids.length === 5,
    ids.join(', ') || '(empty)');

  for (const id of ids) {
    if (getDesign(id).meta.id !== id) ok(`getDesign('${id}') returns it`, false);
  }
  ok('every id resolves to its own design', true);
  ok('an unknown id falls back to the house table',
    getDesign('nonsense').meta.id === 'barbox');

  // and the tables they build must actually differ
  const sigs = designs().map((d) => {
    const geo = d.buildGeometry();
    const rack = d.rack(mulberry32(1));
    return [geo.cushions.length, geo.pockets.length,
      d.bounds.halfLen.toFixed(4), d.bounds.halfWid.toFixed(4),
      rack.map((b) => `${b.num}:${b.x.toFixed(3)},${b.z.toFixed(3)}`).join('|'),
      d.terrain ? 'warped' : 'flat'].join('/');
  });
  ok('all five build a different table', new Set(sigs).size === 5,
    `${new Set(sigs).size} distinct`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

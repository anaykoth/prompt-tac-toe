import * as THREE from 'three';
import { buildTableGeometry, makeBall } from '../physics.js';
import { buildTable } from '../table.js';
import { REGULATION } from './regulation.js';

/**
 * The same nine-footer, thirty years later, in a room with a subsiding floor.
 *
 * The slate is warped. Every shot curves, position play becomes a reading of
 * the terrain, and the long ones are a negotiation. The physics already
 * supports a height field; the work here is defining one that is (a) small
 * enough to be a table rather than a skate park, (b) made of features you can
 * learn rather than noise, and (c) exactly differentiable, because the sim
 * needs the true gradient and a wrong one would invent energy.
 *
 * Everything below is a sum of smooth analytic terms, each differentiated by
 * hand, so `h` and its gradient cannot drift apart.
 */

const L = REGULATION.halfLen, W = REGULATION.halfWid;

/* The features, in millimetres. A real warped slate moves a few millimetres
   over its length; at 10 mm a ball visibly swerves, at 50 it would roll off. */
const SAG = 0.0075;        // the long sag: the frame has given way in the middle
const CROWN = 0.0045;      // a crown at the foot end, where the seam lifted
const DIP = 0.0035;        // the hollow the rack has pounded for thirty years
const TILT_X = 0.0022;     // and nobody has ever levelled it
const TILT_Z = 0.0014;

const SAG_LX = 0.62 * L;   // how far the sag reaches, lengthwise and across
const SAG_LZ = 0.85 * W;
const CROWN_X = 0.52 * L;  // centre of the crown
const CROWN_S = 0.34 * L;
const DIP_X = 0.5 * L;     // the foot spot
const DIP_S = 0.16 * L;

/**
 * Bed height and its exact gradient.
 *
 * Called every substep for every moving ball, so it stays to a handful of
 * exponentials and no allocation beyond the returned object.
 *
 * h(x,z) = −SAG·e^(−(x/ax)²−(z/az)²)
 *        + CROWN·e^(−((x−cx)/cs)²)
 *        − DIP·e^(−(((x−dx)²+z²)/ds²))
 *        + TILT_X·x/L + TILT_Z·z/W
 */
export function terrain(x, z) {
  const sx = x / SAG_LX, sz = z / SAG_LZ;
  const sag = Math.exp(-sx * sx - sz * sz);

  const cu = (x - CROWN_X) / CROWN_S;
  const crown = Math.exp(-cu * cu);

  const dx = x - DIP_X;
  const d2 = (dx * dx + z * z) / (DIP_S * DIP_S);
  const dip = Math.exp(-d2);

  const h = -SAG * sag + CROWN * crown - DIP * dip
    + (TILT_X * x) / L + (TILT_Z * z) / W;

  /* d/dx e^(−(x/a)²) = −2x/a² · e^(...), and likewise for the rest. Derived by
     hand rather than by finite difference: a gradient that disagrees with the
     height would push the ball uphill and manufacture energy from nothing. */
  const gx = -SAG * sag * (-2 * x / (SAG_LX * SAG_LX))
    + CROWN * crown * (-2 * (x - CROWN_X) / (CROWN_S * CROWN_S))
    - DIP * dip * (-2 * dx / (DIP_S * DIP_S))
    + TILT_X / L;

  const gz = -SAG * sag * (-2 * z / (SAG_LZ * SAG_LZ))
    - DIP * dip * (-2 * z / (DIP_S * DIP_S))
    + TILT_Z / W;

  return { h, gx, gz };
}

export default {
  meta: {
    id: 'terrain',
    name: 'THE SUBSIDENCE',
    blurb: 'A good table on a bad floor. Nothing rolls straight and everybody knows it.',
  },

  bounds: { halfLen: L, halfWid: W },
  height: REGULATION.height,
  spec: REGULATION,
  terrain,

  buildGeometry: () => buildTableGeometry(REGULATION),

  buildMesh(geo) {
    const group = buildTable(REGULATION).group;
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const H = REGULATION.height;

    /* Replace the flat bed with one that follows the height field.
       Displacing the existing cloth is not enough: it is a shape triangulated
       only at its outline and pocket cut-outs, about 180 vertices, and a mesh
       that coarse can only reproduce two thirds of the warp — the ball would
       roll on terrain the player cannot see. So the bed is rebuilt as a dense
       grid, sampled from the same function the sim integrates against, with the
       pockets punched out of it. */
    const flat = group.children.find((c) => c.geometry?.type === 'ShapeGeometry');
    if (flat) {
      group.remove(flat);
      const NX = 180, NZ = 92;
      const grid = new THREE.PlaneGeometry(L * 2, W * 2, NX, NZ);
      grid.rotateX(-Math.PI / 2);
      const pos = grid.attributes.position;

      const holes = geo.pockets.map((p) => {
        const capture = p.shelf * 0.35;
        const r = p.dropR;
        const mx = (p.ax + p.bx) / 2, mz = (p.az + p.bz) / 2;
        return { x: mx + p.nx * (capture + r), z: mz + p.nz * (capture + r), r };
      });

      for (let i = 0; i < pos.count; i++) {
        pos.setY(i, terrain(pos.getX(i), pos.getZ(i)).h);
      }
      pos.needsUpdate = true;

      /* Drop any triangle that falls in a pocket. Cutting the holes out of the
         index rather than the vertices keeps the grid regular, which is what
         makes the displacement smooth. */
      const idx = grid.index.array;
      const keep = [];
      for (let i = 0; i < idx.length; i += 3) {
        let inHole = false;
        for (let k = 0; k < 3 && !inHole; k++) {
          const v = idx[i + k];
          const x = pos.getX(v), z = pos.getZ(v);
          for (const h of holes) {
            if (Math.hypot(x - h.x, z - h.z) < h.r) { inHole = true; break; }
          }
        }
        if (!inHole) keep.push(idx[i], idx[i + 1], idx[i + 2]);
      }
      grid.setIndex(keep);
      grid.computeVertexNormals();

      const bed = new THREE.Mesh(grid, flat.material);
      bed.position.y = REGULATION.height;
      bed.receiveShadow = true;
      group.add(bed);
    }

    /* The evidence, in the room's own idiom. */
    const level = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.30, 0.022, 0.045),
      std({ color: '#c8b23a', roughness: 0.35, metalness: 0.6 }),
    );
    const vial = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.05, 10),
      std({ color: '#8fe86a', roughness: 0.1, transparent: true, opacity: 0.85 }),
    );
    vial.rotation.z = Math.PI / 2;
    vial.position.y = 0.012;
    level.add(body, vial);
    level.position.set(0.2, H + REGULATION.cushionTop + 0.012, -W - REGULATION.railWidth * 0.55);
    level.rotation.y = 0.07;
    level.castShadow = true;
    group.add(level);

    // shims under the near leg, and a folded beer mat under the other
    const shim = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.006, 0.16),
      std({ color: '#8a6a44', roughness: 0.85 }),
    );
    shim.position.set(-(L + REGULATION.railWidth - 0.11), 0.003, W + REGULATION.railWidth - 0.11);
    group.add(shim);
    const shim2 = shim.clone();
    shim2.position.y = 0.009;
    shim2.scale.set(0.8, 1, 0.8);
    group.add(shim2);

    const mat = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.004, 0.1),
      std({ color: '#d8cba8', roughness: 0.95 }),
    );
    mat.position.set(L + REGULATION.railWidth - 0.11, 0.002, -(W + REGULATION.railWidth - 0.11));
    mat.rotation.y = 0.4;
    group.add(mat);

    return group;
  },

  rack(rng) {
    // the same rack, but it will not stay where you put it for long
    const balls = [];
    const gap = 0.028575 * 2 + 0.0004;
    const apexX = L * 0.5;
    const rowDx = (gap * Math.sqrt(3)) / 2;
    const nums = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
    for (let i = nums.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [nums[i], nums[j]] = [nums[j], nums[i]];
    }
    const order = new Array(15).fill(0);
    order[4] = 8;
    let k = 0;
    for (let i = 0; i < 15; i++) if (!order[i]) order[i] = nums[k++] ?? 1;

    balls.push(makeBall(0, -L * 0.5, 0));
    let i = 0;
    for (let row = 0; row < 5; row++) {
      for (let c = 0; c <= row; c++) {
        balls.push(makeBall(order[i++], apexX + row * rowDx, (c - row / 2) * gap));
      }
    }
    return balls;
  },

  cueSpot: { x: -L * 0.5, z: 0 },
};

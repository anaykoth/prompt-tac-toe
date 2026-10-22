import * as THREE from 'three';
import { TABLE, makePocket, finishGeometry } from '../physics.js';

/**
 * Turning an arbitrary polygon into a playable table.
 *
 * Given a closed outline and a set of which vertices are pockets, this cuts a
 * mouth back along both adjoining edges at each pocket vertex, leaves the rest
 * of the edge as cushion, and hands the mouths to `makePocket`. The rectangle
 * in physics.js does exactly the same thing by hand; this is that logic made
 * general so a hexagon or a lunatic eleven-sided thing gets pockets that rattle
 * and drop the same way.
 */

const std = (o) => new THREE.MeshStandardMaterial(o);

/** Counter-clockwise, or extruded solids come out inside-out. */
export function ccw(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area < 0 ? points.slice().reverse() : points;
}

/** Is a point inside a closed polygon? Even-odd, which is enough here. */
export function inPolygon(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z)
      && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Shortest distance from a point to a polygon's boundary. */
export function distToEdge(poly, x, z) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x, ez = b.z - a.z;
    const len2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / len2));
    best = Math.min(best, Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t)));
  }
  return best;
}

/**
 * Build cushions and pockets around a polygon.
 *
 * @param {{x,z}[]} outline   closed, counter-clockwise or clockwise, no repeat
 * @param {number[]} pocketAt indices of vertices that are pockets
 * @param {object} opts       { mouth, kind, t }
 */
export function polygonGeometry(outline, pocketAt, opts = {}) {
  const t = opts.t ?? TABLE;
  const kindOf = opts.kind ?? (() => 'corner');
  const mouthOf = opts.mouth ?? (() => t.cornerMouth);

  const n = outline.length;
  const centre = outline.reduce((a, p) => ({ x: a.x + p.x / n, z: a.z + p.z / n }), { x: 0, z: 0 });
  const isPocket = new Set(pocketAt);

  /* How far back along each edge the mouth is cut. At a vertex of interior
     angle θ the two cut-backs must span the mouth width across the corner, so
     each side gives up mouth / (2·sin(θ/2)) — for a rectangle's 90° corner that
     reduces to the mouth over root two, which is what the bar box uses. */
  const cutback = new Map();
  for (const i of pocketAt) {
    const prev = outline[(i - 1 + n) % n], here = outline[i], next = outline[(i + 1) % n];
    const a1 = Math.atan2(prev.z - here.z, prev.x - here.x);
    const a2 = Math.atan2(next.z - here.z, next.x - here.x);
    let interior = Math.abs(a1 - a2);
    if (interior > Math.PI) interior = Math.PI * 2 - interior;
    cutback.set(i, mouthOf(i) / (2 * Math.sin(interior / 2)));
  }

  /* Walk the edges. Each becomes one cushion, shortened at either end wherever
     it meets a pocket vertex. */
  const cushions = [];
  const ends = [];             // {i, at:{x,z}} the tips left either side of a pocket
  for (let i = 0; i < n; i++) {
    const a = outline[i], b = outline[(i + 1) % n];
    const ex = b.x - a.x, ez = b.z - a.z;
    const len = Math.hypot(ex, ez);
    const ux = ex / len, uz = ez / len;

    const backA = isPocket.has(i) ? cutback.get(i) : 0;
    const backB = isPocket.has((i + 1) % n) ? cutback.get((i + 1) % n) : 0;
    if (backA + backB >= len - 1e-6) {
      throw new Error(`polygonGeometry: edge ${i} is too short for its pocket mouths`);
    }

    const s = { x: a.x + ux * backA, z: a.z + uz * backA };
    const e = { x: b.x - ux * backB, z: b.z - uz * backB };

    // inward normal: the one pointing at the middle of the table
    let nx = -uz, nz = ux;
    const mx = (s.x + e.x) / 2, mz = (s.z + e.z) / 2;
    if (nx * (centre.x - mx) + nz * (centre.z - mz) < 0) { nx = -nx; nz = -nz; }

    cushions.push({ ax: s.x, az: s.z, bx: e.x, bz: e.z, nx, nz });
    ends.push({ edge: i, start: s, end: e });
  }

  /* Each pocket sits between the end of one cushion and the start of the next.
     Its outward direction is the bisector at that vertex, which is simply the
     direction from the table centre to the corner. */
  const facings = [];
  const pockets = [];
  let id = 0;
  for (let i = 0; i < n; i++) {
    if (!isPocket.has(i)) continue;
    const incoming = ends[(i - 1 + n) % n].end;      // cushion arriving at vertex i
    const outgoing = ends[i].start;                  // cushion leaving vertex i
    const v = outline[i];
    pockets.push(makePocket({
      ax: incoming.x, az: incoming.z, bx: outgoing.x, bz: outgoing.z,
      ox: v.x - centre.x, oz: v.z - centre.z,
      kind: kindOf(i), id: id++, t, facings,
    }));
  }

  return finishGeometry(cushions, pockets, facings);
}

/* ------------------------------------------------------------------ */
/* A mesh for any polygon table                                        */
/* ------------------------------------------------------------------ */

/** Fine woven cloth, cheap enough to build per design. */
export function clothTexture(size = 512, base = [22, 84, 56]) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const weave = Math.sin(x * 1.62) * 3.4 + Math.sin(y * 1.15) * 2.2
        + Math.sin((x + y) * 0.78) * 0.7;
      const n = (Math.random() - 0.5) * 9;
      d[i] = base[0] + weave * 0.75 + n;
      d[i + 1] = base[1] + weave + n;
      d[i + 2] = base[2] + weave * 0.8 + n;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 4 + Math.random() * 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(198,214,226,${0.03 + Math.random() * 0.07})`);
    grd.addColorStop(1, 'rgba(198,214,226,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(1 / 0.33, 1 / 0.33);
  tex.anisotropy = 8;
  return tex;
}

export function woodTexture(size = 512, base = [111, 82, 54]) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const grain = Math.sin(x * 0.09 + Math.sin(y * 0.02) * 3) * 18
        + Math.sin(x * 0.5) * 6 + (Math.random() - 0.5) * 14;
      const i = (y * size + x) * 4;
      img.data[i] = base[0] + grain;
      img.data[i + 1] = base[1] + grain * 0.8;
      img.data[i + 2] = base[2] + grain * 0.6;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** World-space UVs, since shape geometry has none worth using. */
function worldUVs(geo, scale = 1) {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) * scale;
    uv[i * 2 + 1] = pos.getZ(i) * scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/**
 * A table body for any polygon: cloth with the pockets cut out, cushions along
 * every segment, one continuous rail frame, throats and nets.
 *
 * @param {object} geo      from polygonGeometry
 * @param {{x,z}[]} outline the same outline used to build it
 * @param {object} opts     { height, feltColour, woodColour, extraHoles, terrain }
 */
export function polygonMesh(geo, outline, opts = {}) {
  const group = new THREE.Group();
  const t = opts.t ?? TABLE;
  const H = opts.height ?? t.height;
  const RAIL_W = opts.railWidth ?? t.railWidth;
  const NOSE = t.noseHeight, CUSH_TOP = t.cushionTop, CUSH_D = t.cushionDepth;

  const cloth = clothTexture(512, opts.feltBase);
  const clothMat = std({ color: 0xffffff, roughness: 0.97, map: cloth });
  const railClothMat = std({ color: 0xd2d2d2, roughness: 0.96, map: cloth });
  const woodMat = std({
    color: opts.woodColour ?? '#6f5236', roughness: 0.68, metalness: 0.04,
    map: woodTexture(512, opts.woodBase),
  });
  const pt = (p) => new THREE.Vector2(p.x, -p.z);

  /* ---- the holes: one circle per pocket, on the capture line ---- */
  const holes = geo.pockets.map((p) => {
    const capture = p.shelf * (opts.dropDepth ?? 0.35);
    const r = opts.holeR ?? t.cornerBack / 2;
    const mx = (p.ax + p.bx) / 2, mz = (p.az + p.bz) / 2;
    return { x: mx + p.nx * (capture + r), z: mz + p.nz * (capture + r), r, pocket: p };
  });
  const allHoles = holes.concat(opts.extraHoles ?? []);
  const circle = (h, steps = 28) => {
    const out = [];
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      out.push({ x: h.x + Math.cos(a) * h.r, z: h.z + Math.sin(a) * h.r });
    }
    return out;
  };

  /* ---- cloth: the outline, pockets cut out ---- */
  const bedShape = new THREE.Shape(ccw(outline.map(pt)));
  bedShape.holes = allHoles.map((h) => new THREE.Path(ccw(circle(h).map(pt)).reverse()));
  const bedGeo = new THREE.ShapeGeometry(bedShape);
  bedGeo.rotateX(-Math.PI / 2);
  worldUVs(bedGeo);
  const bed = new THREE.Mesh(bedGeo, clothMat);
  bed.position.y = H;
  bed.receiveShadow = true;
  group.add(bed);

  // the slate under it, cut the same
  const slateGeo = new THREE.ExtrudeGeometry(bedShape, { depth: t.slate, bevelEnabled: false });
  slateGeo.rotateX(-Math.PI / 2);
  slateGeo.translate(0, H - 0.002 - t.slate, 0);
  group.add(new THREE.Mesh(slateGeo, std({ color: '#4b4a52', roughness: 0.92 })));

  /* ---- cushions ---- */
  const profile = () => new THREE.Shape(ccw([
    new THREE.Vector2(0.0055, 0),
    new THREE.Vector2(0, NOSE * 0.72),
    new THREE.Vector2(0, NOSE),
    new THREE.Vector2(0.010, CUSH_TOP),
    new THREE.Vector2(CUSH_D, CUSH_TOP),
    new THREE.Vector2(CUSH_D, 0),
  ]));
  for (const c of geo.cushions) {
    const len = Math.hypot(c.bx - c.ax, c.bz - c.az);
    const g2 = new THREE.ExtrudeGeometry(profile(), { depth: len, bevelEnabled: false });
    g2.rotateY(-Math.PI / 2);
    g2.translate(len / 2, 0, 0);
    const m = new THREE.Mesh(g2, railClothMat);
    m.position.set((c.ax + c.bx) / 2, H, (c.az + c.bz) / 2);
    m.rotation.y = Math.atan2(-c.nx, -c.nz);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }

  /* ---- facings: the cut ends of the cushions ---- */
  const FT = 0.008;
  for (const f of geo.facings) {
    const quad = [
      { x: f.ax, z: f.az },
      { x: f.bx, z: f.bz },
      { x: f.bx + f.awayX * FT, z: f.bz + f.awayZ * FT },
      { x: f.ax + f.awayX * FT, z: f.az + f.awayZ * FT },
    ];
    const fg = new THREE.ExtrudeGeometry(new THREE.Shape(ccw(quad.map(pt))), {
      depth: CUSH_TOP, bevelEnabled: false,
    });
    fg.rotateX(-Math.PI / 2);
    fg.translate(0, H, 0);
    const m = new THREE.Mesh(fg, railClothMat);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }

  /* ---- rail: the outline pushed out, with the playing area cut from it ---- */
  const nOut = outline.length;
  const cOut = outline.reduce((a, p) => ({ x: a.x + p.x / nOut, z: a.z + p.z / nOut }), { x: 0, z: 0 });
  const outer = outline.map((p) => {
    const dx = p.x - cOut.x, dz = p.z - cOut.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: p.x + (dx / l) * RAIL_W, z: p.z + (dz / l) * RAIL_W };
  });
  // inner edge: cut back behind the rubber so it never shares a plane with it
  const inner = outline.map((p) => {
    const dx = p.x - cOut.x, dz = p.z - cOut.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: p.x + (dx / l) * (CUSH_D - 0.003), z: p.z + (dz / l) * (CUSH_D - 0.003) };
  });

  const railShape = new THREE.Shape(ccw(outer.map(pt)));
  railShape.holes = [new THREE.Path(ccw(inner.map(pt)).reverse())];
  const BEV = 0.004;
  const railTopY = H + CUSH_TOP - 0.001;
  const railGeo = new THREE.ExtrudeGeometry(railShape, {
    depth: t.railTop, bevelEnabled: true,
    bevelThickness: BEV, bevelSize: BEV, bevelSegments: 2,
  });
  railGeo.rotateX(-Math.PI / 2);
  railGeo.translate(0, railTopY - t.railTop - BEV, 0);
  worldUVs(railGeo, 3);
  const rails = new THREE.Mesh(railGeo, woodMat);
  rails.castShadow = rails.receiveShadow = true;
  group.add(rails);

  /* ---- throats and nets ---- */
  const netMat = std({ color: '#241b14', roughness: 0.95, side: THREE.DoubleSide });
  const throatMat = std({ color: '#17130f', roughness: 0.95, side: THREE.DoubleSide });
  const DROP = 0.075;
  for (const h of allHoles) {
    const ring = circle(h, 28);
    const verts = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const yT = H + 0.0004, yB = H - DROP;
      verts.push(a.x, yT, a.z, b.x, yT, b.z, b.x, yB, b.z);
      verts.push(a.x, yT, a.z, b.x, yB, b.z, a.x, yB, a.z);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    wg.computeVertexNormals();
    group.add(new THREE.Mesh(wg, throatMat));

    const net = new THREE.Mesh(
      new THREE.CylinderGeometry(h.r * 0.97, h.r * 0.62, 0.13, 18, 1, true), netMat);
    net.position.set(h.x, H - DROP - 0.055, h.z);
    group.add(net);
    const bottom = new THREE.Mesh(
      new THREE.SphereGeometry(h.r * 0.63, 12, 8, 0, 7, Math.PI / 2, Math.PI / 2), netMat);
    bottom.position.set(h.x, H - DROP - 0.115, h.z);
    group.add(bottom);
  }

  /* ---- free-standing barriers ---- */
  for (const b of opts.barriers ?? []) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(b.half * 2, CUSH_TOP, b.thick),
      railClothMat,
    );
    bar.position.set(b.x, H + CUSH_TOP / 2, b.z);
    bar.rotation.y = -b.angle;
    bar.castShadow = bar.receiveShadow = true;
    group.add(bar);

    // the rounded caps the physics gives the ends
    for (const s2 of [1, -1]) {
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(b.thick / 2, b.thick / 2, CUSH_TOP, 12),
        railClothMat,
      );
      cap.position.set(
        b.x + Math.cos(b.angle) * b.half * s2,
        H + CUSH_TOP / 2,
        b.z + Math.sin(b.angle) * b.half * s2,
      );
      cap.castShadow = cap.receiveShadow = true;
      group.add(cap);
    }
  }

  /* ---- cabinet and legs ---- */
  const apronShape = new THREE.Shape(ccw(outer.map(pt)));
  const apronGeo = new THREE.ExtrudeGeometry(apronShape, { depth: 0.19, bevelEnabled: false });
  apronGeo.rotateX(-Math.PI / 2);
  apronGeo.translate(0, H - 0.021 - 0.19, 0);
  worldUVs(apronGeo, 3);
  const apron = new THREE.Mesh(apronGeo, std({
    color: '#5b4430', roughness: 0.62, map: woodTexture(512, [92, 68, 46]),
  }));
  apron.castShadow = apron.receiveShadow = true;
  group.add(apron);

  const legMat = std({ color: '#4a3120', roughness: 0.6, map: woodTexture(256, [74, 49, 32]) });
  const LEG_H = H - 0.22;
  const legs = opts.legCount ?? Math.min(6, outer.length);
  for (let i = 0; i < legs; i++) {
    const v = outer[Math.round((i * outer.length) / legs) % outer.length];
    const dx = v.x - cOut.x, dz = v.z - cOut.z;
    const l = Math.hypot(dx, dz) || 1;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, LEG_H, 0.13), legMat);
    leg.position.set(v.x - (dx / l) * 0.1, 0.02 + LEG_H / 2, v.z - (dz / l) * 0.1);
    leg.castShadow = true;
    group.add(leg);
  }

  return group;
}

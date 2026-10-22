import * as THREE from 'three';
import { TABLE, BALL_R, buildTableGeometry, tableOutline } from './physics.js';

const std = (o) => new THREE.MeshStandardMaterial(o);

/**
 * Counter-clockwise, always.
 *
 * THREE builds an extrusion's side walls from the winding of its outline: wind
 * it clockwise and the whole solid comes out inside-out, so backface culling
 * lets you see straight through it to whatever is behind. That is invisible for
 * as long as something else happens to be filling those pixels, and then very
 * visible the moment it is not — so every outline here is normalised rather
 * than each one being trusted to have been typed in the right order.
 */
function ccw(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area < 0 ? points.slice().reverse() : points;
}

/* ------------------------------------------------------------------ */
/* Textures                                                            */
/* ------------------------------------------------------------------ */

/* ---------------- cloth ----------------
   Worsted pool cloth is a directional weave: the nap runs down the table, and
   it reads as fine parallel fibres with a coarser cross-thread, not as noise.
   Everything below builds one tiling patch of that, plus a matching bump map,
   so the table light rakes across real threads instead of a flat green slab. */

/** Tiling value noise, so the wear patches have structure at every scale. */
function makeNoise(seedTable) {
  const P = seedTable;
  const at = (x, y) => P[((x & 255) + P[y & 255]) & 255] / 255;
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
}

/* 1024 rather than 2048: the weave is procedural, so doubling the map only
   doubles the thread count on screen — but it quadruples both the generation
   cost (a per-pixel JS loop, ~800 ms at 2048) and the VRAM, which is a freeze
   on every single page load for detail nobody can see at table distance. */
function clothTextures(size = 1024) {
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = (Math.random() * 256) | 0;
  const noise = makeNoise(perm);
  const fbm = (x, y) => noise(x, y) * 0.55 + noise(x * 2.1, y * 2.1) * 0.27
    + noise(x * 4.3, y * 4.3) * 0.13 + noise(x * 8.7, y * 8.7) * 0.05;

  const colour = document.createElement('canvas');
  const bumpCv = document.createElement('canvas');
  colour.width = colour.height = size;
  bumpCv.width = bumpCv.height = size;
  const cg = colour.getContext('2d');
  const bg = bumpCv.getContext('2d');

  const img = cg.createImageData(size, size);
  const bmp = bg.createImageData(size, size);
  const d = img.data, bd = bmp.data;

  // dye lot: pool cloth is never one flat green
  const BASE = [22, 84, 56];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      /* the weave: fine warp threads down the nap direction, a coarser weft
         across, and a twill offset so it does not look like graph paper */
      const warp = Math.sin(x * 1.62 + Math.sin(y * 0.21) * 0.6);
      const weft = Math.sin(y * 1.15 + Math.sin(x * 0.17) * 0.5);
      const twill = Math.sin((x + y) * 0.78) * 0.35;
      const thread = warp * 3.4 + weft * 2.2 + twill * 2.0;

      // fibre grain along the nap, plus broad mottling from the dye
      const fibre = (Math.random() - 0.5) * 7;
      const mottle = (fbm(x / 190, y / 240) - 0.5) * 15;
      const wear = fbm(x / 420 + 11, y / 380 + 7);

      // worn cloth goes paler and slightly blue-grey as the pile flattens
      const bleach = Math.max(0, wear - 0.56) * 46;
      const shade = thread + fibre + mottle;

      d[i] = BASE[0] + shade * 0.75 + bleach * 0.9;
      d[i + 1] = BASE[1] + shade + bleach * 0.75;
      d[i + 2] = BASE[2] + shade * 0.8 + bleach;
      d[i + 3] = 255;

      // bump: the threads themselves, softened where the pile is worn flat
      const h = 128 + thread * 8.5 + (Math.random() - 0.5) * 5 - bleach * 0.8;
      bd[i] = bd[i + 1] = bd[i + 2] = Math.max(0, Math.min(255, h));
      bd[i + 3] = 255;
    }
  }
  cg.putImageData(img, 0, 0);
  bg.putImageData(bmp, 0, 0);

  /* ---- the history of the table, drawn on top ---- */

  // chalk dust, heaviest where people actually stand
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 4 + Math.pow(Math.random(), 2) * 40;
    const grd = cg.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(198,214,226,${0.04 + Math.random() * 0.1})`);
    grd.addColorStop(1, 'rgba(198,214,226,0)');
    cg.fillStyle = grd;
    cg.beginPath(); cg.arc(x, y, r, 0, 7); cg.fill();
  }

  // drink rings — a pint has stood on this table more than once
  for (let i = 0; i < 7; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 28 + Math.random() * 40;
    cg.strokeStyle = `rgba(74,48,22,${0.06 + Math.random() * 0.08})`;
    cg.lineWidth = 3 + Math.random() * 5;
    cg.beginPath(); cg.arc(x, y, r, 0, 7); cg.stroke();
    cg.fillStyle = `rgba(74,48,22,${0.02 + Math.random() * 0.03})`;
    cg.beginPath(); cg.arc(x, y, r, 0, 7); cg.fill();
  }

  // cigarette burns: a dark rim and a bald patch that shows in the bump too
  for (let i = 0; i < 9; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 3 + Math.random() * 6;
    cg.fillStyle = 'rgba(28,20,12,0.55)';
    cg.beginPath(); cg.arc(x, y, r, 0, 7); cg.fill();
    cg.strokeStyle = 'rgba(96,72,34,0.4)';
    cg.lineWidth = 2;
    cg.beginPath(); cg.arc(x, y, r + 2, 0, 7); cg.stroke();
    bg.fillStyle = 'rgba(90,90,90,0.9)';
    bg.beginPath(); bg.arc(x, y, r, 0, 7); bg.fill();
  }

  // old repairs and scuffs raked along the nap
  for (let i = 0; i < 180; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const len = 10 + Math.random() * 90;
    cg.strokeStyle = `rgba(${Math.random() < 0.5 ? '150,180,160' : '20,44,30'},${Math.random() * 0.06})`;
    cg.lineWidth = 0.6 + Math.random() * 1.4;
    cg.beginPath();
    cg.moveTo(x, y);
    cg.lineTo(x + len, y + (Math.random() - 0.5) * 4);
    cg.stroke();
  }

  const map = new THREE.CanvasTexture(colour);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const bump = new THREE.CanvasTexture(bumpCv);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.anisotropy = 8;

  return { map, bump };
}

function woodTexture(size = 512, base = [86, 48, 28]) {
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

export const BALL_COLORS = {
  1: '#f2c31a', 2: '#1b48b8', 3: '#d81f1f', 4: '#5c2a8f', 5: '#f07216',
  6: '#1a7a3c', 7: '#7a2018', 8: '#141416',
  9: '#f2c31a', 10: '#1b48b8', 11: '#d81f1f', 12: '#5c2a8f', 13: '#f07216',
  14: '#1a7a3c', 15: '#7a2018',
};

/** Equirectangular ball skin: solid or striped, with two number spots. */
function ballTexture(num) {
  const W = 512, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const stripe = num > 8;
  const col = num === 0 ? '#f4f1e4' : BALL_COLORS[num];

  if (num === 0) {
    g.fillStyle = '#f6f3e7';
    g.fillRect(0, 0, W, H);
    // the cue ball on a bar box has a red dot, and a lot of scuffs
    for (const cx of [W * 0.25, W * 0.75]) {
      g.fillStyle = '#c8242b';
      g.beginPath(); g.arc(cx, H * 0.5, 13, 0, 7); g.fill();
    }
  } else if (stripe) {
    g.fillStyle = '#f6f3e7';
    g.fillRect(0, 0, W, H);
    g.fillStyle = col;
    g.fillRect(0, H * 0.235, W, H * 0.53);
  } else {
    g.fillStyle = col;
    g.fillRect(0, 0, W, H);
  }

  if (num > 0) {
    for (const cx of [W * 0.25, W * 0.75]) {
      g.fillStyle = '#f8f5ea';
      g.beginPath(); g.arc(cx, H * 0.5, 42, 0, 7); g.fill();
      g.fillStyle = '#17161a';
      g.font = '700 46px "Barlow Condensed", Impact, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(num), cx, H * 0.5 + 2);
    }
  }

  // scuffs
  for (let i = 0; i < 220; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '20,16,10'},${Math.random() * 0.05})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 9, 1 + Math.random() * 2);
  }

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ------------------------------------------------------------------ */
/* The table                                                           */
/* ------------------------------------------------------------------ */

/**
 * @param {object} spec  table dimensions; defaults to the house bar box. Passing
 *                       a different spec builds the same table to other sizes,
 *                       which is how the regulation nine-footer is made.
 */
export function buildTable(spec = TABLE) {
  const group = new THREE.Group();
  const geo = buildTableGeometry(spec);
  const L = spec.halfLen, W = spec.halfWid, H = spec.height;
  const RAIL_W = spec.railWidth;       // nose to the outside of the rail cap
  const RAIL_H = spec.railTop;
  const NOSE = spec.noseHeight;        // where the ball is struck: 63.5% of Ø
  const CUSH_TOP = spec.cushionTop;
  const CUSH_D = spec.cushionDepth;    // rubber, nose to sub-rail

  const cloth = clothTextures();
  /* The bed and the cushions are built from shapes, whose UVs come out in
     metres, so the repeat is set per metre: one patch of weave every 330 mm.
     (Set as if for 0-1 UVs it tiles about thirteen times too fine and the
     whole cloth greys out into an average.) */
  const PATCH = 1 / 0.33;
  cloth.map.repeat.set(PATCH, PATCH);
  cloth.bump.repeat.set(PATCH, PATCH);
  const clothMat = std({
    color: 0xffffff, roughness: 0.97, metalness: 0,
    map: cloth.map, bumpMap: cloth.bump, bumpScale: 0.55,
  });
  const wood = woodTexture();
  const woodMat = std({ color: '#6f5236', roughness: 0.68, metalness: 0.04, map: wood });
  // the cushion cloth is the same bolt, stretched tighter over the rubber
  const cushCloth = cloth.map.clone();
  cushCloth.needsUpdate = true;
  cushCloth.repeat.set(PATCH, PATCH);
  const railClothMat = std({
    color: 0xd2d2d2, roughness: 0.96,
    map: cushCloth, bumpMap: cloth.bump, bumpScale: 0.4,
  });

  /* ---- bed ----
     One piece of cloth over the whole slate, with the six pockets cut out of
     it — which is how a table is actually covered, and the only way the holes
     are genuinely holes. Previously this was a shaped bed laid over a full
     rectangular underlay: the underlay had no pockets in it, so the felt ran
     straight under every hole and the "opening" was just a dark lid resting on
     top of continuous green. The slate had the same problem. */
  const plan = tableOutline(geo);
  const pt = (p) => new THREE.Vector2(p.x, -p.z);      // plan XZ -> shape XY

  const OX = L + RAIL_W, OZ = W + RAIL_W;
  const bedOutline = [
    { x: -OX, z: -OZ }, { x: OX, z: -OZ }, { x: OX, z: OZ }, { x: -OX, z: OZ },
  ];
  // every opening sits well inside the slate edge, so these are clean interior
  // holes and the triangulator has nothing to trip over
  const pocketHoles = () => plan.openings.map(
    (o) => new THREE.Path(ccw(o.map(pt)).reverse()),
  );

  const clothShape = new THREE.Shape(ccw(bedOutline.map(pt)));
  clothShape.holes = pocketHoles();
  const clothGeo = new THREE.ShapeGeometry(clothShape);
  clothGeo.rotateX(-Math.PI / 2);
  // ShapeGeometry has no UVs worth the name, so lay the weave on in world units
  {
    const pos = clothGeo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getX(i);
      uv[i * 2 + 1] = pos.getZ(i);
    }
    clothGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  const bed = new THREE.Mesh(clothGeo, clothMat);
  bed.position.y = H;
  bed.receiveShadow = true;
  group.add(bed);

  // the slate under it, cut to the same openings
  const slateShape = new THREE.Shape(ccw(bedOutline.map(pt)));
  slateShape.holes = pocketHoles();
  const slateGeo = new THREE.ExtrudeGeometry(slateShape, {
    depth: spec.slate, bevelEnabled: false,
  });
  slateGeo.rotateX(-Math.PI / 2);
  slateGeo.translate(0, H - 0.002 - spec.slate, 0);   // grows upward to the bed
  const slate = new THREE.Mesh(slateGeo, std({ color: '#4b4a52', roughness: 0.92 }));
  slate.receiveShadow = true;
  group.add(slate);

  /* ---- the markings that are actually on a table ---- */
  const lineMat = std({ color: '#d8cfb4', roughness: 0.9, transparent: true, opacity: 0.45 });
  const headString = new THREE.Mesh(new THREE.PlaneGeometry(0.003, W * 2), lineMat);
  headString.rotation.x = -Math.PI / 2;
  headString.position.set(-L / 2, H + 0.0012, 0);
  group.add(headString);
  const footSpot = new THREE.Mesh(
    new THREE.CircleGeometry(0.008, 14),
    std({ color: '#2a2418', roughness: 0.9 }),
  );
  footSpot.rotation.x = -Math.PI / 2;
  footSpot.position.set(L / 2, H + 0.0013, 0);
  group.add(footSpot);

  /* ---- cushions, straight off the physics segments ----
     Built in a canonical frame — length along local +x, the nose face on the
     local z = 0 plane, body extending to local +z — then swung so that local +z
     points away from the table. That way the rubber you can see is exactly the
     line the sim bounces balls off. */
  /* The profile is a pool cushion in section, not a wedge: the face rises
     steeply from the bed to the nose at 63.5% of a ball diameter — the height
     the sim strikes at — then the top runs back and down to the sub-rail, and
     the rubber is undercut beneath the nose so a ball frozen to the cushion sits
     against the nose and not against the base. */
  const cushionProfile = () => new THREE.Shape(ccw([
    new THREE.Vector2(0.0055, 0),        // bottom of the undercut, on the cloth
    new THREE.Vector2(0, NOSE * 0.72),   // the face
    new THREE.Vector2(0, NOSE),          // the nose itself
    new THREE.Vector2(0.010, CUSH_TOP),  // over the top
    new THREE.Vector2(CUSH_D, CUSH_TOP), // back under the rail cap
    new THREE.Vector2(CUSH_D, 0),
  ]));

  for (const c of geo.cushions) {
    const len = Math.hypot(c.bx - c.ax, c.bz - c.az);
    const g = new THREE.ExtrudeGeometry(cushionProfile(), { depth: len, bevelEnabled: false });
    g.rotateY(-Math.PI / 2);                   // extrusion axis +z -> -x
    g.translate(len / 2, 0, 0);                // centre it on its own length

    const cush = new THREE.Mesh(g, railClothMat);
    cush.position.set((c.ax + c.bx) / 2, H, (c.az + c.bz) / 2);
    cush.rotation.y = Math.atan2(-c.nx, -c.nz);
    cush.castShadow = cush.receiveShadow = true;
    group.add(cush);
  }

  /* ---- rails ----
     One piece. The frame is the outside rectangle with the playing area — nose
     lines, pocket throats and slate openings, the whole boundary in one loop —
     subtracted from it, then extruded. Doing the cut as a shape with a hole is
     an exact boolean and needs no CSG library, and it is the only way the wood
     reads as a single moulding rather than a stack of blocks butted together.
     The mitres at the corners come out of the outline for free. */
  const railMat = woodMat;
  const MITRE = 0.055;                       // the cut across each outside corner                       // the cut across each outside corner

  const outer = [
    { x: -OX + MITRE, z: -OZ }, { x: OX - MITRE, z: -OZ },
    { x: OX, z: -OZ + MITRE }, { x: OX, z: OZ - MITRE },
    { x: OX - MITRE, z: OZ }, { x: -OX + MITRE, z: OZ },
    { x: -OX, z: OZ - MITRE }, { x: -OX, z: -OZ + MITRE },
  ];

  const railShape = new THREE.Shape(ccw(outer.map(pt)));
  // a hole must wind against its outline, so it is reversed on purpose
  railShape.holes = [new THREE.Path(ccw(plan.railEdge.map(pt)).reverse())];

  /* Height of the finished rail. The cap has to come to rest just under the top
     of the cushion, not above it: a rail standing proud reads as a lip round the
     whole table and is not how the two meet in the timber. The millimetre of
     clearance matters — the rail is deliberately let into the back of the
     cushion by 3 mm, and at exactly equal heights those two horizontal faces
     would share a plane across that overlap and z-fight. */
  const RAIL_BEVEL = 0.004;
  const railTopY = H + CUSH_TOP - 0.001;

  const railGeo = new THREE.ExtrudeGeometry(railShape, {
    depth: RAIL_H, bevelEnabled: true,
    bevelThickness: RAIL_BEVEL, bevelSize: RAIL_BEVEL, bevelSegments: 2,
  });
  /* rotateX(-90) sends the extrusion axis to world +y, so the solid grows
     UPWARD from wherever it is translated to — the offset has to be the bottom
     of the rail, not the top. Getting this backwards silently doubled the rail
     height, which is what made the wood tower over the felt. */
  railGeo.rotateX(-Math.PI / 2);
  railGeo.translate(0, railTopY - RAIL_H - RAIL_BEVEL, 0);
  {
    // world-space UVs again, so the grain runs along the timber
    const pos = railGeo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      // ~3 repeats a metre, so the grain reads as timber and not as a smear
      uv[i * 2] = pos.getX(i) * 3;
      uv[i * 2 + 1] = pos.getZ(i) * 3;
    }
    railGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  const rails = new THREE.Mesh(railGeo, railMat);
  rails.castShadow = rails.receiveShadow = true;
  group.add(rails);

  /* ---- sights ----
     Inlaid in the rail cap, dividing the playing surface into eight along the
     long rails and four along the short ones — which is what makes them usable
     for aiming, so the spacing is derived from the nose-to-nose surface rather
     than from the outside of the table. */
  // the exposed top of the rail runs from the back of the cushion to the edge
  // on the rail's actual top face, not the height it was extruded from — the
  // bevel moves it, and the diamonds were being inlaid 4 mm inside the wood
  const capTop = railTopY;
  const sightDepth = (CUSH_D + RAIL_W) / 2;
  const sightMat = std({ color: '#cabfa4', roughness: 0.5, metalness: 0.1 });
  const sightGeo = new THREE.CircleGeometry(0.0075, 4);
  const addSight = (x, z) => {
    const s = new THREE.Mesh(sightGeo, sightMat);
    s.rotation.x = -Math.PI / 2;
    s.rotation.z = Math.PI / 4;
    s.position.set(x, capTop + 0.0008, z);
    group.add(s);
  };
  for (let i = 1; i <= 7; i++) {
    if (i === 4) continue;                    // the side pocket lives here
    const x = -L + (i / 8) * L * 2;
    addSight(x, -W - sightDepth);
    addSight(x, W + sightDepth);
  }
  for (let i = 1; i <= 3; i++) {
    const z = -W + (i / 4) * W * 2;
    addSight(-L - sightDepth, z);
    addSight(L + sightDepth, z);
  }

  /* ---- pockets ----
     Drawn from the same mouth / facing / shelf data the sim collides against,
     so what rattles out of the jaws on screen is what rattled out in the
     physics: two angled facings funnelling back over a shelf of cloth to the
     drop, rather than a circle painted on the bed. */
  const netMat = std({ color: '#241b14', roughness: 0.95, side: THREE.DoubleSide });
  const holeMat = new THREE.MeshBasicMaterial({ color: '#040405' });
  const facingMat = std({ color: '#191410', roughness: 0.62, metalness: 0.05 });
  const shelfMat = std({
    color: 0x9a9a9a, roughness: 0.98,
    map: cloth.map, bumpMap: cloth.bump, bumpScale: 0.4,
  });

  /* The facings are the cut ends of the cushion: a thin cloth-covered cap
     standing on the facing line. Extruding the whole cushion section along them
     instead — which is what this used to do — pushes 44 mm of rubber sideways
     out of a facing that is only 12 mm long on a side pocket, and it sprawls
     across the mouth. A facing is a face, so it is built as one. */
  const FACING_T = 0.008;
  for (const f of geo.facings) {
    /* Built as a quad in plan — tip, back, and the same two points pushed into
       the rail — rather than a rotated box. A box is centred on the segment and
       its corners swing out past the ends when it is turned, which is enough to
       poke a few millimetres of facing across the mouth of a side pocket; a
       polygon can only ever be where its corners are. */
    const quad = [
      { x: f.ax, z: f.az },
      { x: f.bx, z: f.bz },
      { x: f.bx + f.awayX * FACING_T, z: f.bz + f.awayZ * FACING_T },
      { x: f.ax + f.awayX * FACING_T, z: f.az + f.awayZ * FACING_T },
    ];
    const fg = new THREE.ExtrudeGeometry(new THREE.Shape(ccw(quad.map(pt))), {
      depth: CUSH_TOP, bevelEnabled: false,
    });
    fg.rotateX(-Math.PI / 2);
    fg.translate(0, H, 0);                   // grows up to the cushion top
    const fm = new THREE.Mesh(fg, railClothMat);
    fm.castShadow = fm.receiveShadow = true;
    group.add(fm);
  }

  const pocketMeshes = [];
  for (const p of geo.pockets) {
    /* The opening is already a hole in the cloth and in the rail, so all that
       is left is what you see through it: a dark throat wall dropping away, and
       the net under that. Nothing here is allowed to sit inside the mouth line
       — that is what made the pockets look bigger than they play. */
    const mouth = plan.openings[p.id];

    /* An open tube, built by hand rather than extruded. ExtrudeGeometry caps
       both ends, and that top cap is a lid sitting flush in the hole — from
       above it looks exactly like a dark shape painted on the cloth instead of
       an opening you can see down. */
    const DROP = 0.075;
    const verts = [];
    for (let i = 0; i < mouth.length; i++) {
      const a = mouth[i], b = mouth[(i + 1) % mouth.length];
      const yT = H + 0.0004, yB = H - DROP;
      verts.push(a.x, yT, a.z, b.x, yT, b.z, b.x, yB, b.z);
      verts.push(a.x, yT, a.z, b.x, yB, b.z, a.x, yB, a.z);
    }
    const wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    wallGeo.computeVertexNormals();
    const throat = new THREE.Mesh(wallGeo, new THREE.MeshStandardMaterial({
      color: '#17130f', roughness: 0.95, side: THREE.DoubleSide,
    }));
    group.add(throat);

    // concentric with the hole, because anything visible through a hole that is
    // not centred on it makes the hole itself look misshapen
    const hole = plan.holes[p.id];
    const net = new THREE.Mesh(
      new THREE.CylinderGeometry(hole.r * 0.97, hole.r * 0.62, 0.13, 20, 1, true),
      netMat,
    );
    net.position.set(hole.x, H - DROP - 0.055, hole.z);
    group.add(net);
    const bottom = new THREE.Mesh(
      new THREE.SphereGeometry(hole.r * 0.63, 14, 9, 0, 7, Math.PI / 2, Math.PI / 2),
      netMat,
    );
    bottom.position.set(hole.x, H - DROP - 0.115, hole.z);
    group.add(bottom);
    pocketMeshes.push({ p, net });
  }

  /* ---- cabinet, apron, legs ---- */
  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(L * 2 + RAIL_W * 2 + 0.02, 0.18, W * 2 + RAIL_W * 2 + 0.02),
    std({ color: '#6b4630', roughness: 0.6, map: woodTexture(512, [70, 40, 24]) }),
  );
  apron.position.y = H - 0.115;
  apron.castShadow = apron.receiveShadow = true;
  group.add(apron);

  const legMat = std({ color: '#4a3120', roughness: 0.6, map: wood });
  const LEG_H = H - 0.2 - 0.02;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, LEG_H, 0.15), legMat);
      leg.position.set(sx * (L + RAIL_W - 0.11), 0.02 + LEG_H / 2, sz * (W + RAIL_W - 0.11));
      leg.castShadow = true;
      group.add(leg);
      // the levelling foot every bar table is stood on a beer mat anyway
      const foot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.05, 0.02, 12),
        std({ color: '#2b2b30', roughness: 0.4, metalness: 0.55 }),
      );
      foot.position.set(leg.position.x, 0.01, leg.position.z);
      group.add(foot);
    }
  }

  // coin mech on the long side — it is a bar box, after all
  const coin = new THREE.Mesh(
    new THREE.BoxGeometry(0.20, 0.13, 0.05),
    std({ color: '#2a2b31', roughness: 0.4, metalness: 0.6 }),
  );
  coin.position.set(0.0, H - 0.13, W + RAIL_W + 0.03);
  group.add(coin);
  const slot = new THREE.Mesh(
    new THREE.BoxGeometry(0.13, 0.012, 0.01),
    new THREE.MeshBasicMaterial({ color: '#0a0a0c' }),
  );
  slot.position.set(0, H - 0.10, W + RAIL_W + 0.056);
  group.add(slot);

  return { group, geo, clothMat, railMat: woodMat, height: H, RAIL_W, RAIL_H };
}

/* ------------------------------------------------------------------ */
/* Balls                                                               */
/* ------------------------------------------------------------------ */

export function buildBalls(numbers) {
  const geo = new THREE.SphereGeometry(BALL_R, 28, 22);
  const meshes = new Map();
  const group = new THREE.Group();
  for (const n of numbers) {
    const mat = std({
      map: ballTexture(n),
      roughness: 0.32,
      metalness: 0.0,
    });
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    // the seam of the equirect map runs down the back
    meshes.set(n, m);
    group.add(m);
  }
  return { group, meshes, geo };
}

/* ------------------------------------------------------------------ */
/* Cue and bridge hand                                                 */
/* ------------------------------------------------------------------ */

export function buildCueStick() {
  const g = new THREE.Group();
  const LEN = 1.45;

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0065, 0.0105, LEN * 0.55, 12),
    std({ color: '#e5c98f', roughness: 0.35, map: woodTexture(256, [214, 186, 132]) }),
  );
  shaft.position.y = -LEN * 0.725;
  g.add(shaft);

  const butt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0105, 0.0145, LEN * 0.45, 12),
    std({ color: '#3a1f14', roughness: 0.35, map: woodTexture(256, [70, 34, 22]) }),
  );
  butt.position.y = -LEN * 0.225;
  g.add(butt);

  const wrap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0138, 0.0146, 0.30, 12),
    std({ color: '#17161a', roughness: 0.9 }),
  );
  wrap.position.y = -0.16;
  g.add(wrap);

  const ferrule = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0064, 0.0064, 0.024, 12),
    std({ color: '#f2eee0', roughness: 0.25 }),
  );
  ferrule.position.y = -LEN + 0.012;
  g.add(ferrule);

  const tip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0062, 0.0064, 0.008, 12),
    std({ color: '#3f6bd8', roughness: 0.95 }),
  );
  tip.position.y = -LEN + 0.0;
  g.add(tip);

  // a bar cue is never straight and never clean
  g.children.forEach((c) => { c.castShadow = true; });
  g.userData.length = LEN;
  return g;
}

/**
 * The bridge hand — a green muppet paw resting on the cloth that the cue
 * slides through. WASD walks this around, which is what actually decides where
 * the tip meets the ball.
 */
export function buildBridgeHand() {
  const g = new THREE.Group();
  const fur = std({ color: '#6cc95c', roughness: 1 });

  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.052, 14, 12), fur);
  palm.scale.set(1.05, 0.62, 1.25);
  palm.position.y = 0.030;
  g.add(palm);

  // knuckles down on the cloth, thumb up to make the V the cue rides in
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0125, 0.055, 4, 8), fur);
    f.position.set(-0.035 + i * 0.024, 0.016, 0.045);
    f.rotation.set(1.15, 0, (i - 1.5) * 0.12);
    g.add(f);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0145, 0.05, 4, 8), fur);
  thumb.position.set(0.036, 0.040, 0.012);
  thumb.rotation.set(0.55, 0.2, -0.95);
  g.add(thumb);

  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.045, 0.19, 12), fur);
  wrist.position.set(0.0, 0.045, -0.115);
  wrist.rotation.set(1.35, 0, 0);
  g.add(wrist);

  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.049, 0.052, 0.05, 12),
    std({ color: '#b1332f', roughness: 0.85 }));
  cuff.position.set(0, 0.058, -0.185);
  cuff.rotation.set(1.35, 0, 0);
  g.add(cuff);

  g.children.forEach((c) => { c.castShadow = true; });
  return g;
}

/** The chalk cube that lives on the rail. */
export function buildChalk() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.024, 0.021, 0.024),
    std({ color: '#2f5fa8', roughness: 0.95 }),
  );
  g.add(body);
  const dish = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0085, 0.0085, 0.004, 10),
    std({ color: '#1f4278', roughness: 1 }),
  );
  dish.position.y = 0.0105;
  g.add(dish);
  return g;
}

/* ------------------------------------------------------------------ */
/* Junk the crowd throws                                               */
/* ------------------------------------------------------------------ */

export function buildJunkMesh(kind) {
  const g = new THREE.Group();
  if (kind === 'bottle') {
    const glass = std({ color: '#3d6b2a', roughness: 0.15, metalness: 0.1,
      transparent: true, opacity: 0.85 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.034, 0.16, 12), glass);
    body.position.y = 0.08;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.026, 0.08, 10), glass);
    neck.position.y = 0.19;
    const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0345, 0.0345, 0.06, 12),
      std({ color: '#e8d9a8', roughness: 0.9 }));
    label.position.y = 0.075;
    g.add(body, neck, label);
  } else if (kind === 'pint') {
    const glass = std({ color: '#d8c07a', roughness: 0.1, metalness: 0.05,
      transparent: true, opacity: 0.6 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.032, 0.14, 14), glass);
    body.position.y = 0.07;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.02, 14),
      std({ color: '#f6efdc', roughness: 1 }));
    head.position.y = 0.125;
    g.add(body, head);
  } else if (kind === 'chicken') {
    const rub = std({ color: '#f2d43a', roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), rub);
    body.scale.set(1.4, 0.9, 0.9);
    body.position.y = 0.05;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), rub);
    head.position.set(0.065, 0.10, 0);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.03, 6),
      std({ color: '#e8622a', roughness: 0.7 }));
    beak.position.set(0.095, 0.098, 0);
    beak.rotation.z = -Math.PI / 2;
    g.add(body, head, beak);
  } else if (kind === 'shoe') {
    const lea = std({ color: '#3b2a20', roughness: 0.85 });
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.07), lea);
    sole.position.y = 0.015;
    const upper = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), lea);
    upper.scale.set(1.2, 0.9, 0.8);
    upper.position.set(-0.03, 0.045, 0);
    g.add(sole, upper);
  } else {                     // ashtray
    const m = std({ color: '#8d8f96', roughness: 0.4, metalness: 0.3 });
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.042, 0.028, 14), m);
    dish.position.y = 0.014;
    g.add(dish);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return g;
}

/** Flat, glistening decal for the puddles the crowd leaves behind. */
export function buildPuddle(r, hue = 0.13) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(180,170,60,0.95)');
  grd.addColorStop(0.55, 'rgba(150,140,45,0.8)');
  grd.addColorStop(1, 'rgba(120,110,35,0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill();
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${140 + Math.random() * 60},${120 + Math.random() * 50},40,${Math.random() * 0.5})`;
    const a = Math.random() * 7, rr = Math.random() * 58;
    g.beginPath(); g.arc(64 + Math.cos(a) * rr, 64 + Math.sin(a) * rr, 2 + Math.random() * 7, 0, 7); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(r, 24),
    new THREE.MeshStandardMaterial({
      map: tex, transparent: true, roughness: 0.08, metalness: 0.15,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

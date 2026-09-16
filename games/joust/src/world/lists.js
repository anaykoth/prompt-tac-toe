import * as THREE from 'three';
import { LANE_HALF, START_Z, LANE_X, BARRIER_H, BARRIER_W } from '../game/spec.js';

/**
 * THE LISTS — a night tournament field.
 *
 * The lane runs along z, the tilt barrier stands on x = 0, timber stands run
 * the full length on both sides and a royal box sits at z = 0 on the -x side.
 * Everything is procedural: canvas textures, boxes, cylinders, cones.
 *
 * Locally defined (not in spec.js): TIER_RISE, TIER_RUN, STAND_X0, ROYAL_BOX.
 */

const std = (o) => new THREE.MeshStandardMaterial(o);

/* ---- local layout constants (not in spec.js) ---- */
export const TIERS = 5;
export const TIER_RISE = 0.44;
export const TIER_RUN = 0.72;
export const STAND_X0 = 3.2;          // stands begin at |x| >= 3.2
export const RAIL_X = 2.6;            // standing row pressed to the rails
export const ROYAL_BOX = new THREE.Vector3(-6.5, 1.8, 0);

/* ------------------------------------------------------------------ */
/* textures                                                            */
/* ------------------------------------------------------------------ */

function noiseTexture(w = 512, tint = [205, 200, 200], amount = 26, rep = 4) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = w;
  const g = cv.getContext('2d');
  const img = g.createImageData(w, w);
  for (let i = 0; i < w * w; i++) {
    const n = (Math.random() - 0.5) * amount;
    const blot = Math.random() < 0.002 ? -30 : 0;
    img.data[i * 4 + 0] = Math.max(0, Math.min(255, tint[0] + n + blot));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, tint[1] + n + blot));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, tint[2] + n + blot));
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep, rep);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Striped canvas drape / awning cloth. */
function stripeTexture(a = '#d8443c', b = '#f0e3c8', bands = 10, rep = [8, 1]) {
  const W = 256, H = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const bw = W / bands;
  for (let i = 0; i < bands; i++) {
    g.fillStyle = i % 2 ? b : a;
    g.fillRect(i * bw, 0, bw + 1, H);
  }
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(40,30,18,${Math.random() * 0.07})`;
    g.fillRect(Math.random() * W, Math.random() * H, 3, 3);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep[0], rep[1]);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Heraldic banner: field, chevrons or a crude rampant lion, a border. */
export function heraldryTexture(scheme = 0) {
  const SCHEMES = [
    { field: '#b4242a', ink: '#f3dfa8', trim: '#f3dfa8' },
    { field: '#20489b', ink: '#e8c34a', trim: '#e8c34a' },
    { field: '#1d6b43', ink: '#f1ece0', trim: '#f1ece0' },
    { field: '#5b2a86', ink: '#ffcf5b', trim: '#ffcf5b' },
  ];
  const S = SCHEMES[scheme % SCHEMES.length];
  const W = 256, H = 384;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = S.field; g.fillRect(0, 0, W, H);
  g.strokeStyle = S.trim; g.lineWidth = 10; g.strokeRect(9, 9, W - 18, H - 18);
  g.fillStyle = S.ink;
  if (scheme % 2 === 0) {
    // chevrons
    for (let i = 0; i < 3; i++) {
      const y = 90 + i * 92;
      g.beginPath();
      g.moveTo(34, y + 52); g.lineTo(W / 2, y); g.lineTo(W - 34, y + 52);
      g.lineTo(W - 34, y + 84); g.lineTo(W / 2, y + 32); g.lineTo(34, y + 84);
      g.closePath(); g.fill();
    }
  } else {
    // a rampant beast made of blobs
    g.beginPath(); g.ellipse(W / 2, 200, 52, 78, 0.2, 0, 7); g.fill();
    g.beginPath(); g.arc(W / 2 + 34, 118, 34, 0, 7); g.fill();          // head
    for (let i = 0; i < 9; i++) {                                       // mane
      const a = (i / 9) * 6.28;
      g.beginPath(); g.arc(W / 2 + 34 + Math.cos(a) * 40, 118 + Math.sin(a) * 40, 13, 0, 7); g.fill();
    }
    g.fillRect(W / 2 + 40, 150, 46, 18);                                // foreleg
    g.fillRect(W / 2 - 74, 246, 20, 74);                                // hind leg
    g.beginPath(); g.moveTo(W / 2 - 46, 176); g.lineTo(W / 2 - 96, 96);
    g.lineTo(W / 2 - 78, 92); g.lineTo(W / 2 - 34, 172); g.closePath(); g.fill();  // tail
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function skyTexture() {
  const W = 8, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#05070f');
  grd.addColorStop(0.55, '#101a35');
  grd.addColorStop(0.85, '#2a2b45');
  grd.addColorStop(1, '#3b3020');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(255,252,235,${Math.random() * 0.8})`;
    g.fillRect(Math.random() * W, Math.random() * H * 0.6, 1, 1);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */

export function buildLists() {
  const group = new THREE.Group();
  group.name = 'lists';
  const dyn = [];

  const FIELD_W = 26, FIELD_D = LANE_HALF * 2 + 22;
  const HALL_H = 14;

  /* ---------- turf ---------- */
  const turf = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD_W * 2, FIELD_D),
    std({ color: '#4a5a2c', roughness: 0.96, metalness: 0, map: noiseTexture(512, [180, 178, 150], 34, 26) }),
  );
  turf.rotation.x = -Math.PI / 2;
  turf.receiveShadow = true;
  group.add(turf);

  // hoof-churned riding lines
  const churnTex = noiseTexture(256, [150, 128, 96], 46, 18);
  for (const s of [1, -1]) {
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, LANE_HALF * 2 + 6),
      std({ color: '#6b552f', roughness: 1, map: churnTex, transparent: true, opacity: 0.85 }),
    );
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(s * LANE_X, 0.006, 0);
    strip.receiveShadow = true;
    group.add(strip);
  }

  /* ---------- the tilt barrier ---------- */
  const timber = std({ color: '#6a4c2c', roughness: 0.92, map: noiseTexture(256, [190, 175, 155], 30, 6) });
  const rail = new THREE.Mesh(new THREE.BoxGeometry(BARRIER_W, 0.16, LANE_HALF * 2), timber);
  rail.position.set(0, BARRIER_H - 0.08, 0);
  rail.castShadow = true; rail.receiveShadow = true;
  group.add(rail);

  const postGeo = new THREE.BoxGeometry(BARRIER_W * 1.6, BARRIER_H, BARRIER_W * 1.6);
  for (let z = -LANE_HALF; z <= LANE_HALF + 0.01; z += 2) {
    const p = new THREE.Mesh(postGeo, timber);
    p.position.set(0, BARRIER_H / 2, z);
    p.castShadow = true;
    group.add(p);
  }

  // striped canvas drape on both faces
  const drapeTex = stripeTexture('#c4342f', '#efe2c4', 12, [26, 1]);
  const drapeMat = std({ map: drapeTex, roughness: 0.95, side: THREE.DoubleSide });
  for (const s of [1, -1]) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(LANE_HALF * 2, BARRIER_H - 0.2), drapeMat);
    d.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    d.position.set(s * (BARRIER_W / 2 + 0.01), (BARRIER_H - 0.2) / 2 + 0.05, 0);
    d.receiveShadow = true;
    group.add(d);
  }

  /* ---------- stands ---------- */
  const deckTex = noiseTexture(256, [176, 158, 132], 28, 8);
  const deckMat = std({ color: '#7a5a34', roughness: 0.94, map: deckTex });
  const riserMat = std({ color: '#4f3a22', roughness: 0.95 });
  const standLen = LANE_HALF * 2 + 4;
  for (const s of [-1, 1]) {
    for (let t = 0; t < TIERS; t++) {
      const x = s * (STAND_X0 + t * TIER_RUN + TIER_RUN / 2);
      const y = (t + 1) * TIER_RISE;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(TIER_RUN, 0.1, standLen), deckMat);
      deck.position.set(x, y, 0);
      deck.receiveShadow = true;
      group.add(deck);
      const riser = new THREE.Mesh(new THREE.BoxGeometry(0.08, TIER_RISE, standLen), riserMat);
      riser.position.set(x - s * TIER_RUN / 2, y - TIER_RISE / 2, 0);
      group.add(riser);
    }
    // back wall
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, TIERS * TIER_RISE + 0.9, standLen),
      std({ color: '#3c2d1b', roughness: 0.96, map: deckTex }),
    );
    back.position.set(s * (STAND_X0 + TIERS * TIER_RUN + 0.1), (TIERS * TIER_RISE + 0.9) / 2, 0);
    group.add(back);
  }

  /* ---------- royal box ---------- */
  const royal = new THREE.Group();
  royal.position.set(ROYAL_BOX.x, 0, ROYAL_BOX.z);
  group.add(royal);
  const boxW = 3.4, boxD = 4.6, boxH = ROYAL_BOX.y;
  const plat = new THREE.Mesh(new THREE.BoxGeometry(boxW, 0.18, boxD), deckMat);
  plat.position.y = boxH;
  plat.receiveShadow = true; plat.castShadow = true;
  royal.add(plat);
  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, boxH, 8), timber);
      leg.position.set(dx * (boxW / 2 - 0.2), boxH / 2, dz * (boxD / 2 - 0.2));
      royal.add(leg);
    }
  }
  // rail at the front (toward the lane, +x)
  const frontRail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, boxD), timber);
  frontRail.position.set(boxW / 2, boxH + 0.7, 0);
  royal.add(frontRail);
  const drape2 = new THREE.Mesh(
    new THREE.PlaneGeometry(boxD, boxH * 0.9),
    std({ map: stripeTexture('#5b2a86', '#ffcf5b', 8, [4, 1]), roughness: 0.95, side: THREE.DoubleSide }),
  );
  drape2.rotation.y = Math.PI / 2;
  drape2.position.set(boxW / 2 + 0.02, boxH * 0.55, 0);
  royal.add(drape2);

  // striped awning
  const awningMat = std({ map: stripeTexture('#efe2c4', '#b4242a', 10, [5, 1]), roughness: 0.9, side: THREE.DoubleSide });
  const awning = new THREE.Mesh(new THREE.ConeGeometry(boxD * 0.62, 1.0, 4, 1, false), awningMat);
  awning.position.y = boxH + 2.3;
  awning.rotation.y = Math.PI / 4;
  awning.castShadow = true;
  royal.add(awning);
  for (const dz of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.1, 8), timber);
    post.position.set(boxW / 2 - 0.2, boxH + 1.05, dz * (boxD / 2 - 0.3));
    royal.add(post);
  }

  /* ---------- heraldic banners ---------- */
  const bannerMats = [0, 1, 2, 3].map((i) => std({ map: heraldryTexture(i), roughness: 0.95, side: THREE.DoubleSide }));
  const bannerGeo = new THREE.PlaneGeometry(0.8, 1.2);
  const banners = [];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(bannerGeo, bannerMats[i]);
    b.position.set(boxW / 2 + 0.05, boxH + 1.6, -1.6 + i * 1.05);
    b.rotation.y = Math.PI / 2;
    royal.add(b);
    banners.push(b);
  }
  // banners along the back walls of both stands
  for (const s of [-1, 1]) {
    for (let z = -LANE_HALF + 4; z <= LANE_HALF - 4; z += 7) {
      const b = new THREE.Mesh(bannerGeo, bannerMats[(Math.abs(z / 7) | 0) % 4]);
      b.position.set(s * (STAND_X0 + TIERS * TIER_RUN - 0.05), TIERS * TIER_RISE + 0.9, z);
      b.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      group.add(b);
      banners.push(b);
    }
  }
  dyn.push({
    update(t, dt, hype) {
      const k = 1 + hype;
      for (let i = 0; i < banners.length; i++) {
        banners[i].rotation.z = Math.sin(t * (1.4 + (i % 3) * 0.3) + i) * 0.05 * k;
        banners[i].scale.x = 1 + Math.sin(t * 2.1 + i * 1.7) * 0.05 * k;
      }
    },
  });

  /* ---------- pennant flags ---------- */
  const pennMat = [
    std({ color: '#d8443c', roughness: 0.9, side: THREE.DoubleSide }),
    std({ color: '#3a6fd8', roughness: 0.9, side: THREE.DoubleSide }),
    std({ color: '#e8c34a', roughness: 0.9, side: THREE.DoubleSide }),
  ];
  const pennGeo = new THREE.ConeGeometry(0.16, 0.7, 3, 1, false).rotateZ(-Math.PI / 2).translate(0.35, 0, 0);
  const poleGeo = new THREE.CylinderGeometry(0.035, 0.045, 3.0, 7);
  const pennants = [];
  const addPennant = (x, y, z, ci) => {
    const pole = new THREE.Mesh(poleGeo, timber);
    pole.position.set(x, y + 1.5, z);
    group.add(pole);
    const f = new THREE.Mesh(pennGeo, pennMat[ci % 3]);
    f.position.set(x, y + 2.85, z);
    group.add(f);
    pennants.push(f);
  };
  // lane ends
  for (const s of [-1, 1]) for (const zs of [-1, 1]) addPennant(s * 1.9, 0, zs * (LANE_HALF + 1.2), zs > 0 ? 0 : 1);
  // along the stands
  let ci = 0;
  for (const s of [-1, 1]) {
    for (let z = -LANE_HALF; z <= LANE_HALF + 0.01; z += 6) {
      addPennant(s * (STAND_X0 + TIERS * TIER_RUN + 0.35), TIERS * TIER_RISE, z, ci++);
    }
  }
  dyn.push({
    update(t, dt, hype) {
      const k = 1 + hype;
      for (let i = 0; i < pennants.length; i++) {
        const f = pennants[i];
        f.rotation.y = Math.sin(t * 1.1 + i) * 0.5 + 0.6;
        f.rotation.z = Math.sin(t * (3.2 + (i % 4) * 0.4) + i * 0.7) * 0.22 * k;
      }
    },
  });

  /* ---------- starting pavilions ---------- */
  const PAV = [{ z: START_Z + 2.5, colour: '#d8443c', x: LANE_X + 2.0 }, { z: -(START_Z + 2.5), colour: '#3a6fd8', x: -LANE_X - 2.0 }];
  for (const p of PAV) {
    const tent = new THREE.Group();
    tent.position.set(p.x, 0, p.z);
    const cloth = std({ map: stripeTexture(p.colour, '#f0e3c8', 10, [3, 1]), roughness: 0.94, side: THREE.DoubleSide });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 1.5, 10, 1, true), cloth);
    body.position.y = 0.75;
    body.castShadow = true;
    tent.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.85, 1.5, 10), cloth);
    roof.position.y = 2.2;
    roof.castShadow = true;
    tent.add(roof);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), std({ color: '#e8c34a', roughness: 0.4, metalness: 0.5 }));
    finial.position.y = 3.0;
    tent.add(finial);
    const flag = new THREE.Mesh(pennGeo, std({ color: p.colour, roughness: 0.9, side: THREE.DoubleSide }));
    flag.position.y = 3.05;
    tent.add(flag);
    pennants.push(flag);
    group.add(tent);
  }

  /* ---------- sky ---------- */
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(90, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }),
  );
  group.add(sky);

  /* ---------- lighting ---------- */
  const lights = new THREE.Group();
  const hemi = new THREE.HemisphereLight(0x5b6690, 0x2a1f12, 0.55);
  lights.add(hemi);
  const ambient = new THREE.AmbientLight(0xffe0b0, 0.16);
  lights.add(ambient);

  // three coloured rims — main.js scales these by hype
  const rimL = new THREE.PointLight(0xff6a2f, 40, 34, 2); rimL.position.set(-7.5, 6.0, -8);
  const rimR = new THREE.PointLight(0x3a8cff, 40, 34, 2); rimR.position.set(7.5, 6.0, 8);
  const rimB = new THREE.PointLight(0xffc04a, 30, 30, 2); rimB.position.set(0, 7.5, 0);
  lights.add(rimL, rimR, rimB);

  // torch posts every 8 m, both sides
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb040, fog: false });
  const torches = [];
  const practicals = [];
  const bowlGeo = new THREE.CylinderGeometry(0.22, 0.13, 0.26, 9);
  const flameGeo = new THREE.ConeGeometry(0.19, 0.5, 8);
  const torchPoleGeo = new THREE.CylinderGeometry(0.07, 0.09, 2.5, 8);
  for (const s of [-1, 1]) {
    for (let z = -LANE_HALF; z <= LANE_HALF + 0.01; z += 8) {
      const x = s * (RAIL_X + 0.35);
      const pole = new THREE.Mesh(torchPoleGeo, timber);
      pole.position.set(x, 1.25, z);
      pole.castShadow = true;
      group.add(pole);
      const bowl = new THREE.Mesh(bowlGeo, std({ color: '#2b2118', roughness: 0.7, metalness: 0.4 }));
      bowl.position.set(x, 2.6, z);
      group.add(bowl);
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(x, 2.9, z);
      group.add(flame);
      const pl = new THREE.PointLight(0xffa348, 16, 11, 2);
      pl.position.set(x, 2.95, z);
      lights.add(pl);
      practicals.push(pl);
      torches.push({ pl, flame, base: 16, seed: Math.random() * 100 });
    }
  }
  dyn.push({
    update(t, dt, hype) {
      for (let i = 0; i < torches.length; i++) {
        const o = torches[i];
        const f = 0.78 + Math.sin(t * 11 + o.seed) * 0.12 + Math.sin(t * 27.3 + o.seed * 2) * 0.08 + Math.random() * 0.06;
        o.pl.intensity = o.base * f * (1 + hype * 0.35);
        o.flame.scale.set(0.9 + f * 0.2, 0.8 + f * 0.45, 0.9 + f * 0.2);
        o.flame.rotation.z = Math.sin(t * 6 + o.seed) * 0.12;
      }
    },
  });

  group.add(lights);

  return {
    group,
    dyn,
    lights: { hemi, ambient, rims: [rimL, rimR, rimB], practicals },
    stageH: 0,
    hall: { w: FIELD_W, d: FIELD_D, h: HALL_H },
  };
}

/* ------------------------------------------------------------------ */

/**
 * Seats for the darts Crowd: both stands' tiers, a standing row at the rails,
 * and the royal box. Sorted by rank (0 = best view of the tilt), sliced to
 * `target`.
 */
export function crowdSeats(target = 140) {
  const seats = [];
  const R = () => Math.random() - 0.5;

  for (const s of [-1, 1]) {
    for (let t = 0; t < TIERS; t++) {
      const x = s * (STAND_X0 + t * TIER_RUN + TIER_RUN / 2);
      const y = (t + 1) * TIER_RISE + 0.05;
      for (let i = 0; i < 26; i++) {
        const z = -LANE_HALF + 1 + i * ((LANE_HALF * 2 - 2) / 25) + (t % 2) * 0.3;
        seats.push({
          pos: new THREE.Vector3(x + R() * 0.26, y, z + R() * 0.2),
          sit: true, tier: t, side: s,
          rank: 0.6 + t * 0.06 + Math.abs(z) * 0.055,
        });
      }
    }
  }

  // standing row pressed against the barrier rails
  for (const s of [-1, 1]) {
    for (let i = 0; i < 26; i++) {
      const z = -LANE_HALF + 1.5 + i * ((LANE_HALF * 2 - 3) / 25);
      seats.push({
        pos: new THREE.Vector3(s * (RAIL_X + Math.random() * 0.3), 0, z + R() * 0.24),
        sit: false, tier: -1, side: s,
        rank: 0.3 + Math.abs(z) * 0.05,
      });
    }
  }

  // the royal box — best seats in the lists
  for (let i = 0; i < 8; i++) {
    seats.push({
      pos: new THREE.Vector3(
        ROYAL_BOX.x + 0.6 + (i % 2) * 0.7 + R() * 0.12,
        ROYAL_BOX.y + 0.18,
        ROYAL_BOX.z - 1.5 + ((i / 2) | 0) * 1.0 + R() * 0.16,
      ),
      sit: true, tier: 0, side: -1, rank: 0,
    });
  }

  seats.sort((a, b) => a.rank - b.rank);
  return seats.slice(0, Math.min(target, seats.length));
}

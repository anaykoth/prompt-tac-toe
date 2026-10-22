import * as THREE from 'three';
import { BOARD_HEIGHT, OCHE_DIST, R } from './dartboard.js';

const std = (o) => new THREE.MeshStandardMaterial(o);

/** Height of the step the front row stands on, against the board wall. */
export const WALL_KERB = 0.34;

/** Cheap procedural grunge for the plaster/timber. */
function noiseTexture(w = 512, tint = [205, 200, 200], amount = 26, rep = 4) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = w;
  const g = cv.getContext('2d');
  const img = g.createImageData(w, w);
  for (let i = 0; i < w * w; i++) {
    const n = (Math.random() - 0.5) * amount;
    const blot = Math.random() < 0.0016 ? -34 : 0;
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

/** Soft round sprite so point clouds don't render as hard squares. */
export function softDotTexture() {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(cv);
}

function chalkboardTexture() {
  const W = 512, H = 640;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#12211c'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(220,235,225,${Math.random() * 0.035})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  g.strokeStyle = 'rgba(226,240,232,.75)'; g.lineWidth = 3;
  g.strokeRect(18, 18, W - 36, H - 36);
  g.beginPath(); g.moveTo(W / 2, 96); g.lineTo(W / 2, H - 30); g.stroke();
  g.beginPath(); g.moveTo(24, 96); g.lineTo(W - 24, 96); g.stroke();
  g.fillStyle = 'rgba(232,244,236,.9)';
  g.font = '700 44px "Barlow Condensed", Impact, sans-serif';
  g.textAlign = 'center';
  g.fillText('THE ALLEY', W / 2, 74);
  g.font = '600 30px "Barlow Condensed", Impact, sans-serif';
  g.fillText('US', W * 0.25, 140); g.fillText('THEM', W * 0.75, 140);
  g.font = '400 26px "Barlow Condensed", Impact, sans-serif';
  const rows = ['180', '60', '85', '41', '100', 'IIII', '26', '77'];
  for (let i = 0; i < 8; i++) {
    g.globalAlpha = 0.5 + Math.random() * 0.4;
    g.fillText(rows[i], W * 0.25 + (Math.random() - .5) * 8, 190 + i * 46);
    g.fillText(rows[(i + 3) % 8], W * 0.75 + (Math.random() - .5) * 8, 190 + i * 46);
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function posterTexture(title, sub, hue) {
  const W = 256, H = 384;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = `hsl(${hue},58%,42%)`; g.fillRect(0, 0, W, H);
  g.fillStyle = `hsl(${(hue + 180) % 360},70%,88%)`;
  g.fillRect(12, 12, W - 24, H - 24);
  g.fillStyle = `hsl(${hue},64%,22%)`;
  g.font = '700 46px "Barlow Condensed", Impact, sans-serif';
  g.textAlign = 'center';
  title.split(' ').forEach((wd, i) => g.fillText(wd, W / 2, 90 + i * 46));
  g.font = '600 20px "Barlow Condensed", Impact, sans-serif';
  g.fillText(sub, W / 2, H - 52);
  g.beginPath(); g.arc(W / 2, H / 2 + 42, 46, 0, 7); g.strokeStyle = `hsl(${hue},64%,22%)`; g.lineWidth = 5; g.stroke();
  g.beginPath(); g.arc(W / 2, H / 2 + 42, 16, 0, 7); g.fillStyle = `hsl(${hue},64%,32%)`; g.fill();
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(60,40,20,${Math.random() * 0.06})`;
    g.fillRect(Math.random() * W, Math.random() * H, 3, 3);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */

export function buildArena() {
  const group = new THREE.Group();
  const dyn = [];   // { update(t, dt, hype) }

  const HALL_W = 15, HALL_D = 15, HALL_H = 6.2;

  /* ---------- floor ---------- */
  const floorTex = noiseTexture(512, [196, 186, 176], 26, 12);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(HALL_W, HALL_D),
    std({ color: '#3a3029', roughness: 0.86, metalness: 0.02, map: floorTex }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = HALL_D / 2 - 4.2;
  floor.receiveShadow = true;
  group.add(floor);

  /* ---------- throwing lane: a strip of worn boards ---------- */
  const lane = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 0.02, 5.4),
    std({ color: '#6b4f33', roughness: 0.6, map: noiseTexture(256, [214, 192, 166], 34, 6) }),
  );
  lane.position.set(0, 0.011, 2.0);
  lane.receiveShadow = true;
  group.add(lane);

  /* ---------- back wall (the board wall) ---------- */
  const wallMat = std({ color: '#5b4a46', roughness: 0.95, map: noiseTexture(512, [206, 198, 208], 28, 6) });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(HALL_W, HALL_H), wallMat);
  wall.position.set(0, HALL_H / 2, -0.06);
  wall.receiveShadow = true;
  wall.name = 'backwall';
  group.add(wall);

  // timber wainscot
  const wains = new THREE.Mesh(
    new THREE.BoxGeometry(HALL_W, 1.1, 0.06),
    std({ color: '#4b3524', roughness: 0.72, map: noiseTexture(256, [210, 190, 168], 30, 8) }),
  );
  wains.position.set(0, 0.55, -0.02);
  group.add(wains);

  /* ---------- side + rear walls, ceiling ---------- */
  const sideMat = std({ color: '#3c3540', roughness: 0.96, map: noiseTexture(512, [200, 192, 202], 26, 8) });
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(HALL_D, HALL_H), sideMat);
    w.rotation.y = -s * Math.PI / 2;
    w.position.set(s * HALL_W / 2, HALL_H / 2, HALL_D / 2 - 4.2);
    group.add(w);
  }
  const rear = new THREE.Mesh(new THREE.PlaneGeometry(HALL_W, HALL_H), sideMat);
  rear.rotation.y = Math.PI;
  rear.position.set(0, HALL_H / 2, HALL_D - 4.2);
  group.add(rear);

  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(HALL_W, HALL_D),
    std({ color: '#17141a', roughness: 1 }),
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, HALL_H, HALL_D / 2 - 4.2);
  group.add(ceil);

  /* ---------- board backboard + oche furniture ---------- */
  const backboard = new THREE.Mesh(
    new THREE.CylinderGeometry(0.44, 0.44, 0.05, 40),
    std({ color: '#4a3626', roughness: 0.8, map: noiseTexture(256, [206, 186, 164], 24, 3) }),
  );
  backboard.rotation.x = Math.PI / 2;
  backboard.position.set(0, BOARD_HEIGHT, -0.03);
  backboard.receiveShadow = true;
  group.add(backboard);

  // scuffed halo of old dart holes, tight around the wire
  const HOLES = 170;
  const holes = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.0026, 6),
    new THREE.MeshBasicMaterial({ color: '#191410' }),
    HOLES,
  );
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < HOLES; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = R.doubleOut + 0.006 + Math.pow(Math.random(), 2.4) * 0.14;
    m4.makeTranslation(Math.cos(a) * rr, BOARD_HEIGHT + Math.sin(a) * rr, -0.0035);
    holes.setMatrixAt(i, m4);
  }
  group.add(holes);

  /* ---------- the stage ---------- */
  const STAGE_Z0 = 1.55, STAGE_Z1 = 4.3, STAGE_H = 0.17;
  const stage = new THREE.Mesh(
    new THREE.BoxGeometry(3.3, STAGE_H, STAGE_Z1 - STAGE_Z0),
    std({ color: '#2a2530', roughness: 0.55, metalness: 0.06, map: noiseTexture(256, [200, 194, 208], 22, 4) }),
  );
  stage.position.set(0, STAGE_H / 2, (STAGE_Z0 + STAGE_Z1) / 2);
  stage.castShadow = stage.receiveShadow = true;
  group.add(stage);

  // stage nosing strip
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(3.34, 0.035, 0.05),
    std({ color: '#c8a13c', roughness: 0.35, metalness: 0.7, emissive: '#3a2c08' }),
  );
  nose.position.set(0, STAGE_H - 0.014, STAGE_Z0 - 0.012);
  group.add(nose);

  // the oche — the throw line
  const oche = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.032, 0.05),
    std({ color: '#e8e2d2', roughness: 0.4, emissive: '#332f26' }),
  );
  oche.position.set(0, STAGE_H + 0.014, OCHE_DIST);
  group.add(oche);
  group.userData.stageH = STAGE_H;

  /* ---------- kerb along the back wall for the front row ---------- */
  for (const s of [-1, 1]) {
    const kerb = new THREE.Mesh(
      new THREE.BoxGeometry(2.9, WALL_KERB, 0.95),
      std({ color: '#3a3038', roughness: 0.9, map: noiseTexture(256, [200, 192, 200], 22, 3) }),
    );
    kerb.position.set(s * 2.85, WALL_KERB / 2, 0.42);
    kerb.receiveShadow = true;
    group.add(kerb);
  }

  /* ---------- crowd barrier rails ---------- */
  const railMat = std({ color: '#8e939c', roughness: 0.3, metalness: 0.9 });
  for (const s of [-1, 1]) {
    for (const h of [0.55, 1.02]) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 7.6, 8), railMat);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(s * 2.05, h, 2.0);
      group.add(bar);
    }
    for (let i = 0; i < 7; i++) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 1.06, 8), railMat);
      post.position.set(s * 2.05, 0.53, -1.4 + i * 1.2);
      group.add(post);
    }
  }

  /* ---------- bleachers ---------- */
  const tierMat = std({ color: '#221d28', roughness: 0.9 });
  const benchMat = std({ color: '#59331f', roughness: 0.75 });
  const TIERS = 5, TIER_RISE = 0.44, TIER_RUN = 0.72, TIER_X0 = 2.35;
  for (const s of [-1, 1]) {
    for (let t = 0; t < TIERS; t++) {
      const x = s * (TIER_X0 + t * TIER_RUN + TIER_RUN / 2);
      const h = (t + 1) * TIER_RISE;
      const step = new THREE.Mesh(new THREE.BoxGeometry(TIER_RUN, h, 9.6), tierMat);
      step.position.set(x, h / 2, 1.4);
      step.receiveShadow = true;
      group.add(step);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(TIER_RUN * 0.94, 0.05, 9.5), benchMat);
      bench.position.set(x, h + 0.026, 1.4);
      group.add(bench);
    }
  }
  // rear gallery
  for (let t = 0; t < 3; t++) {
    const z = 5.4 + t * 0.8;
    const h = 0.5 + t * 0.46;
    const step = new THREE.Mesh(new THREE.BoxGeometry(4.9, h, 0.8), tierMat);
    step.position.set(0, h / 2, z);
    group.add(step);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.05, 0.74), benchMat);
    bench.position.set(0, h + 0.026, z);
    group.add(bench);
  }

  /* ---------- wall dressing ---------- */
  const chalk = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 1.25),
    std({ map: chalkboardTexture(), roughness: 0.95 }),
  );
  chalk.position.set(-2.55, 1.85, -0.05);
  group.add(chalk);
  const chalkFrame = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.35, 0.05),
    std({ color: '#3b2a1c', roughness: 0.8 }),
  );
  chalkFrame.position.set(-2.55, 1.85, -0.075);
  group.add(chalkFrame);

  const posters = [
    ['TUNGSTEN NIGHT', 'EVERY THURSDAY', 18],
    ['THE BIG FISH', 'DOUBLE OR NOTHING', 200],
    ['FELT & FUR', 'OPEN MIC', 300],
  ];
  posters.forEach(([tt, ss, hue], i) => {
    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(0.52, 0.78),
      std({ map: posterTexture(tt, ss, hue), roughness: 0.92 }),
    );
    p.position.set(2.2 + i * 0.72, 1.9 + (i % 2) * 0.22, -0.048);
    p.rotation.z = (Math.random() - 0.5) * 0.06;
    group.add(p);
  });

  /* ---------- lighting ---------- */
  const lights = new THREE.Group();

  const hemi = new THREE.HemisphereLight(0x7d86a4, 0x3a2a1c, 0.72);
  lights.add(hemi);

  const ambient = new THREE.AmbientLight(0xfff2e0, 0.2);
  lights.add(ambient);

  // key spots on the board, from the ceiling in front
  const boardSpots = [];
  for (const s of [-1, 1]) {
    const sp = new THREE.SpotLight(0xfff0d4, 11, 9, 0.4, 0.5, 2);
    sp.position.set(s * 1.05, 3.4, 1.5);
    sp.target.position.set(0, BOARD_HEIGHT, 0);
    sp.castShadow = s === 1;
    sp.shadow.mapSize.set(1536, 1536);
    sp.shadow.bias = -0.0009;
    sp.shadow.normalBias = 0.02;
    sp.shadow.camera.near = 0.6;
    sp.shadow.camera.far = 9;
    lights.add(sp, sp.target);
    boardSpots.push(sp);
  }

  // stage wash
  const stageSpot = new THREE.SpotLight(0xffe6c0, 22, 10, 0.6, 0.7, 2);
  stageSpot.position.set(0, 4.4, 3.4);
  stageSpot.target.position.set(0, 0.2, 2.7);
  lights.add(stageSpot, stageSpot.target);

  // coloured crowd rims
  const rimL = new THREE.PointLight(0xff2f6a, 30, 18, 2); rimL.position.set(-4.2, 3.6, 2.6);
  const rimR = new THREE.PointLight(0x2fa8ff, 30, 18, 2); rimR.position.set(4.2, 3.6, 2.6);
  const rimB = new THREE.PointLight(0xffb03a, 22, 16, 2); rimB.position.set(0, 2.9, 6.2);
  lights.add(rimL, rimR, rimB);

  // warm practicals over the stands so the crowd actually reads
  const practicals = [];
  for (const s of [-1, 1]) {
    for (const z of [0.2, 3.6]) {
      const pl = new THREE.PointLight(0xffcf96, 22, 14, 2);
      pl.position.set(s * 3.9, 4.0, z);
      lights.add(pl);
      practicals.push(pl);
    }
  }

  /* ---------- hanging practicals ---------- */
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  const shadeMat = std({ color: '#1c1a20', roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide });
  const pendants = [];
  for (let i = 0; i < 7; i++) {
    const x = -4.5 + i * 1.5, z = 3.4 + (i % 2) * 1.1;
    const p = new THREE.Group();
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.5, 5), std({ color: '#0d0c10' }));
    cord.position.y = HALL_H - 0.75;
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.16, 14, 1, true), shadeMat);
    shade.position.y = HALL_H - 1.52;
    shade.rotation.x = Math.PI;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), bulbMat);
    bulb.position.y = HALL_H - 1.58;
    p.add(cord, shade, bulb);
    p.position.set(x, 0, z);
    p.userData = { bulb, phase: Math.random() * 9, x, z };
    group.add(p);
    pendants.push(p);
  }
  dyn.push({
    update(t, dt, hype) {
      for (const p of pendants) {
        p.rotation.z = Math.sin(t * 1.6 + p.userData.phase) * (0.012 + hype * 0.16);
        p.rotation.x = Math.cos(t * 1.3 + p.userData.phase) * (0.008 + hype * 0.11);
        const f = 0.86 + Math.sin(t * 13 + p.userData.phase) * 0.05 + hype * 0.5;
        p.userData.bulb.material.color.setRGB(1 * f, 0.85 * f, 0.63 * f);
      }
    },
  });

  /* ---------- ceiling truss ---------- */
  const trussMat = std({ color: '#26242c', roughness: 0.5, metalness: 0.8 });
  for (let i = 0; i < 4; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(HALL_W, 0.09, 0.09), trussMat);
    bar.position.set(0, HALL_H - 0.16, -1 + i * 2.4);
    group.add(bar);
  }

  /* ---------- haze ---------- */
  const hazeCount = 240;
  const hz = new Float32Array(hazeCount * 3);
  for (let i = 0; i < hazeCount; i++) {
    hz[i * 3 + 0] = (Math.random() - 0.5) * 11;
    hz[i * 3 + 1] = Math.random() * 4.4 + 0.3;
    hz[i * 3 + 2] = Math.random() * 10 - 2.5;
  }
  const hazeGeo = new THREE.BufferGeometry();
  hazeGeo.setAttribute('position', new THREE.BufferAttribute(hz, 3));
  const haze = new THREE.Points(hazeGeo, new THREE.PointsMaterial({
    color: 0xffd9b0, size: 0.05, transparent: true, opacity: 0.13,
    map: softDotTexture(), alphaTest: 0.01,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  group.add(haze);
  dyn.push({
    update(t) {
      const a = hazeGeo.attributes.position.array;
      for (let i = 0; i < hazeCount; i++) {
        a[i * 3 + 1] += 0.0016 + (i % 7) * 0.00018;
        if (a[i * 3 + 1] > 4.9) a[i * 3 + 1] = 0.25;
        a[i * 3 + 0] += Math.sin(t * 0.4 + i) * 0.0004;
      }
      hazeGeo.attributes.position.needsUpdate = true;
    },
  });

  group.add(lights);

  return {
    group,
    dyn,
    lights: { hemi, ambient, boardSpots, stageSpot, rims: [rimL, rimR, rimB], practicals },
    stageH: STAGE_H,
    hall: { w: HALL_W, d: HALL_D, h: HALL_H },
  };
}

/**
 * Seats for the crowd: side bleachers, rear gallery, and a standing pit
 * pressed up against the barrier rails.
 */
export function crowdSeats(target = 132) {
  const seats = [];
  const TIERS = 5, TIER_RISE = 0.44, TIER_RUN = 0.72, TIER_X0 = 2.35;

  for (const s of [-1, 1]) {
    for (let t = 0; t < TIERS; t++) {
      const x = s * (TIER_X0 + t * TIER_RUN + TIER_RUN / 2);
      const y = (t + 1) * TIER_RISE + 0.05;
      for (let i = 0; i < 12; i++) {
        const z = -2.9 + i * 0.79 + (t % 2) * 0.2;
        seats.push({
          pos: new THREE.Vector3(x + (Math.random() - .5) * 0.24, y, z + (Math.random() - .5) * 0.16),
          sit: true, tier: t, side: s,
          rank: t * 0.2 + Math.abs(z - 1.5) * 0.05,
        });
      }
    }
  }
  // rear gallery
  for (let t = 0; t < 3; t++) {
    for (let i = 0; i < 8; i++) {
      seats.push({
        pos: new THREE.Vector3(-2.1 + i * 0.6 + (Math.random() - .5) * 0.2, 0.5 + t * 0.46 + 0.05, 5.4 + t * 0.8),
        sit: true, tier: t, side: 0, rank: 1.2 + t * 0.2,
      });
    }
  }
  // standing pit at the rails
  for (const s of [-1, 1]) {
    for (let i = 0; i < 11; i++) {
      seats.push({
        pos: new THREE.Vector3(s * (2.22 + Math.random() * 0.22), 0, -1.5 + i * 0.78 + (Math.random() - .5) * 0.2),
        sit: false, tier: -1, side: s, rank: 0.4,
      });
    }
  }

  // pressed against the back wall either side of the board — the only ones the
  // thrower can see while aiming, so they get top priority
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      seats.push({
        pos: new THREE.Vector3(
          s * (1.45 + i * 0.42 + Math.random() * 0.1),
          WALL_KERB,
          0.18 + (i % 2) * 0.34 + Math.random() * 0.12,
        ),
        sit: false, wall: true, tier: -1, side: s, rank: 0,
      });
    }
  }

  seats.sort((a, b) => a.rank - b.rank);
  return seats.slice(0, Math.min(target, seats.length));
}

import * as THREE from 'three';
import { TABLE } from './physics.js';
import { softDotTexture } from '../world/arena.js';

const std = (o) => new THREE.MeshStandardMaterial(o);
const basic = (o) => new THREE.MeshBasicMaterial(o);

/* ------------------------------------------------------------------ */
/* Textures                                                            */
/* ------------------------------------------------------------------ */

function grungeTexture(w = 512, tint = [200, 190, 180], amount = 26, rep = 4, blots = 0.0016) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = w;
  const g = cv.getContext('2d');
  const img = g.createImageData(w, w);
  for (let i = 0; i < w * w; i++) {
    const n = (Math.random() - 0.5) * amount;
    const blot = Math.random() < blots ? -40 : 0;
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

/** Floorboards, stained by decades of spilled everything. */
function floorTexture() {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#3b2c20';
  g.fillRect(0, 0, S, S);
  const plank = S / 12;
  for (let i = 0; i < 12; i++) {
    const shade = 40 + Math.random() * 26;
    g.fillStyle = `rgb(${(shade + 24) | 0},${(shade * 0.72) | 0},${(shade * 0.5) | 0})`;
    g.fillRect(0, i * plank, S, plank - 2);
    for (let k = 0; k < 200; k++) {
      g.strokeStyle = `rgba(20,12,8,${Math.random() * 0.18})`;
      g.lineWidth = Math.random() * 1.6;
      const y = i * plank + Math.random() * plank;
      g.beginPath();
      g.moveTo(Math.random() * S, y);
      g.lineTo(Math.random() * S, y + (Math.random() - 0.5) * 3);
      g.stroke();
    }
  }
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 6 + Math.random() * 44;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(24,14,6,${0.1 + Math.random() * 0.2})`);
    grd.addColorStop(1, 'rgba(24,14,6,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Neon sign: a glowing tube on a dark backing, used as an emissive plane. */
function neonTexture(text, hue, sub = '') {
  const W = 512, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#08070c';
  g.fillRect(0, 0, W, H);
  g.textAlign = 'center';
  g.textBaseline = 'middle';

  const draw = (blur, colour, width) => {
    g.shadowBlur = blur;
    g.shadowColor = colour;
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.font = '700 92px "Barlow Condensed", Impact, sans-serif';
    g.strokeText(text, W / 2, sub ? H * 0.4 : H * 0.5);
    if (sub) {
      g.font = '600 40px "Barlow Condensed", Impact, sans-serif';
      g.strokeText(sub, W / 2, H * 0.75);
    }
  };
  draw(50, `hsl(${hue},100%,45%)`, 17);
  draw(26, `hsl(${hue},100%,66%)`, 8);
  draw(6, '#ffffff', 3);
  g.shadowBlur = 0;

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function posterTexture(title, sub, hue) {
  const W = 256, H = 384;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = `hsl(${hue},48%,34%)`;
  g.fillRect(0, 0, W, H);
  g.fillStyle = `hsl(${(hue + 190) % 360},62%,86%)`;
  g.fillRect(10, 10, W - 20, H - 20);
  g.fillStyle = `hsl(${hue},60%,20%)`;
  g.textAlign = 'center';
  g.font = '700 44px "Barlow Condensed", Impact, sans-serif';
  title.split(' ').forEach((w, i) => g.fillText(w, W / 2, 84 + i * 44));
  g.font = '600 20px "Barlow Condensed", Impact, sans-serif';
  g.fillText(sub, W / 2, H - 44);
  g.beginPath(); g.arc(W / 2, H * 0.62, 44, 0, 7);
  g.strokeStyle = `hsl(${hue},60%,20%)`; g.lineWidth = 5; g.stroke();
  for (let i = 0; i < 800; i++) {
    g.fillStyle = `rgba(60,40,20,${Math.random() * 0.07})`;
    g.fillRect(Math.random() * W, Math.random() * H, 3, 3);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */

export const ROOM = { w: 13, d: 12.5, h: 3.2 };
/** Per-bulb intensity of the fixture over the table. It hangs less than a
 *  metre above the cloth, so this stays low or the felt blows out. */
export const TABLE_LIGHT = 4.6;
/** Where the bar counter runs, in -z. Everything else is arranged around it. */
export const BAR_Z = -4.0;

export function buildBarRoom() {
  const group = new THREE.Group();
  const dyn = [];
  const { w: RW, d: RD, h: RH } = ROOM;

  /* ================= shell ================= */

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(RW, RD),
    std({ color: '#7d6349', roughness: 0.7, metalness: 0.04, map: floorTexture() }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const wallMat = std({ color: '#4d3f3c', roughness: 0.96, map: grungeTexture(512, [190, 176, 170], 24, 5) });
  for (const [x, z, ry, w] of [
    [0, -RD / 2, 0, RW], [0, RD / 2, Math.PI, RW],
    [-RW / 2, 0, Math.PI / 2, RD], [RW / 2, 0, -Math.PI / 2, RD],
  ]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, RH), wallMat);
    m.position.set(x, RH / 2, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    group.add(m);
  }

  const wainMat = std({ color: '#4b3320', roughness: 0.68, map: grungeTexture(256, [200, 176, 150], 28, 6) });
  for (const [x, z, ry, w] of [
    [0, -RD / 2 + 0.03, 0, RW], [0, RD / 2 - 0.03, Math.PI, RW],
    [-RW / 2 + 0.03, 0, Math.PI / 2, RD], [RW / 2 - 0.03, 0, -Math.PI / 2, RD],
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, 0.05), wainMat);
    m.position.set(x, 0.5, z);
    m.rotation.y = ry;
    group.add(m);
  }

  /* Windows on the street side. Without them there is nothing for a time of day
     to mean: a windowless cellar looks the same at noon as at four in the
     morning, which is true of real cellars and useless here. */
  const windows = [];
  const glassMat = std({
    color: 0xbcd4e8, roughness: 0.08, metalness: 0.1,
    transparent: true, opacity: 0.5, emissive: 0x9fc0dd, emissiveIntensity: 0.6,
  });
  const frameMat = std({ color: '#2b2118', roughness: 0.8 });
  for (const wx of [-3.3, 0.6, 4.0]) {
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.15), glassMat);
    glass.position.set(wx, 1.85, RD / 2 - 0.05);
    glass.rotation.y = Math.PI;
    group.add(glass);
    windows.push(glass);

    // frame and a pair of glazing bars, because it is that sort of pub
    const fr = new THREE.Mesh(new THREE.BoxGeometry(1.62, 1.27, 0.07), frameMat);
    fr.position.set(wx, 1.85, RD / 2 - 0.02);
    group.add(fr);
    for (const bar of [[0, 1.15, 0.04], [1.5, 0.04, 0.04]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(bar[0] || 0.04, bar[1], bar[2]), frameMat);
      b.position.set(wx, 1.85, RD / 2 - 0.08);
      group.add(b);
    }

    // the light that actually comes in through it
    const shaft = new THREE.PointLight(0xbfd8f2, 0, 7, 2);
    shaft.position.set(wx, 1.9, RD / 2 - 0.9);
    group.add(shaft);
    windows.push(shaft);
  }

  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(RW, RD),
    std({ color: '#1b161c', roughness: 1, map: grungeTexture(256, [150, 140, 150], 20, 4, 0.004) }),
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = RH;
  group.add(ceil);

  // stained ceiling beams
  const beamMat = std({ color: '#2e2118', roughness: 0.85 });
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(RW, 0.16, 0.14), beamMat);
    b.position.set(0, RH - 0.08, -RD / 2 + 1.2 + i * 2.0);
    group.add(b);
  }

  /* ================= the bar ================= */

  const barTopMat = std({ color: '#6b4322', roughness: 0.25, metalness: 0.1,
    map: grungeTexture(512, [210, 180, 140], 22, 3) });
  const barFrontMat = std({ color: '#3c2a1c', roughness: 0.8, map: grungeTexture(256, [180, 160, 140], 26, 4) });

  const BAR_W = 7.4;
  const barFront = new THREE.Mesh(new THREE.BoxGeometry(BAR_W, 1.06, 0.55), barFrontMat);
  barFront.position.set(-1.4, 0.53, BAR_Z);
  barFront.castShadow = barFront.receiveShadow = true;
  group.add(barFront);

  const barTop = new THREE.Mesh(new THREE.BoxGeometry(BAR_W + 0.3, 0.06, 0.78), barTopMat);
  barTop.position.set(-1.4, 1.09, BAR_Z + 0.02);
  barTop.castShadow = barTop.receiveShadow = true;
  group.add(barTop);

  // brass foot rail
  const brass = std({ color: '#c9a03a', roughness: 0.28, metalness: 0.9 });
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, BAR_W, 10), brass);
  foot.rotation.z = Math.PI / 2;
  foot.position.set(-1.4, 0.19, BAR_Z + 0.36);
  group.add(foot);

  // back bar: shelves, bottles, mirror
  const backBar = new THREE.Mesh(new THREE.BoxGeometry(BAR_W, 2.3, 0.36),
    std({ color: '#31221a', roughness: 0.75, map: grungeTexture(256, [170, 148, 128], 22, 4) }));
  backBar.position.set(-1.4, 1.15, BAR_Z - 0.75);
  group.add(backBar);

  const mirror = new THREE.Mesh(new THREE.PlaneGeometry(BAR_W - 1.2, 1.0),
    std({ color: '#20242c', roughness: 0.12, metalness: 0.85 }));
  mirror.position.set(-1.4, 1.62, BAR_Z - 0.565);
  group.add(mirror);

  const shelfMat = std({ color: '#4a3423', roughness: 0.7 });
  const bottleGeo = new THREE.CylinderGeometry(0.032, 0.036, 0.26, 7);
  const bottleNeckGeo = new THREE.CylinderGeometry(0.012, 0.026, 0.1, 6);
  const bottles = [];
  for (let s = 0; s < 3; s++) {
    const y = 1.30 + s * 0.42;
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(BAR_W - 0.5, 0.04, 0.26), shelfMat);
    shelf.position.set(-1.4, y - 0.02, BAR_Z - 0.66);
    group.add(shelf);
    const n = 26;
    for (let i = 0; i < n; i++) {
      const hue = Math.random() * 360;
      const mat = std({
        color: new THREE.Color(`hsl(${hue},55%,${28 + Math.random() * 26}%)`),
        roughness: 0.16, metalness: 0.05, transparent: true, opacity: 0.9,
      });
      const b = new THREE.Mesh(bottleGeo, mat);
      const x = -1.4 - (BAR_W - 0.8) / 2 + (i + 0.5) * ((BAR_W - 0.8) / n);
      const sc = 0.8 + Math.random() * 0.5;
      b.position.set(x, y + 0.13 * sc, BAR_Z - 0.66 + (Math.random() - 0.5) * 0.06);
      b.scale.setScalar(sc);
      group.add(b);
      const nk = new THREE.Mesh(bottleNeckGeo, mat);
      nk.position.set(b.position.x, y + (0.26 * sc) + 0.04 * sc, b.position.z);
      nk.scale.setScalar(sc);
      group.add(nk);
      bottles.push(b);
    }
  }

  // beer taps
  for (let i = 0; i < 5; i++) {
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 8), brass);
    tap.position.set(-3.0 + i * 0.22, 1.27, BAR_Z - 0.16);
    group.add(tap);
    const handle = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.14, 8),
      std({ color: new THREE.Color(`hsl(${i * 62},60%,45%)`), roughness: 0.4 }));
    handle.position.set(-3.0 + i * 0.22, 1.47, BAR_Z - 0.16);
    group.add(handle);
  }

  // stools
  const stoolSeatMat = std({ color: '#7a2f2a', roughness: 0.75 });
  const stoolPositions = [];
  for (let i = 0; i < 7; i++) {
    const x = -4.6 + i * 1.05;
    const g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.07, 14), stoolSeatMat);
    seat.position.y = 0.72;
    seat.castShadow = true;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.72, 10),
      std({ color: '#8b8d95', roughness: 0.35, metalness: 0.8 }));
    post.position.y = 0.36;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.03, 14),
      std({ color: '#8b8d95', roughness: 0.4, metalness: 0.8 }));
    base.position.y = 0.02;
    g.add(seat, post, base);
    g.position.set(x, 0, BAR_Z + 0.72);
    group.add(g);
    stoolPositions.push({ x, z: BAR_Z + 0.72, y: 0.75 });
  }

  /* ================= booths ================= */

  const boothSeats = [];
  const benchMat = std({ color: '#5d2422', roughness: 0.8, map: grungeTexture(256, [190, 150, 150], 20, 3) });
  for (let i = 0; i < 3; i++) {
    const z = -1.6 + i * 2.1;
    const x = RW / 2 - 0.9;
    const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 16),
      std({ color: '#4a3222', roughness: 0.5 }));
    tableTop.position.set(x, 0.74, z);
    tableTop.castShadow = tableTop.receiveShadow = true;
    group.add(tableTop);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 0.72, 10),
      std({ color: '#2b2b30', roughness: 0.4, metalness: 0.6 }));
    stem.position.set(x, 0.36, z);
    group.add(stem);

    for (const s of [-1, 1]) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.44, 0.6), benchMat);
      bench.position.set(x + 0.1, 0.22, z + s * 0.92);
      bench.rotation.y = Math.PI / 2;
      bench.castShadow = bench.receiveShadow = true;
      group.add(bench);
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.72, 0.14), benchMat);
      back.position.set(x + 0.1, 0.6, z + s * 1.16);
      back.rotation.y = Math.PI / 2;
      group.add(back);
      boothSeats.push({ x: x + 0.1, z: z + s * 0.86, y: 0.46 });
    }

    // beer mats and glasses on the table
    for (let k = 0; k < 3; k++) {
      const a = Math.random() * 7;
      const rr = Math.random() * 0.26;
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.028, 0.12, 10),
        std({ color: '#d8c07a', roughness: 0.12, transparent: true, opacity: 0.6 }));
      glass.position.set(x + Math.cos(a) * rr, 0.83, z + Math.sin(a) * rr);
      group.add(glass);
    }
  }

  /* ================= jukebox ================= */

  const juke = new THREE.Group();
  const jbody = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.5),
    std({ color: '#3b1f2c', roughness: 0.35, metalness: 0.2 }));
  jbody.position.y = 0.75;
  jbody.castShadow = true;
  juke.add(jbody);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.055, 10, 20, Math.PI),
    basic({ color: '#ff3d8a' }));
  arch.position.set(0, 1.5, 0.24);
  juke.add(arch);
  const jglass = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5), basic({ color: '#ffbd45' }));
  jglass.position.set(0, 1.05, 0.256);
  juke.add(jglass);
  juke.position.set(-RW / 2 + 0.8, 0, 1.6);
  juke.rotation.y = Math.PI / 2.4;
  group.add(juke);

  /* ================= wall dressing ================= */

  // the dartboard from the other game, retired to the corner
  const boardBack = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 26),
    std({ color: '#40291b', roughness: 0.8 }));
  boardBack.rotation.x = Math.PI / 2;
  boardBack.position.set(3.4, 1.72, -RD / 2 + 0.06);
  group.add(boardBack);
  const boardFace = new THREE.Mesh(new THREE.CircleGeometry(0.21, 26),
    std({ color: '#1a1a1c', roughness: 0.9 }));
  boardFace.position.set(3.4, 1.72, -RD / 2 + 0.09);
  group.add(boardFace);

  // telly showing static
  const tvBody = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.62, 0.12),
    std({ color: '#1c1c20', roughness: 0.5 }));
  tvBody.position.set(-4.5, 2.15, -RD / 2 + 0.12);
  group.add(tvBody);
  const staticCv = document.createElement('canvas');
  staticCv.width = staticCv.height = 128;
  const staticTex = new THREE.CanvasTexture(staticCv);
  const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.52),
    basic({ map: staticTex }));
  tvScreen.position.set(-4.5, 2.15, -RD / 2 + 0.185);
  group.add(tvScreen);
  const tvLight = new THREE.PointLight(0x9fd8ff, 2, 4, 2);
  tvLight.position.set(-4.5, 2.1, -RD / 2 + 0.5);
  group.add(tvLight);
  dyn.push({
    update(t) {
      const g = staticCv.getContext('2d');
      const img = g.createImageData(128, 128);
      for (let i = 0; i < 128 * 128; i++) {
        const v = Math.random() * 255;
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      staticTex.needsUpdate = true;
      tvLight.intensity = 1.5 + Math.sin(t * 21) * 0.7;
    },
  });

  // neon
  const neons = [];
  const addNeon = (text, sub, hue, x, y, z, ry, w = 1.3, h = 0.65) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      basic({ map: neonTexture(text, hue, sub), transparent: true }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    group.add(m);
    const col = new THREE.Color(`hsl(${hue},100%,60%)`);
    const light = new THREE.PointLight(col, 6, 7, 2);
    light.position.set(x, y, z + (ry === 0 ? 0.5 : 0));
    group.add(light);
    neons.push({ mesh: m, light, phase: Math.random() * 9, base: 6 });
    return m;
  };
  addNeon('THE FUZZ', 'AND FEATHER', 320, 1.3, 2.05, -RD / 2 + 0.08, 0, 1.7, 0.85);
  addNeon('POOL', '', 190, -RW / 2 + 0.1, 2.0, -1.2, Math.PI / 2, 1.2, 0.6);
  addNeon('COLD BEER', '', 45, RW / 2 - 0.1, 2.15, 2.6, -Math.PI / 2, 1.4, 0.7);
  dyn.push({
    update(t, dt, hype) {
      for (const n of neons) {
        // one tube in the room always has a bad connection
        const flick = Math.sin(t * 37 + n.phase) > 0.965 ? 0.25 : 1;
        n.light.intensity = n.base * flick * (1 + hype * 0.9);
        n.mesh.material.opacity = 0.55 + 0.45 * flick;
      }
    },
  });

  // posters and a cue rack
  const posters = [
    ['QUIZ NIGHT', 'TUESDAYS · FREE CHIPS', 24],
    ['NO MASSE', 'MANAGEMENT', 200],
    ['LOST CAT', 'ANSWERS TO GERALD', 96],
  ];
  posters.forEach(([tt, ss, hue], i) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.66),
      std({ map: posterTexture(tt, ss, hue), roughness: 0.94 }));
    p.position.set(-2.0 + i * 0.7, 1.75 + (i % 2) * 0.2, -RD / 2 + 0.05);
    p.rotation.z = (Math.random() - 0.5) * 0.07;
    group.add(p);
  });

  const rack = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 0.08),
    std({ color: '#3d2818', roughness: 0.75 }));
  rack.position.set(RW / 2 - 0.06, 1.5, -2.6);
  rack.rotation.y = -Math.PI / 2;
  group.add(rack);
  for (let i = 0; i < 5; i++) {
    const cue = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 1.45, 7),
      std({ color: i % 2 ? '#c9a066' : '#5a3520', roughness: 0.4 }));
    cue.position.set(RW / 2 - 0.13, 0.95, -3.1 + i * 0.24);
    cue.rotation.x = 0.06;
    group.add(cue);
  }

  /* ================= ceiling fan ================= */

  const fan = new THREE.Group();
  const fanMotor = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.13, 12),
    std({ color: '#2a2a2f', roughness: 0.5, metalness: 0.5 }));
  fan.add(fanMotor);
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.012, 0.14),
      std({ color: '#3a2a1e', roughness: 0.8 }));
    blade.position.set(Math.cos(i * Math.PI / 2) * 0.36, -0.03, Math.sin(i * Math.PI / 2) * 0.36);
    blade.rotation.y = -i * Math.PI / 2;
    blade.rotation.z = 0.12;
    fan.add(blade);
  }
  fan.position.set(2.6, RH - 0.28, 2.8);
  group.add(fan);
  dyn.push({ update(t, dt, hype) { fan.rotation.y += dt * (1.6 + hype * 3); } });

  /* ================= haze ================= */

  const hazeCount = 300;
  const hz = new Float32Array(hazeCount * 3);
  for (let i = 0; i < hazeCount; i++) {
    hz[i * 3] = (Math.random() - 0.5) * RW * 0.9;
    hz[i * 3 + 1] = 0.4 + Math.random() * 2.5;
    hz[i * 3 + 2] = (Math.random() - 0.5) * RD * 0.9;
  }
  const hazeGeo = new THREE.BufferGeometry();
  hazeGeo.setAttribute('position', new THREE.BufferAttribute(hz, 3));
  const haze = new THREE.Points(hazeGeo, new THREE.PointsMaterial({
    color: 0xffd9b0, size: 0.05, transparent: true, opacity: 0.15,
    map: softDotTexture(), alphaTest: 0.01, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  haze.frustumCulled = false;
  group.add(haze);
  dyn.push({
    update(t) {
      const a = hazeGeo.attributes.position.array;
      for (let i = 0; i < hazeCount; i++) {
        a[i * 3 + 1] += 0.0012 + (i % 5) * 0.0002;
        if (a[i * 3 + 1] > 2.9) a[i * 3 + 1] = 0.35;
        a[i * 3] += Math.sin(t * 0.3 + i) * 0.0004;
      }
      hazeGeo.attributes.position.needsUpdate = true;
    },
  });

  /* ================= lighting ================= */

  const lights = new THREE.Group();
  const hemi = new THREE.HemisphereLight(0x6a6f8c, 0x2a1c12, 0.45);
  lights.add(hemi);
  const ambient = new THREE.AmbientLight(0xffe6c4, 0.16);
  lights.add(ambient);

  /* the table light: a long shaded fixture on chains, three bulbs, and the
     only serious shadow-caster in the room */
  const fixture = new THREE.Group();
  const shadeMat = std({ color: '#1e1c22', roughness: 0.55, metalness: 0.45, side: THREE.DoubleSide });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.12), shadeMat);
  bar.position.y = 0.32;
  fixture.add(bar);
  const tableSpots = [];
  const bulbs = [];
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 0.68;
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.2, 18, 1, true), shadeMat);
    shade.position.set(x, 0.2, 0);
    shade.rotation.x = Math.PI;
    fixture.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10),
      basic({ color: 0xffe0ad }));
    bulb.position.set(x, 0.13, 0);
    fixture.add(bulb);
    bulbs.push(bulb);

    for (const cx of [-0.02, 0.02]) {
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1.4, 5),
        std({ color: '#15141a' }));
      chain.position.set(x + cx * 6, 1.05, 0);
      fixture.add(chain);
    }

    const sp = new THREE.SpotLight(0xffe3b8, TABLE_LIGHT, 4.6, 0.9, 0.5, 1.5);
    sp.position.set(x, 0.12, 0);
    sp.target.position.set(x, -1.2, 0);
    sp.castShadow = i === 1;
    if (sp.castShadow) {
      sp.shadow.mapSize.set(1024, 1024);
      sp.shadow.bias = -0.0006;
      sp.shadow.normalBias = 0.015;
      sp.shadow.camera.near = 0.2;
      sp.shadow.camera.far = 4;
    }
    fixture.add(sp, sp.target);
    tableSpots.push(sp);
  }
  fixture.position.set(0, TABLE.height + 0.95, 0);
  group.add(fixture);

  // warm practicals over the bar and the booths
  const practicals = [];
  for (const [x, z] of [[-3.2, BAR_Z + 0.5], [0.4, BAR_Z + 0.5], [RW / 2 - 1.4, 0], [RW / 2 - 1.4, 3.0], [-RW / 2 + 1.4, 2.4]]) {
    const pl = new THREE.PointLight(0xffc98a, 5, 7, 2);
    pl.position.set(x, 2.5, z);
    lights.add(pl);
    practicals.push(pl);
  }

  // coloured rims so the crowd reads against the dark
  const rimL = new THREE.PointLight(0xff2f6a, 7, 12, 2); rimL.position.set(-4.4, 2.3, 2.4);
  const rimR = new THREE.PointLight(0x2fa8ff, 7, 12, 2); rimR.position.set(4.4, 2.3, 1.2);
  const rimB = new THREE.PointLight(0xffb03a, 5, 10, 2); rimB.position.set(0, 2.4, 4.6);
  lights.add(rimL, rimR, rimB);

  group.add(lights);

  dyn.push({
    update(t, dt, hype) {
      // the fixture swings when the room gets going
      fixture.rotation.z = Math.sin(t * 1.9) * (0.004 + hype * 0.07);
      fixture.rotation.x = Math.cos(t * 1.5) * (0.003 + hype * 0.05);
      const f = 0.9 + Math.sin(t * 11) * 0.03 + hype * 0.35;
      for (const b of bulbs) b.material.color.setRGB(1 * f, 0.88 * f, 0.68 * f);
      for (const sp of tableSpots) sp.intensity = TABLE_LIGHT * (0.94 + hype * 0.3);
    },
  });

  /* ------------------------------------------------------------------ */
  /* Time of day                                                         */
  /* ------------------------------------------------------------------ */

  /* Each entry is the whole lighting state of the room, because half-setting it
     is what makes a scene look wrong: daylight through the windows without the
     practicals coming down reads as a bar with a fault, not a bar at noon. */
  const TIMES = {
    afternoon: {
      label: 'AFTERNOON',
      sky: 0xbcd4e8, ground: 0x6a5a48, hemi: 1.15, ambient: 0.5,
      window: 9.0, windowColour: 0xd8e8ff, glassEmissive: 1.5,
      practical: 1.4, rim: 0.15, table: 0.55,
      fog: { color: 0x8f9aa8, near: 9, far: 30 },
    },
    evening: {
      label: 'EVENING',
      sky: 0x8a7a90, ground: 0x40301f, hemi: 0.62, ambient: 0.26,
      window: 3.4, windowColour: 0xe8a463, glassEmissive: 0.9,
      practical: 4.6, rim: 0.55, table: 0.85,
      fog: { color: 0x3a2c30, near: 7, far: 24 },
    },
    night: {
      label: 'NIGHT',
      sky: 0x6a6f8c, ground: 0x2a1c12, hemi: 0.45, ambient: 0.16,
      window: 0.7, windowColour: 0x3f5f8f, glassEmissive: 0.25,
      practical: 5.0, rim: 1.0, table: 1.0,
      fog: { color: 0x141119, near: 6, far: 22 },
    },
    afterhours: {
      label: 'AFTER HOURS',
      sky: 0x2a3040, ground: 0x140d08, hemi: 0.18, ambient: 0.07,
      window: 0.25, windowColour: 0x24406a, glassEmissive: 0.1,
      practical: 1.5, rim: 1.35, table: 1.15,
      fog: { color: 0x08070c, near: 4, far: 16 },
    },
  };

  let timeKey = 'night';

  function setTime(key) {
    const t = TIMES[key] ?? TIMES.night;
    timeKey = TIMES[key] ? key : 'night';

    hemi.color.setHex(t.sky);
    hemi.groundColor.setHex(t.ground);
    hemi.intensity = t.hemi;
    ambient.intensity = t.ambient;

    for (const w of windows) {
      if (w.isLight) { w.intensity = t.window; w.color.setHex(t.windowColour); }
      else {
        w.material.emissiveIntensity = t.glassEmissive;
        w.material.emissive.setHex(t.windowColour);
      }
    }
    for (const p of practicals) p.userData.dayScale = t.practical;
    for (const r of [rimL, rimR, rimB]) r.userData.dayScale = t.rim;
    for (const sp of tableSpots) sp.userData.dayScale = t.table;

    // the table lamp is the key light after dark and near-irrelevant at noon
    for (const b of bulbs) b.userData.dayScale = t.table;
    return t;
  }

  // remember the base intensity each light was authored with
  for (const p of practicals) p.userData.base = p.intensity;
  for (const r of [rimL, rimR, rimB]) r.userData.base = r.intensity;

  dyn.push({
    update() {
      for (const p of practicals) p.intensity = p.userData.base * (p.userData.dayScale ?? 1);
      for (const r of [rimL, rimR, rimB]) {
        r.userData.rimScale = r.userData.dayScale ?? 1;
      }
    },
  });

  setTime('night');

  return {
    group, dyn,
    lights: { hemi, ambient, tableSpots, practicals, rims: [rimL, rimR, rimB] },
    times: Object.entries(TIMES).map(([k, v]) => ({ id: k, label: v.label })),
    setTime,
    timeOfDay: () => timeKey,
    TIMES,
    fixture,
    seats: { stools: stoolPositions, booths: boothSeats },
    room: ROOM,
  };
}

/* ------------------------------------------------------------------ */
/* Where the muppets stand                                             */
/* ------------------------------------------------------------------ */

/**
 * A ring pressed right up against the table (those are the ones close enough
 * to throw something onto it), then the bar, the stools, the booths, and a
 * loose scatter of people who are here for reasons of their own.
 */
export function barSeats(target = 90) {
  const seats = [];
  const TL = TABLE.halfLen + 0.09, TW = TABLE.halfWid + 0.09;

  /* The front row. It stops short of the table by more than it looks like it
     needs to: the aiming camera sits about 0.8 m behind the cue ball, and the
     cue ball can be on any cushion, so anything closer than this puts a muppet
     between the player and the shot. */
  const RING = 20;      // a believable ring, not a wall of fur
  for (let i = 0; i < RING; i++) {
    const a = (i / RING) * Math.PI * 2 + 0.12;
    const rx = TL + 0.98 + Math.random() * 0.26;
    const rz = TW + 0.95 + Math.random() * 0.26;
    seats.push({
      pos: new THREE.Vector3(Math.cos(a) * rx, 0, Math.sin(a) * rz),
      sit: false, side: Math.cos(a) > 0 ? 1 : -1, rank: 0,
      rail: true,
    });
  }

  // a second, looser ring
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.4;
    const rx = TL + 1.75 + Math.random() * 0.55;
    const rz = TW + 1.85 + Math.random() * 0.55;
    seats.push({
      pos: new THREE.Vector3(Math.cos(a) * rx, 0, Math.sin(a) * rz),
      sit: false, side: Math.cos(a) > 0 ? 1 : -1, rank: 0.6,
    });
  }

  // propping up the bar
  for (let i = 0; i < 7; i++) {
    seats.push({
      pos: new THREE.Vector3(-4.6 + i * 1.05 + (Math.random() - 0.5) * 0.2, 0.75, BAR_Z + 0.72),
      sit: true, side: 0, rank: 1.1, stool: true,
    });
  }
  for (let i = 0; i < 5; i++) {
    seats.push({
      pos: new THREE.Vector3(-4.2 + i * 1.3 + (Math.random() - 0.5) * 0.3, 0, BAR_Z + 1.25),
      sit: false, side: 0, rank: 1.3,
    });
  }

  // booths
  for (let i = 0; i < 3; i++) {
    const z = -1.6 + i * 2.1;
    for (const s of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        seats.push({
          pos: new THREE.Vector3(ROOM.w / 2 - 0.8 + (k - 0.5) * 0.5, 0.46, z + s * 0.86),
          sit: true, side: 1, rank: 1.5,
        });
      }
    }
  }

  // strays
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 3.2 + Math.random() * 1.8;
    seats.push({
      pos: new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r * 0.8 + 1.0),
      sit: false, side: Math.cos(a) > 0 ? 1 : -1, rank: 1.8,
    });
  }

  seats.sort((a, b) => a.rank - b.rank);
  return seats.slice(0, Math.min(target, seats.length));
}

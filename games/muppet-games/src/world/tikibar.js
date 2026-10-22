/**
 * The Sandy Bottom — beach tiki bar, second venue for the pool game.
 *
 * Same exported shape as barroom.js so the game can swap venues without
 * touching anything else. Where the dive bar is dark and sticky, this is
 * open-air and sticky: dusk, sun-bleached everything, a hurricane took half
 * the thatch off in March and nobody has been up a ladder since.
 *
 * The pool table still sits at the world origin, on a bit of decking someone
 * laid so the legs would stop sinking.
 */

import * as THREE from 'three';
import { TABLE } from '../pool/physics.js';
import { softDotTexture } from './arena.js';

const std = (o) => new THREE.MeshStandardMaterial(o);
const basic = (o) => new THREE.MeshBasicMaterial(o);

/* ------------------------------------------------------------------ */
/* Textures — all canvas-drawn, there are no image assets in this repo */
/* ------------------------------------------------------------------ */

function grainTexture(w = 512, tint = [200, 190, 180], amount = 26, rep = 4, blots = 0.0016) {
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

/** Sand: grain, damp patches, footprints going nowhere, and the night's litter. */
function sandTexture() {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#cbb289';
  g.fillRect(0, 0, S, S);

  // grain
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < S * S; i++) {
    const n = (Math.random() - 0.5) * 34;
    img.data[i * 4 + 0] = Math.max(0, Math.min(255, img.data[i * 4 + 0] + n));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, img.data[i * 4 + 1] + n * 0.95));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, img.data[i * 4 + 2] + n * 0.8));
  }
  g.putImageData(img, 0, 0);

  // damp / trodden patches
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 20 + Math.random() * 110;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(96,76,52,${0.06 + Math.random() * 0.14})`);
    grd.addColorStop(1, 'rgba(96,76,52,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }

  // footprints: pairs of scuffed ovals wandering off in whatever direction
  for (let trail = 0; trail < 14; trail++) {
    let x = Math.random() * S, y = Math.random() * S;
    const a = Math.random() * Math.PI * 2;
    const steps = 5 + (Math.random() * 9) | 0;
    for (let s = 0; s < steps; s++) {
      const side = (s % 2 ? 1 : -1) * 11;
      const px = x + Math.cos(a + Math.PI / 2) * side;
      const py = y + Math.sin(a + Math.PI / 2) * side;
      g.save();
      g.translate(px, py);
      g.rotate(a);
      g.fillStyle = `rgba(88,68,44,${0.16 + Math.random() * 0.12})`;
      g.beginPath(); g.ellipse(0, 0, 7, 14, 0, 0, 7); g.fill();
      g.beginPath(); g.ellipse(0, 17, 5, 6, 0, 0, 7); g.fill();
      g.restore();
      x += Math.cos(a) * 30; y += Math.sin(a) * 30;
    }
  }

  // dog-ends, bottle caps, one crushed straw
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * S, y = Math.random() * S, a = Math.random() * 7;
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = '#e8e2d2'; g.fillRect(-5, -1.4, 10, 2.8);
    g.fillStyle = '#a4843c'; g.fillRect(2, -1.4, 3, 2.8);
    g.fillStyle = 'rgba(30,24,16,.6)'; g.fillRect(-5.6, -1.4, 1.6, 2.8);
    g.restore();
  }
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `hsl(${Math.random() * 360},60%,45%)`;
    g.beginPath(); g.arc(Math.random() * S, Math.random() * S, 2.6, 0, 7); g.fill();
  }

  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(7, 7);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Dry palm thatch, laid in overlapping courses and going grey at the ends. */
function thatchTexture(rep = 3) {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#6d5324';
  g.fillRect(0, 0, S, S);
  for (let course = 0; course < 14; course++) {
    const y0 = course * (S / 14);
    for (let i = 0; i < 420; i++) {
      const x = Math.random() * S;
      const len = 24 + Math.random() * 46;
      const l = 26 + Math.random() * 40;
      g.strokeStyle = `hsl(${34 + Math.random() * 14},${28 + Math.random() * 30}%,${l}%)`;
      g.lineWidth = 1 + Math.random() * 2.4;
      g.beginPath();
      g.moveTo(x, y0);
      g.lineTo(x + (Math.random() - 0.5) * 10, y0 + len);
      g.stroke();
    }
    // sun-bleached fringe on the lower lip of each course
    g.fillStyle = 'rgba(210,196,160,.13)';
    g.fillRect(0, y0 + S / 14 - 5, S, 5);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep, rep);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Bamboo: pale culm, dark nodes, and the mildew you get from salt air. */
function bambooTexture(rep = 2) {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#c4ad6e';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = `rgba(${90 + Math.random() * 60},${76 + Math.random() * 40},40,.18)`;
    g.lineWidth = 1 + Math.random() * 3;
    const x = Math.random() * S;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (Math.random() - 0.5) * 8, S); g.stroke();
  }
  for (const y of [0.16, 0.5, 0.84]) {
    g.fillStyle = 'rgba(78,58,26,.55)';
    g.fillRect(0, y * S - 3, S, 6);
    g.fillStyle = 'rgba(226,208,158,.35)';
    g.fillRect(0, y * S + 3, S, 3);
  }
  for (let i = 0; i < 30; i++) {
    g.fillStyle = `rgba(70,90,54,${0.06 + Math.random() * 0.12})`;
    g.beginPath(); g.arc(Math.random() * S, Math.random() * S, 3 + Math.random() * 16, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, rep);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Driftwood planks, salt-bleached and split. */
function driftwoodTexture(rep = 3) {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#9a8a74';
  g.fillRect(0, 0, S, S);
  const plank = S / 7;
  for (let i = 0; i < 7; i++) {
    const l = 52 + Math.random() * 22;
    g.fillStyle = `hsl(${32 + Math.random() * 10},${8 + Math.random() * 12}%,${l}%)`;
    g.fillRect(0, i * plank + 1, S, plank - 3);
    for (let k = 0; k < 130; k++) {
      g.strokeStyle = `rgba(60,48,36,${Math.random() * 0.14})`;
      g.lineWidth = Math.random() * 1.7;
      const y = i * plank + Math.random() * plank;
      g.beginPath(); g.moveTo(Math.random() * S, y); g.lineTo(Math.random() * S, y + (Math.random() - 0.5) * 3); g.stroke();
    }
    g.fillStyle = 'rgba(24,18,12,.5)';
    g.fillRect(0, (i + 1) * plank - 3, S, 2);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep, rep);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Dusk sky: the good half hour, wasted on this lot. */
function skyTexture() {
  const W = 1024, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0.00, '#070b24');
  grd.addColorStop(0.28, '#181c46');
  grd.addColorStop(0.48, '#4a2f60');
  grd.addColorStop(0.62, '#94406a');
  grd.addColorStop(0.71, '#d2683f');
  grd.addColorStop(0.765, '#f0a24a');
  grd.addColorStop(0.79, '#ffd08a');
  grd.addColorStop(0.81, '#123040');
  grd.addColorStop(1.00, '#08161e');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);

  // stars, only where it is dark enough to see them
  for (let i = 0; i < 500; i++) {
    const y = Math.random() * H * 0.45;
    g.fillStyle = `rgba(255,255,240,${0.15 + Math.random() * 0.6 * (1 - y / (H * 0.45))})`;
    g.fillRect(Math.random() * W, y, 1.6, 1.6);
  }

  // the sun, going down at u = 0.75 (which lands due -z, i.e. behind the bar)
  const sx = W * 0.75, sy = H * 0.775;
  const sun = g.createRadialGradient(sx, sy, 0, sx, sy, 120);
  sun.addColorStop(0, 'rgba(255,246,214,1)');
  sun.addColorStop(0.16, 'rgba(255,196,110,0.95)');
  sun.addColorStop(0.5, 'rgba(232,120,70,0.35)');
  sun.addColorStop(1, 'rgba(232,120,70,0)');
  g.fillStyle = sun;
  g.fillRect(sx - 130, sy - 130, 260, 260);
  g.fillStyle = 'rgba(255,240,200,0.95)';
  g.beginPath(); g.arc(sx, sy, 26, 0, 7); g.fill();

  // flat, bored clouds
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * W, y = H * (0.5 + Math.random() * 0.24);
    const w = 60 + Math.random() * 240, h = 4 + Math.random() * 12;
    g.fillStyle = `rgba(${40 + Math.random() * 90},${26 + Math.random() * 40},${50 + Math.random() * 40},${0.14 + Math.random() * 0.3})`;
    g.beginPath(); g.ellipse(x, y, w, h, 0, 0, 7); g.fill();
  }

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Water: long swell streaks, scrolled in the update loop. */
function seaTexture() {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#0c2634';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const y = Math.random() * S;
    g.strokeStyle = `rgba(${90 + Math.random() * 90},${150 + Math.random() * 70},${160 + Math.random() * 60},${Math.random() * 0.16})`;
    g.lineWidth = 0.6 + Math.random() * 2.6;
    const x = Math.random() * S, len = 20 + Math.random() * 120;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x + len * 0.3, y - 3, x + len * 0.7, y + 3, x + len, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(50, 50);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The sun's glitter path on the water — additive, so it only ever adds light. */
function glitterTexture() {
  const W = 128, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 1400; i++) {
    const v = Math.random();
    const y = v * H;
    const spread = 0.12 + (1 - v) * 0.9;                     // widens towards the shore
    const x = W / 2 + (Math.random() - 0.5) * W * spread;
    const a = (0.5 + Math.random() * 0.5) * Math.pow(v, 1.4);
    g.fillStyle = `rgba(255,${180 + Math.random() * 60},${110 + Math.random() * 60},${a})`;
    g.fillRect(x, y, 1 + Math.random() * 7, 1 + Math.random() * 1.6);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Foam edge for the wash running up the sand. */
function foamTexture() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const y = Math.random() * S;
    const edge = Math.pow(1 - Math.abs(y / S - 0.42) * 2.2, 2);
    if (edge <= 0) continue;
    g.fillStyle = `rgba(232,242,240,${edge * (0.1 + Math.random() * 0.5)})`;
    g.beginPath(); g.arc(Math.random() * S, y, 0.6 + Math.random() * 3.4, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(28, 1);
  return t;
}

/** A palm frond, cut out with alpha so it reads as leaflets not a lozenge. */
function frondTexture() {
  const W = 256, H = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#3d5a24';
  g.lineWidth = 5;
  g.beginPath(); g.moveTo(4, H / 2); g.lineTo(W - 6, H / 2); g.stroke();
  for (let i = 0; i < 46; i++) {
    const u = i / 46;
    const x = 8 + u * (W - 24);
    const len = (H / 2 - 6) * Math.sin(Math.min(1, u * 1.5) * Math.PI * 0.85) * (0.55 + Math.random() * 0.5);
    for (const s of [-1, 1]) {
      // a few leaflets are torn off; the wind here is relentless and personal
      if (Math.random() < 0.08) continue;
      g.strokeStyle = `hsl(${88 + Math.random() * 24},${30 + Math.random() * 26}%,${20 + Math.random() * 20}%)`;
      g.lineWidth = 2.6 + Math.random() * 1.6;
      g.beginPath();
      g.moveTo(x, H / 2);
      g.lineTo(x + 14 + Math.random() * 8, H / 2 + s * len);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Volleyball net — square mesh with a good few strands missing. */
function netTexture() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.strokeStyle = 'rgba(226,222,206,.85)';
  g.lineWidth = 3;
  for (let i = 0; i <= 8; i++) {
    if (Math.random() < 0.12) continue;
    const p = (i / 8) * S;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(9, 2);
  return t;
}

/** Deck-chair canvas: stripes, faded on one side because it never got moved. */
function stripeTexture(hueA, hueB) {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? `hsl(${hueA},42%,58%)` : `hsl(${hueB},34%,74%)`;
    g.fillRect(i * (S / 8), 0, S / 8, S);
  }
  const fade = g.createLinearGradient(0, 0, S, 0);
  fade.addColorStop(0, 'rgba(238,232,214,.55)');
  fade.addColorStop(1, 'rgba(238,232,214,0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(90,70,40,${Math.random() * 0.1})`;
    g.fillRect(Math.random() * S, Math.random() * S, 3, 3);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The cocktail board. Prices are firm; the ice machine is not. */
function menuTexture() {
  const W = 512, H = 700;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#16221d'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(220,235,225,${Math.random() * 0.03})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  g.strokeStyle = 'rgba(226,240,232,.6)'; g.lineWidth = 3;
  g.strokeRect(16, 16, W - 32, H - 32);
  g.textAlign = 'center';
  g.fillStyle = 'rgba(236,246,238,.92)';
  g.font = '700 46px "Barlow Condensed", Impact, sans-serif';
  g.fillText('COCKTAILS', W / 2, 76);
  g.font = '400 22px "Barlow Condensed", Impact, sans-serif';
  g.fillText('all served in the same glass', W / 2, 106);

  const drinks = [
    ['BLUE THING', '9'],
    ['RUM & REGRET', '7'],
    ['THE PAINKILLER', '8'],
    ['SEX ON THE BEACH', '6'],
    ['— sand included', ''],
    ['WARM MOJITO', '5'],
    ['COCONUT SURPRISE', 'ask'],
    ['THE DIVORCE', '11'],
    ['PINT OF WHATEVER', '4'],
  ];
  g.textAlign = 'left';
  drinks.forEach(([n, p], i) => {
    const y = 168 + i * 52;
    g.globalAlpha = 0.55 + Math.random() * 0.4;
    g.font = n.startsWith('—')
      ? '400 24px "Barlow Condensed", Impact, sans-serif'
      : '600 34px "Barlow Condensed", Impact, sans-serif';
    g.fillStyle = 'rgba(232,244,236,.9)';
    g.fillText(n, n.startsWith('—') ? 78 : 54, y);
    if (p) {
      g.textAlign = 'right';
      g.fillText(p, W - 54, y);
      g.textAlign = 'left';
    }
  });
  g.globalAlpha = 1;
  g.textAlign = 'center';
  g.font = '600 26px "Barlow Condensed", Impact, sans-serif';
  g.fillStyle = 'rgba(255,180,140,.85)';
  g.fillText('ICE MACHINE STILL BROKEN', W / 2, H - 48);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Hand-painted sign on a plank. */
function signTexture(text, sub, hue = 20) {
  const W = 512, H = 160;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#a08f74'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    g.strokeStyle = `rgba(70,54,36,${Math.random() * 0.13})`;
    g.lineWidth = Math.random() * 2;
    const y = Math.random() * H;
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + (Math.random() - 0.5) * 5); g.stroke();
  }
  g.textAlign = 'center';
  g.fillStyle = `hsl(${hue},64%,30%)`;
  g.font = '700 62px "Barlow Condensed", Impact, sans-serif';
  g.fillText(text, W / 2, sub ? 74 : 98);
  if (sub) {
    g.font = '600 30px "Barlow Condensed", Impact, sans-serif';
    g.fillStyle = 'rgba(48,34,20,.8)';
    g.fillText(sub, W / 2, 122);
  }
  // paint lifting off in the salt
  for (let i = 0; i < 200; i++) {
    g.fillStyle = `rgba(168,150,120,${Math.random() * 0.5})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 5, 2 + Math.random() * 4);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A tiki mask, carved by somebody in a hurry. */
function maskTexture(hue = 26) {
  const W = 256, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = `hsl(${hue},32%,22%)`;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 200; i++) {
    g.strokeStyle = `rgba(0,0,0,${Math.random() * 0.16})`;
    g.lineWidth = 1 + Math.random() * 3;
    const x = Math.random() * W;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (Math.random() - 0.5) * 20, H); g.stroke();
  }
  const dark = `hsl(${hue},40%,10%)`;
  const light = `hsl(${hue},34%,40%)`;
  // brow
  g.fillStyle = dark;
  g.fillRect(24, 120, W - 48, 34);
  g.fillStyle = light;
  g.fillRect(24, 154, W - 48, 10);
  // eyes
  for (const ex of [72, W - 72]) {
    g.fillStyle = dark;
    g.beginPath(); g.ellipse(ex, 200, 34, 26, 0, 0, 7); g.fill();
    g.fillStyle = '#e8dcc0';
    g.beginPath(); g.ellipse(ex, 200, 22, 15, 0, 0, 7); g.fill();
    g.fillStyle = '#120c08';
    g.beginPath(); g.arc(ex + 4, 200, 8, 0, 7); g.fill();
  }
  // nose and a mouth full of teeth
  g.fillStyle = dark;
  g.beginPath(); g.moveTo(W / 2, 236); g.lineTo(W / 2 - 30, 320); g.lineTo(W / 2 + 30, 320); g.closePath(); g.fill();
  g.fillRect(40, 356, W - 80, 82);
  g.fillStyle = '#e8dcc0';
  for (let i = 0; i < 7; i++) g.fillRect(48 + i * 24, 362, 16, 30);
  for (let i = 0; i < 6; i++) g.fillRect(60 + i * 24, 404, 16, 28);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */

export const TIKI_ROOM = { w: 13, d: 12.5, h: 6.4 };
/** Per-bulb intensity of the fixture over the table. Same reasoning as the
 *  dive bar: it hangs under a metre above the cloth, so this stays low. */
export const TIKI_LIGHT = 4.6;
/** Where the bar counter runs, in -z — sunset behind it, punters in front. */
export const TIKI_BAR_Z = -4.2;

const ISLAND_R = 13.2;

export function buildTikiBar() {
  const group = new THREE.Group();
  const dyn = [];
  const { w: RW } = TIKI_ROOM;
  const dummy = new THREE.Object3D();

  const bambooMat = std({ color: '#b09a63', roughness: 0.62, map: bambooTexture(3) });
  const bambooDarkMat = std({ color: '#6d5a34', roughness: 0.72, map: bambooTexture(2) });
  const woodMat = std({ color: '#9d8d76', roughness: 0.82, map: driftwoodTexture(3) });
  const thatchMat = std({ color: '#8a6c31', roughness: 0.95, map: thatchTexture(3), side: THREE.DoubleSide });
  const ropeMat = std({ color: '#8b7a56', roughness: 0.95 });

  /* ================= sky, sea, sand ================= */

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(90, 32, 20),
    basic({ map: skyTexture(), side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  sky.renderOrder = -2;
  group.add(sky);

  const seaTex = seaTexture();
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    std({ color: '#123443', roughness: 0.18, metalness: 0.55, map: seaTex, emissive: '#0a1a24', emissiveIntensity: 0.6 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.09;
  group.add(sea);

  // the glitter path, laid along -z so it runs from the sun to the beach
  const glitterTex = glitterTexture();
  const glitter = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 74),
    basic({ map: glitterTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.75 }),
  );
  glitter.rotation.x = -Math.PI / 2;
  glitter.rotation.z = Math.PI;
  glitter.position.set(0, -0.07, -50);
  group.add(glitter);

  const sandTex = sandTexture();
  const sand = new THREE.Mesh(
    new THREE.CircleGeometry(ISLAND_R, 56),
    std({ color: '#d9c096', roughness: 0.94, metalness: 0.01, map: sandTex }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.receiveShadow = true;
  group.add(sand);

  // wet sand where the wash reaches, plus the little scarp it cuts
  const wet = new THREE.Mesh(
    new THREE.RingGeometry(ISLAND_R - 1.9, ISLAND_R, 56),
    std({ color: '#8d7554', roughness: 0.3, metalness: 0.18, map: sandTex }),
  );
  wet.rotation.x = -Math.PI / 2;
  wet.position.y = 0.004;
  group.add(wet);

  const scarp = new THREE.Mesh(
    new THREE.CylinderGeometry(ISLAND_R, ISLAND_R + 0.1, 0.5, 56, 1, true),
    std({ color: '#7d674a', roughness: 0.9, map: sandTex, side: THREE.DoubleSide }),
  );
  scarp.position.y = -0.25;
  group.add(scarp);

  // two runs of foam, out of phase, so the sea never quite settles
  const foamTex = foamTexture();
  const foams = [];
  for (let i = 0; i < 2; i++) {
    const f = new THREE.Mesh(
      new THREE.RingGeometry(ISLAND_R - 1.5, ISLAND_R + 0.2, 56),
      basic({ map: foamTex, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
    );
    f.rotation.x = -Math.PI / 2;
    f.position.y = 0.012 + i * 0.002;
    group.add(f);
    foams.push({ mesh: f, phase: i * Math.PI });
  }

  dyn.push({
    update(t) {
      seaTex.offset.y = t * 0.006;
      seaTex.offset.x = Math.sin(t * 0.09) * 0.02;
      glitterTex.offset.y = t * 0.05;
      glitter.material.opacity = 0.6 + Math.sin(t * 0.7) * 0.12;
      for (const f of foams) {
        const p = (Math.sin(t * 0.42 + f.phase) + 1) / 2;
        f.mesh.scale.setScalar(0.955 + p * 0.05);
        f.mesh.material.opacity = 0.18 + (1 - p) * 0.45;
      }
    },
  });

  /* the decking under the table — laid so the legs would stop sinking, and
     because sand in the pocket returns is somebody else's problem now */
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(3.5, 0.06, 2.5),
    std({ color: '#8f7f68', roughness: 0.85, map: driftwoodTexture(4) }),
  );
  deck.position.y = 0.03;
  deck.receiveShadow = true;
  group.add(deck);

  /* ================= the bar ================= */

  const BAR_W = 7.0, BZ = TIKI_BAR_Z;

  // counter front: bamboo culms lashed side by side, none of them plumb
  const culmGeo = new THREE.CylinderGeometry(0.055, 0.055, 1.04, 7);
  const culms = new THREE.InstancedMesh(culmGeo, bambooMat, 62);
  for (let i = 0; i < 62; i++) {
    dummy.position.set(-1.4 - BAR_W / 2 + 0.06 + i * (BAR_W / 62), 0.52, BZ + 0.2);
    dummy.rotation.set((Math.random() - 0.5) * 0.05, Math.random() * 3, (Math.random() - 0.5) * 0.06);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    culms.setMatrixAt(i, dummy.matrix);
  }
  culms.castShadow = true;
  group.add(culms);

  /* the counter itself, in three planks that have each warped their own way —
     you cannot stand a full glass anywhere on it */
  const counterMat = std({ color: '#8a6a44', roughness: 0.34, metalness: 0.06, map: driftwoodTexture(2) });
  for (let i = 0; i < 3; i++) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(BAR_W / 3 + 0.06, 0.07, 0.72), counterMat);
    seg.position.set(-1.4 - BAR_W / 3 + i * (BAR_W / 3), 1.06 + (i - 1) * 0.012, BZ + 0.18);
    seg.rotation.z = (i - 1) * 0.012;
    seg.rotation.x = (Math.random() - 0.5) * 0.02;
    seg.castShadow = seg.receiveShadow = true;
    group.add(seg);
  }

  // back counter, bottles, blender, and a fridge that hums
  const backBar = new THREE.Mesh(new THREE.BoxGeometry(BAR_W, 1.0, 0.44), woodMat);
  backBar.position.set(-1.4, 0.5, BZ - 0.9);
  group.add(backBar);

  const bottleGeo = new THREE.CylinderGeometry(0.032, 0.036, 0.26, 7);
  const bottleNeckGeo = new THREE.CylinderGeometry(0.012, 0.026, 0.1, 6);
  for (let s = 0; s < 2; s++) {
    const y = 1.16 + s * 0.44;
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(BAR_W - 1.2, 0.05, 0.26), woodMat);
    shelf.position.set(-1.4, y - 0.03, BZ - 0.86);
    group.add(shelf);
    // shelf hangs off two bits of rope, one of which is doing all the work
    for (const rx of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.2, 5), ropeMat);
      r.position.set(-1.4 + rx * (BAR_W - 1.6) / 2, y + 0.55, BZ - 0.86);
      r.rotation.z = rx * 0.03;
      group.add(r);
    }
    const n = 20;
    for (let i = 0; i < n; i++) {
      const hue = Math.random() * 360;
      const mat = std({
        color: new THREE.Color(`hsl(${hue},58%,${30 + Math.random() * 26}%)`),
        roughness: 0.16, metalness: 0.05, transparent: true, opacity: 0.9,
      });
      const b = new THREE.Mesh(bottleGeo, mat);
      const x = -1.4 - (BAR_W - 1.8) / 2 + (i + 0.5) * ((BAR_W - 1.8) / n);
      const sc = 0.8 + Math.random() * 0.5;
      b.position.set(x, y + 0.13 * sc, BZ - 0.86 + (Math.random() - 0.5) * 0.05);
      b.scale.setScalar(sc);
      group.add(b);
      const nk = new THREE.Mesh(bottleNeckGeo, mat);
      nk.position.set(x, y + 0.26 * sc + 0.04 * sc, b.position.z);
      nk.scale.setScalar(sc);
      group.add(nk);
    }
  }

  const blender = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.24, 10),
    std({ color: '#cfd6d2', roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0.75 }));
  blender.position.set(0.9, 1.22, BZ - 0.1);
  group.add(blender);
  const blenderBase = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.18),
    std({ color: '#2c2f33', roughness: 0.5 }));
  blenderBase.position.set(0.9, 1.02, BZ - 0.1);
  group.add(blenderBase);

  // the thatched roof over the bar. The hurricane took the seaward corner.
  for (const px of [-4.6, -1.4, 1.8]) {
    for (const pz of [BZ - 1.25, BZ + 0.6]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 2.9, 8), bambooDarkMat);
      post.position.set(px, 1.45, pz);
      post.rotation.z = (Math.random() - 0.5) * 0.02;
      post.castShadow = true;
      group.add(post);
    }
  }
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, BAR_W + 1.4, 8), bambooDarkMat);
  ridge.rotation.z = Math.PI / 2;
  ridge.position.set(-1.4, 3.3, BZ - 0.3);
  group.add(ridge);

  for (const s of [-1, 1]) {
    // the -z pitch is whole; the +z one is missing its last third
    const w = s > 0 ? BAR_W * 0.66 : BAR_W + 1.2;
    const xc = s > 0 ? -1.4 - (BAR_W + 1.2 - w) / 2 : -1.4;
    const pitch = new THREE.Mesh(new THREE.BoxGeometry(w, 0.09, 1.55), thatchMat);
    pitch.position.set(xc, 3.06, BZ - 0.3 + s * 0.66);
    pitch.rotation.x = -s * 0.42;
    pitch.castShadow = true;
    group.add(pitch);

    // fringe of loose thatch hanging off the eaves
    const fringe = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.34), thatchMat);
    fringe.position.set(xc, 2.66, BZ - 0.3 + s * 1.29);
    fringe.rotation.x = -0.2 * s;
    group.add(fringe);
  }
  // the bit of blue tarpaulin over the hole, which was always going to be temporary
  const tarp = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 1.7),
    std({ color: '#2f6fa8', roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide }),
  );
  tarp.position.set(1.35, 3.02, BZ + 0.4);
  tarp.rotation.set(-Math.PI / 2 + 0.5, 0, 0.06);
  group.add(tarp);

  // bar stools: half a coconut on a post, more or less
  const stoolPositions = [];
  const stoolSeatGeo = new THREE.SphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const stoolSeatMat = std({ color: '#5b432a', roughness: 0.8, map: bambooTexture(1) });
  for (let i = 0; i < 7; i++) {
    const x = -4.6 + i * 1.05;
    const s = new THREE.Group();
    const seat = new THREE.Mesh(stoolSeatGeo, stoolSeatMat);
    seat.position.y = 0.72;
    seat.rotation.x = Math.PI;
    seat.castShadow = true;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.72, 8), bambooMat);
    post.position.y = 0.36;
    s.add(seat, post);
    s.position.set(x, 0, BZ + 0.9);
    s.rotation.y = Math.random() * 0.4;
    s.rotation.z = (Math.random() - 0.5) * 0.05;      // sand is not a foundation
    group.add(s);
    stoolPositions.push({ x, z: BZ + 0.9, y: 0.75 });
  }

  // the sign, and the chalkboard nobody has updated since the prices went up
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.94),
    std({ map: signTexture('THE SANDY BOTTOM', 'BEACH BAR · POOL · NO REFUNDS', 12), roughness: 0.9, side: THREE.DoubleSide }));
  sign.position.set(-1.4, 3.62, BZ - 0.28);
  sign.rotation.z = 0.02;
  group.add(sign);

  const menu = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.18),
    std({ map: menuTexture(), roughness: 0.95 }));
  menu.position.set(2.35, 1.5, BZ + 0.34);
  menu.rotation.y = -0.35;
  group.add(menu);
  const menuFrame = new THREE.Mesh(new THREE.BoxGeometry(0.96, 1.28, 0.05), bambooDarkMat);
  menuFrame.position.set(2.35, 1.5, BZ + 0.31);
  menuFrame.rotation.y = -0.35;
  group.add(menuFrame);

  const noGlass = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.34),
    std({ map: signTexture('NO GLASS ON THE SAND', '', 200), roughness: 0.9, side: THREE.DoubleSide }));
  noGlass.position.set(-4.9, 1.35, BZ + 0.8);
  noGlass.rotation.y = 0.3;
  group.add(noGlass);
  const noGlassPost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 6), bambooDarkMat);
  noGlassPost.position.set(-4.9, 0.65, BZ + 0.82);
  group.add(noGlassPost);

  // the broken glass, directly beneath it
  const shards = new THREE.InstancedMesh(
    new THREE.TetrahedronGeometry(0.02),
    std({ color: '#7fae9a', roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.7 }),
    24,
  );
  for (let i = 0; i < 24; i++) {
    dummy.position.set(-4.9 + (Math.random() - 0.5) * 0.9, 0.012, BZ + 1.0 + (Math.random() - 0.5) * 0.8);
    dummy.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    dummy.scale.setScalar(0.6 + Math.random());
    dummy.updateMatrix();
    shards.setMatrixAt(i, dummy.matrix);
  }
  group.add(shards);

  /* ================= tiki masks ================= */

  const maskMats = [26, 12, 40].map((h) => std({ map: maskTexture(h), roughness: 0.88 }));
  [[-5.6, BZ + 1.5, 0.4], [3.3, BZ + 1.2, -0.5], [-0.2, BZ + 1.7, 0.0]].forEach(([x, z, ry], i) => {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 1.9, 10), bambooDarkMat);
    trunk.position.set(x, 0.9, z);
    trunk.rotation.y = ry;
    trunk.castShadow = true;
    group.add(trunk);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.62), maskMats[i % 3]);
    face.position.set(x + Math.sin(ry + 0.0) * 0.155, 1.42, z + Math.cos(ry) * 0.155);
    face.rotation.y = ry;
    group.add(face);
  });

  /* ================= palms ================= */

  /* One palm leans right over the table — the light hangs off it, which is not
     how anybody would have done it on purpose. */
  const palmSpots = [
    { x: -3.2, z: -1.6, lean: 0.62, dir: 1.0, h: 4.6, hero: true },
    { x: 6.4, z: -3.6, lean: 0.22, dir: 2.4, h: 5.2 },
    { x: -7.2, z: 2.8, lean: 0.3, dir: -0.7, h: 4.9 },
    { x: 5.8, z: 4.8, lean: 0.26, dir: 3.6, h: 5.5 },
    { x: 0.6, z: 7.4, lean: 0.18, dir: 1.7, h: 5.0 },
    { x: -6.2, z: -5.4, lean: 0.34, dir: 0.4, h: 4.3 },
  ];
  const trunkMat = std({ color: '#6f5c42', roughness: 0.9, map: bambooTexture(6) });
  const frondMat = std({
    map: frondTexture(), roughness: 0.85, side: THREE.DoubleSide,
    transparent: true, alphaTest: 0.42, color: '#8ea36a',
  });
  const frondGeo = new THREE.PlaneGeometry(1.9, 0.62, 10, 1);
  // droop the frond so it hangs rather than sticking out like a shelf
  {
    const p = frondGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = (p.getX(i) + 0.95) / 1.9;
      p.setZ(i, -Math.pow(u, 2.2) * 0.72);
    }
    frondGeo.computeVertexNormals();
  }

  const FRONDS = 9;
  const fronds = new THREE.InstancedMesh(frondGeo, frondMat, palmSpots.length * FRONDS);
  const frondData = [];
  const palmCrowns = [];
  palmSpots.forEach((p, pi) => {
    // trunk: a swept tube so the lean actually curves
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      pts.push(new THREE.Vector3(
        p.x + Math.cos(p.dir) * p.lean * u * u * p.h * 0.55,
        u * p.h,
        p.z + Math.sin(p.dir) * p.lean * u * u * p.h * 0.55,
      ));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const trunk = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.17, 8), trunkMat);
    trunk.castShadow = true;
    group.add(trunk);
    const crown = curve.getPointAt(1).clone();
    palmCrowns.push(crown);

    // coconuts, two of them looking distinctly ready to fall
    const nuts = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 6),
      std({ color: '#4a3520', roughness: 0.9 }), 3);
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1;
      dummy.position.set(crown.x + Math.cos(a) * 0.18, crown.y - 0.16, crown.z + Math.sin(a) * 0.18);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0.85 + Math.random() * 0.3);
      dummy.updateMatrix();
      nuts.setMatrixAt(i, dummy.matrix);
    }
    group.add(nuts);

    for (let f = 0; f < FRONDS; f++) {
      frondData.push({
        crown,
        yaw: (f / FRONDS) * Math.PI * 2 + pi,
        pitch: -0.15 - Math.random() * 0.55,
        scale: 0.85 + Math.random() * 0.45,
        phase: Math.random() * 9,
        i: frondData.length,
      });
    }
  });
  group.add(fronds);

  const setFronds = (t, hype) => {
    for (const f of frondData) {
      const sway = Math.sin(t * 0.9 + f.phase) * (0.05 + hype * 0.06);
      dummy.position.copy(f.crown);
      dummy.rotation.set(0, 0, 0);
      dummy.quaternion.setFromEuler(new THREE.Euler(f.pitch + sway * 0.6, f.yaw + sway, sway, 'YXZ'));
      dummy.scale.setScalar(f.scale);
      dummy.translateX(0.9 * f.scale);
      dummy.updateMatrix();
      fronds.setMatrixAt(f.i, dummy.matrix);
    }
    fronds.instanceMatrix.needsUpdate = true;
  };
  setFronds(0, 0);
  dyn.push({ update(t, dt, hype) { setFronds(t, hype); } });

  /* ================= fairy lights ================= */

  /* Strung palm to palm around the outside, so nothing crosses the table.
     One run is dead — it has been dead since last season. */
  const bulbGeo = new THREE.SphereGeometry(0.036, 8, 6);
  const bulbMat = basic({ vertexColors: true });
  const strandBulbs = [];
  const wireMat = std({ color: '#1a1712', roughness: 0.9 });
  const BPS = 14;
  const strandCount = palmCrowns.length;
  const fairy = new THREE.InstancedMesh(bulbGeo, bulbMat, strandCount * BPS);
  const col = new THREE.Color();
  for (let s = 0; s < strandCount; s++) {
    const a = palmCrowns[s].clone(); a.y -= 0.9;
    const b = palmCrowns[(s + 1) % strandCount].clone(); b.y -= 1.1;
    const span = a.distanceTo(b);
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      const p = new THREE.Vector3().lerpVectors(a, b, u);
      p.y -= Math.sin(u * Math.PI) * (0.1 * span);
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.008, 4), wireMat);
    group.add(wire);
    const dead = s === 2;
    for (let i = 0; i < BPS; i++) {
      const p = curve.getPointAt((i + 0.5) / BPS);
      dummy.position.copy(p);
      dummy.position.y -= 0.05;
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      const idx = s * BPS + i;
      fairy.setMatrixAt(idx, dummy.matrix);
      fairy.setColorAt(idx, col.setRGB(0, 0, 0));
      strandBulbs.push({
        idx, dead,
        hue: [12, 46, 190, 320, 96][(i + s) % 5],
        phase: Math.random() * 9,
      });
    }
  }
  group.add(fairy);
  dyn.push({
    update(t, dt, hype) {
      for (const b of strandBulbs) {
        // a mains connection somewhere in the sand: everything blinks together,
        // then one bulb decides it isn't joining in
        const mains = Math.sin(t * 3.1) > -0.92 ? 1 : 0.15;
        const own = Math.sin(t * 21 + b.phase) > 0.9 ? 0.3 : 1;
        const v = b.dead ? 0.02 : mains * own * (0.55 + hype * 0.45);
        col.setHSL(b.hue / 360, 0.85, 0.12 + v * 0.44);
        fairy.setColorAt(b.idx, col);
      }
      if (fairy.instanceColor) fairy.instanceColor.needsUpdate = true;
    },
  });

  /* ================= tiki torches ================= */

  const torchLights = [];
  const flames = [];
  const flameGeo = new THREE.ConeGeometry(0.075, 0.34, 8);
  const TORCHES = [
    [-4.4, 1.9, true], [4.6, 1.4, true], [-2.4, 5.2, true],
    [3.2, 5.0, true], [-6.6, -1.2, true], [6.2, 0.4, false], [1.2, -6.0, false],
  ];
  TORCHES.forEach(([x, z, lit], i) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 1.9, 8), bambooMat);
    pole.position.set(x, 0.9, z);
    pole.rotation.z = (Math.random() - 0.5) * 0.09;
    pole.castShadow = true;
    group.add(pole);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.07, 0.16, 10),
      std({ color: '#2f2820', roughness: 0.6, metalness: 0.3 }));
    bowl.position.set(x, 1.9, z);
    group.add(bowl);

    if (!lit) return;                         // out of paraffin, obviously
    const flame = new THREE.Mesh(flameGeo, basic({
      color: 0xffb347, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    flame.position.set(x, 2.12, z);
    group.add(flame);
    const light = new THREE.PointLight(0xffa03a, 4.5, 7.5, 2);
    light.position.set(x, 2.2, z);
    group.add(light);
    flames.push({ flame, light, phase: i * 1.7, base: 4.5 });
    torchLights.push(light);
  });
  dyn.push({
    update(t, dt, hype) {
      for (const f of flames) {
        const n = Math.sin(t * 13 + f.phase) * 0.5 + Math.sin(t * 27.3 + f.phase * 2) * 0.3 + Math.sin(t * 5.1) * 0.2;
        f.flame.scale.set(0.85 + n * 0.2, 1 + n * 0.45, 0.85 + n * 0.2);
        f.flame.rotation.z = n * 0.16;
        f.flame.material.opacity = 0.72 + n * 0.2;
        f.light.intensity = f.base * (0.78 + n * 0.35) * (1 + hype * 0.4);
      }
    },
  });

  /* ================= volleyball net ================= */

  const netGroup = new THREE.Group();
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 2.3, 8), bambooDarkMat);
    post.position.set(0, 1.15, s * 1.9);
    post.rotation.x = s * 0.06;                  // both posts leaning, in different directions
    netGroup.add(post);
  }
  const netGeo = new THREE.PlaneGeometry(3.8, 0.9, 14, 5);
  {
    const p = netGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = (p.getX(i) + 1.9) / 3.8;
      p.setY(i, p.getY(i) - Math.sin(u * Math.PI) * 0.42);   // nobody has tensioned it since 2019
    }
    netGeo.computeVertexNormals();
  }
  const net = new THREE.Mesh(netGeo, std({
    map: netTexture(), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.9,
  }));
  net.rotation.y = Math.PI / 2;
  net.position.y = 1.7;
  netGroup.add(net);
  netGroup.position.set(6.6, 0, 2.6);
  group.add(netGroup);

  // the ball, long since gone flat, wedged under the net
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10),
    std({ color: '#d8d2c0', roughness: 0.7 }));
  ball.position.set(6.9, 0.09, 3.5);
  ball.scale.y = 0.82;
  group.add(ball);

  /* ================= surfboards, coolers, flotsam ================= */

  const boardShape = new THREE.Shape();
  boardShape.moveTo(0, 1.05);
  boardShape.bezierCurveTo(0.34, 0.55, 0.31, -0.55, 0, -1.05);
  boardShape.bezierCurveTo(-0.31, -0.55, -0.34, 0.55, 0, 1.05);
  const boardGeo = new THREE.ExtrudeGeometry(boardShape, {
    depth: 0.06, bevelEnabled: true, bevelSize: 0.022, bevelThickness: 0.018, bevelSegments: 2, curveSegments: 14,
  });
  boardGeo.center();
  [
    [-5.4, -3.2, '#e8dfc8', 0.5],
    [-5.9, -2.6, '#c96a4e', -0.35],
    [4.9, -5.2, '#6fa8b4', 0.28],
  ].forEach(([x, z, c, tilt]) => {
    const b = new THREE.Mesh(boardGeo, std({ color: c, roughness: 0.35, metalness: 0.05 }));
    b.position.set(x, 1.0, z);
    b.rotation.set(tilt * 0.35, Math.random() * 3, tilt);
    b.castShadow = true;
    group.add(b);
  });

  const coolerMat = std({ color: '#c8cdd2', roughness: 0.55 });
  const coolerLidMat = std({ color: '#3f6fa2', roughness: 0.5 });
  [[-2.9, BZ + 1.6, 0.3], [1.6, BZ + 1.4, -0.6]].forEach(([x, z, ry], i) => {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.4, 0.38), coolerMat);
    body.position.set(x, 0.2, z);
    body.rotation.y = ry;
    body.castShadow = true;
    group.add(body);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.07, 0.42), coolerLidMat);
    lid.position.set(x + (i ? 0.12 : 0), 0.43, z + (i ? 0.16 : 0));
    lid.rotation.set(i ? -0.5 : 0, ry, 0);       // one of them never closes properly
    group.add(lid);
  });

  // cans, mostly not in the cooler
  const cans = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.033, 0.033, 0.12, 8),
    std({ color: '#b6c0c6', roughness: 0.3, metalness: 0.7 }),
    28,
  );
  for (let i = 0; i < 28; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 2.6 + Math.random() * 5.4;
    dummy.position.set(Math.cos(a) * r, 0.033, Math.sin(a) * r * 0.9 - 0.6);
    dummy.rotation.set(Math.PI / 2, Math.random() * 3, Math.random() * 3);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    cans.setMatrixAt(i, dummy.matrix);
  }
  group.add(cans);

  // a single flip-flop, and the crate somebody was sitting on
  const flop = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.26),
    std({ color: '#3f8f8a', roughness: 0.8 }));
  flop.position.set(2.9, 0.012, 3.4);
  flop.rotation.y = 0.8;
  group.add(flop);
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.36), woodMat);
  crate.position.set(-3.6, 0.16, 2.9);
  crate.rotation.set(0.05, 0.6, 0.02);
  group.add(crate);

  /* ================= plastic flamingos ================= */

  const flamMat = std({ color: '#ff5f9a', roughness: 0.42, metalness: 0.02 });
  const legMat = std({ color: '#d9d5c6', roughness: 0.5 });
  const flamBody = new THREE.SphereGeometry(0.14, 10, 8);
  const flamNeck = new THREE.TorusGeometry(0.16, 0.028, 6, 12, Math.PI * 1.1);
  const flamHead = new THREE.SphereGeometry(0.055, 8, 6);
  const flamBeak = new THREE.ConeGeometry(0.028, 0.1, 6);
  const flamLeg = new THREE.CylinderGeometry(0.011, 0.011, 0.44, 5);
  [[-1.9, 3.8, 0.4], [-1.55, 4.1, 2.1], [5.2, -1.4, -1.0], [-6.4, 0.9, 2.9]].forEach(([x, z, ry]) => {
    const f = new THREE.Group();
    const body = new THREE.Mesh(flamBody, flamMat);
    body.position.y = 0.5;
    body.scale.set(1.5, 1, 1);
    const neck = new THREE.Mesh(flamNeck, flamMat);
    neck.position.set(0.16, 0.66, 0);
    neck.rotation.z = -0.6;
    const head = new THREE.Mesh(flamHead, flamMat);
    head.position.set(0.3, 0.82, 0);
    const beak = new THREE.Mesh(flamBeak, std({ color: '#1e1a18', roughness: 0.6 }));
    beak.position.set(0.36, 0.79, 0);
    beak.rotation.z = -2.1;
    const l1 = new THREE.Mesh(flamLeg, legMat); l1.position.set(0.04, 0.24, 0.05);
    const l2 = new THREE.Mesh(flamLeg, legMat); l2.position.set(-0.03, 0.24, -0.05);
    f.add(body, neck, head, beak, l1, l2);
    f.position.set(x, 0, z);
    f.rotation.y = ry;
    f.rotation.z = (Math.random() - 0.5) * 0.12;
    group.add(f);
  });

  /* ================= the parrot ================= */

  /* Reg. He has been here longer than the bar and says one thing, rarely. */
  const perch = new THREE.Group();
  const perchPost = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.6, 8), bambooDarkMat);
  perchPost.position.y = 0.8;
  const perchBar = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.6, 6), bambooDarkMat);
  perchBar.rotation.x = Math.PI / 2;
  perchBar.position.y = 1.6;
  const perchRing = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.012, 5, 14), legMat);
  perchRing.position.set(0, 1.42, 0.24);
  perch.add(perchPost, perchBar, perchRing);

  const parrot = new THREE.Group();
  const pBody = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10),
    std({ color: '#3f8f46', roughness: 0.75 }));
  pBody.scale.set(0.86, 1.1, 0.86);
  const pHead = new THREE.Mesh(new THREE.SphereGeometry(0.082, 10, 8),
    std({ color: '#4aa050', roughness: 0.75 }));
  pHead.position.set(0.02, 0.17, 0);
  const pBald = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 6),
    std({ color: '#b58a72', roughness: 0.9 }));       // he plucks when he is bored, which is always
  pBald.position.set(-0.03, 0.2, 0.02);
  pBald.scale.set(1, 0.6, 0.8);
  const pBeak = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.075, 7),
    std({ color: '#2b2622', roughness: 0.5 }));
  pBeak.position.set(0.1, 0.15, 0);
  pBeak.rotation.z = -1.9;
  const pTail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.015),
    std({ color: '#b03a3a', roughness: 0.8 }));
  pTail.position.set(-0.1, -0.16, 0);
  pTail.rotation.z = 0.5;
  const wings = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.02),
      std({ color: '#2f7a3c', roughness: 0.8 }));
    w.position.set(0, 0.02, s * 0.1);
    parrot.add(w);
    wings.push({ mesh: w, s });
  }
  for (const eye of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), basic({ color: 0x120e0a }));
    e.position.set(0.07, 0.19, eye * 0.05);
    parrot.add(e);
  }
  parrot.add(pBody, pHead, pBald, pBeak, pTail);
  parrot.position.y = 1.72;
  perch.add(parrot);
  perch.position.set(3.9, 0, -2.4);
  group.add(perch);

  dyn.push({
    update(t, dt, hype) {
      // a slow, resigned sway; a flap only when the room gets loud enough to
      // disturb him, and even then not much of one
      parrot.rotation.z = Math.sin(t * 0.7) * 0.045;
      parrot.position.y = 1.72 + Math.sin(t * 1.1) * 0.008;
      pHead.rotation.z = -0.12 + Math.sin(t * 0.31) * 0.16;
      const flap = Math.max(0, Math.sin(t * 2.3 + 1.1) - 0.86) * (2 + hype * 8);
      for (const w of wings) w.mesh.rotation.x = w.s * flap;
    },
  });

  /* ================= deck chairs (the booth equivalent) ================= */

  const boothSeats = [];
  const canvasMats = [stripeTexture(6, 40), stripeTexture(200, 42), stripeTexture(120, 44)]
    .map((m) => std({ map: m, roughness: 0.9, side: THREE.DoubleSide }));
  for (let i = 0; i < 3; i++) {
    const z = -1.6 + i * 2.1;
    const x = RW / 2 - 0.9;

    for (const s of [-1, 1]) {
      const chair = new THREE.Group();
      for (const fx of [-0.26, 0.26]) {
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, 0.04), woodMat);
        back.position.set(fx, 0.45, -0.16);
        back.rotation.x = 0.36;
        const front = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.62, 0.04), woodMat);
        front.position.set(fx, 0.28, 0.22);
        front.rotation.x = -0.28;
        chair.add(back, front);
      }
      const seatC = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.95), canvasMats[i % 3]);
      seatC.position.set(0, 0.44, 0.0);
      seatC.rotation.set(-Math.PI / 2 + 0.75, 0, 0);
      seatC.castShadow = true;
      chair.add(seatC);
      chair.position.set(x + 0.1, 0, z + s * 0.86);
      chair.rotation.y = -Math.PI / 2 + s * 0.35 + (Math.random() - 0.5) * 0.2;
      group.add(chair);
      boothSeats.push({ x: x + 0.1, z: z + s * 0.86, y: 0.42 });
    }

    // an upturned crate doing duty as a table, with the usual archaeology on it
    const tbl = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.42, 0.44), woodMat);
    tbl.position.set(x + 0.05, 0.21, z);
    tbl.rotation.y = Math.random();
    group.add(tbl);
    for (let k = 0; k < 2; k++) {
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.028, 0.12, 10),
        std({ color: '#d8c07a', roughness: 0.12, transparent: true, opacity: 0.55 }));
      glass.position.set(x + 0.05 + (Math.random() - 0.5) * 0.24, 0.48, z + (Math.random() - 0.5) * 0.24);
      group.add(glass);
    }
  }

  /* ================= the jukebox, half buried ================= */

  const juke = new THREE.Group();
  const jbody = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.5),
    std({ color: '#4a3140', roughness: 0.5, metalness: 0.15 }));
  jbody.position.y = 0.7;
  jbody.castShadow = true;
  juke.add(jbody);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.055, 8, 18, Math.PI),
    basic({ color: '#ff3d8a' }));
  arch.position.set(0, 1.42, 0.24);
  juke.add(arch);
  const jglass = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5), basic({ color: '#3a2a18' }));
  jglass.position.set(0, 0.98, 0.256);
  juke.add(jglass);
  juke.position.set(-5.0, -0.18, 1.9);            // sinking, at about a foot a year
  juke.rotation.set(0.14, Math.PI / 2.6, -0.11);
  group.add(juke);
  const jukeLight = new THREE.PointLight(0xff5f9a, 1.2, 4, 2);
  jukeLight.position.set(-4.8, 1.3, 2.1);
  group.add(jukeLight);
  // a drift of sand up the windward side
  const drift = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    std({ color: '#d9c096', roughness: 0.95, map: sandTex }));
  drift.position.set(-5.1, 0, 1.9);
  drift.scale.set(1.1, 0.22, 0.9);
  group.add(drift);
  dyn.push({
    update(t) {
      // the marquee gave up years ago but the transformer has not been told
      const on = Math.sin(t * 0.9) > 0.7 && Math.sin(t * 33) > 0.2 ? 1 : 0;
      arch.material.color.setRGB(on ? 1 : 0.14, on ? 0.24 : 0.04, on ? 0.54 : 0.1);
      jukeLight.intensity = on ? 3 : 0.2;
      jglass.material.color.setRGB(on ? 0.9 : 0.23, on ? 0.7 : 0.17, on ? 0.3 : 0.1);
    },
  });

  /* ================= debris in the sand ================= */

  const butts = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.006, 0.006, 0.045, 5),
    std({ color: '#e2dac4', roughness: 0.95 }),
    120,
  );
  for (let i = 0; i < 120; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 1.9 + Math.random() * 7.5;
    dummy.position.set(Math.cos(a) * r, 0.008, Math.sin(a) * r);
    dummy.rotation.set(Math.PI / 2 + (Math.random() - 0.5) * 0.4, Math.random() * 3, Math.random() * 3);
    dummy.scale.setScalar(0.8 + Math.random() * 0.5);
    dummy.updateMatrix();
    butts.setMatrixAt(i, dummy.matrix);
  }
  group.add(butts);

  // seaweed and a few shells along the wash line
  const weed = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.5, 0.012, 0.09),
    std({ color: '#4d4a2c', roughness: 0.95 }),
    40,
  );
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = ISLAND_R - 1.3 + Math.random() * 1.0;
    dummy.position.set(Math.cos(a) * r, 0.01, Math.sin(a) * r);
    dummy.rotation.set(0, a + Math.PI / 2 + (Math.random() - 0.5), 0);
    dummy.scale.set(0.6 + Math.random() * 1.4, 1, 0.6 + Math.random());
    dummy.updateMatrix();
    weed.setMatrixAt(i, dummy.matrix);
  }
  group.add(weed);

  /* ================= lighting ================= */

  const lights = new THREE.Group();
  // dusk: cool from the sky, warm bounce back off the sand
  const hemi = new THREE.HemisphereLight(0x4a5a8c, 0x6b5334, 0.5);
  lights.add(hemi);
  const ambient = new THREE.AmbientLight(0xffd9b4, 0.14);
  lights.add(ambient);

  /* The table light: a bamboo yard hung on rope off the leaning palm, three
     shades made of woven cane and one glass float. Still the key light, and
     still the only serious shadow-caster. */
  const fixture = new THREE.Group();
  const yardMat = std({ color: '#9c854f', roughness: 0.7, map: bambooTexture(2) });
  const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.0, 8), yardMat);
  yard.rotation.z = Math.PI / 2;
  yard.position.y = 0.34;
  fixture.add(yard);

  const shadeMat = std({ color: '#5a4526', roughness: 0.85, map: thatchTexture(1), side: THREE.DoubleSide });
  const tableSpots = [];
  const bulbs = [];
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 0.68;
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.22, 14, 1, true), shadeMat);
    shade.position.set(x, 0.2, 0);
    shade.rotation.x = Math.PI;
    fixture.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), basic({ color: 0xffe0ad }));
    bulb.position.set(x, 0.13, 0);
    fixture.add(bulb);
    bulbs.push(bulb);

    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.2, 5), ropeMat);
    rope.position.set(x, 0.31, 0);
    fixture.add(rope);

    const sp = new THREE.SpotLight(0xffe3b8, TIKI_LIGHT, 4.6, 0.9, 0.5, 1.5);
    sp.position.set(x, 0.12, 0);
    sp.target.position.set(x, -1.2, 0);
    sp.castShadow = i === 1;
    if (sp.castShadow) {
      sp.shadow.mapSize.set(2048, 2048);
      sp.shadow.bias = -0.0006;
      sp.shadow.normalBias = 0.015;
      sp.shadow.camera.near = 0.2;
      sp.shadow.camera.far = 4;
    }
    fixture.add(sp, sp.target);
    tableSpots.push(sp);
  }
  // a dead string of tinsel someone wound round the yard at Christmas
  const tinsel = new THREE.Mesh(new THREE.TorusKnotGeometry(0.06, 0.012, 40, 5, 9, 2),
    std({ color: '#7a6a3a', roughness: 0.4, metalness: 0.5 }));
  tinsel.position.set(0.4, 0.34, 0);
  tinsel.scale.set(6, 0.35, 0.35);
  fixture.add(tinsel);

  fixture.position.set(0, TABLE.height + 0.95, 0);
  group.add(fixture);

  // the rope back to the palm, which is what the whole lot is hanging off
  {
    const from = new THREE.Vector3(0, TABLE.height + 1.32, 0);
    const to = palmCrowns[0].clone().add(new THREE.Vector3(0, -0.35, 0));
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      const p = new THREE.Vector3().lerpVectors(from, to, u);
      p.y -= Math.sin(u * Math.PI) * 0.18;
      pts.push(p);
    }
    const hang = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.012, 5),
      ropeMat,
    );
    group.add(hang);
  }

  // practicals: a couple of warm bulbs under the thatch, plus the torches
  const practicals = [];
  for (const [x, z] of [[-3.4, BZ - 0.1], [0.6, BZ - 0.1], [RW / 2 - 1.2, 1.0]]) {
    const pl = new THREE.PointLight(0xffc07a, 5, 7, 2);
    pl.position.set(x, 2.5, z);
    lights.add(pl);
    practicals.push(pl);
    if (z === BZ - 0.1) {
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.18, 12, 1, true), shadeMat);
      shade.position.set(x, 2.62, z);
      shade.rotation.x = Math.PI;
      group.add(shade);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), basic({ color: 0xffd39a }));
      b.position.set(x, 2.56, z);
      group.add(b);
    }
  }
  practicals.push(...torchLights);

  /* Rims: the sunset from behind the bar, the cold sea from the other side,
     and the fairy-light haze from the beach end. main.js drives [0] and [1]. */
  const rimL = new THREE.PointLight(0xff4d2f, 7, 14, 2); rimL.position.set(-4.6, 2.6, -5.2);
  const rimR = new THREE.PointLight(0x2fd0ff, 7, 14, 2); rimR.position.set(4.8, 2.4, 1.6);
  const rimB = new THREE.PointLight(0xffae4a, 5, 11, 2); rimB.position.set(0, 2.6, 5.0);
  lights.add(rimL, rimR, rimB);

  group.add(lights);

  dyn.push({
    update(t, dt, hype) {
      // the yard swings on its rope whenever anybody leans on the table
      fixture.rotation.z = Math.sin(t * 1.7) * (0.006 + hype * 0.08);
      fixture.rotation.x = Math.cos(t * 1.3) * (0.005 + hype * 0.06);
      const f = 0.9 + Math.sin(t * 9) * 0.035 + hype * 0.35;
      for (const b of bulbs) b.material.color.setRGB(1 * f, 0.88 * f, 0.68 * f);
      for (const sp of tableSpots) sp.intensity = TIKI_LIGHT * (0.94 + hype * 0.3);
    },
  });

  /* ================= moths and sea spray ================= */

  /* Moths at the table light, because it is the brightest thing for a mile and
     they have no other plans. */
  const MOTHS = 34;
  const mp = new Float32Array(MOTHS * 3);
  const mothData = [];
  for (let i = 0; i < MOTHS; i++) {
    const around = i < 22
      ? new THREE.Vector3(0, TABLE.height + 1.05, 0)
      : new THREE.Vector3(TORCHES[i % TORCHES.length][0], 2.2, TORCHES[i % TORCHES.length][1]);
    mothData.push({
      c: around,
      r: 0.18 + Math.random() * 0.5,
      s: (Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 1.6),
      p: Math.random() * 9,
      yr: 0.05 + Math.random() * 0.22,
    });
  }
  const mothGeo = new THREE.BufferGeometry();
  mothGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const moths = new THREE.Points(mothGeo, new THREE.PointsMaterial({
    color: 0xffe9c0, size: 0.045, transparent: true, opacity: 0.85,
    map: softDotTexture(), alphaTest: 0.01, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  moths.frustumCulled = false;
  group.add(moths);

  const SPRAY = 260;
  const sp2 = new Float32Array(SPRAY * 3);
  for (let i = 0; i < SPRAY; i++) {
    sp2[i * 3] = (Math.random() - 0.5) * 22;
    sp2[i * 3 + 1] = 0.2 + Math.random() * 3.4;
    sp2[i * 3 + 2] = (Math.random() - 0.5) * 22;
  }
  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(sp2, 3));
  const spray = new THREE.Points(sprayGeo, new THREE.PointsMaterial({
    color: 0xcfe4ff, size: 0.05, transparent: true, opacity: 0.11,
    map: softDotTexture(), alphaTest: 0.01, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  spray.frustumCulled = false;
  group.add(spray);

  dyn.push({
    update(t, dt) {
      const a = mothGeo.attributes.position.array;
      for (let i = 0; i < MOTHS; i++) {
        const m = mothData[i];
        const ang = t * m.s + m.p;
        // the wobble is the whole point: a circle reads as a satellite, not a moth
        const rr = m.r * (1 + Math.sin(t * 5.3 + m.p) * 0.28);
        a[i * 3] = m.c.x + Math.cos(ang) * rr;
        a[i * 3 + 1] = m.c.y + Math.sin(t * 3.1 + m.p) * m.yr;
        a[i * 3 + 2] = m.c.z + Math.sin(ang) * rr;
      }
      mothGeo.attributes.position.needsUpdate = true;

      const b = sprayGeo.attributes.position.array;
      for (let i = 0; i < SPRAY; i++) {
        b[i * 3] += dt * (0.16 + (i % 5) * 0.03);      // onshore breeze, all evening
        b[i * 3 + 1] += Math.sin(t * 0.7 + i) * 0.0006;
        if (b[i * 3] > 11) b[i * 3] = -11;
      }
      sprayGeo.attributes.position.needsUpdate = true;
    },
  });

  return {
    group, dyn,
    lights: { hemi, ambient, tableSpots, practicals, rims: [rimL, rimR, rimB] },
    fixture,
    seats: { stools: stoolPositions, booths: boothSeats },
    room: TIKI_ROOM,
  };
}

/* ------------------------------------------------------------------ */
/* Where the muppets stand                                             */
/* ------------------------------------------------------------------ */

/**
 * Same shape as barSeats: a ring pressed up against the table, a looser ring
 * behind it, the bar, the deck chairs, and a scatter of people who wandered
 * up the beach and stayed.
 */
export function tikiSeats(target = 90) {
  const seats = [];
  const TL = TABLE.halfLen + 0.09, TW = TABLE.halfWid + 0.09;

  /* The front row. Same clearances as the dive bar, and for the same reason:
     the aiming camera sits about a metre behind the cue ball and the cue ball
     can be on any cushion, so anything closer puts a muppet in the shot. */
  const RING = 34;
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
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + 0.4;
    const rx = TL + 1.75 + Math.random() * 0.55;
    const rz = TW + 1.85 + Math.random() * 0.55;
    seats.push({
      pos: new THREE.Vector3(Math.cos(a) * rx, 0, Math.sin(a) * rz),
      sit: false, side: Math.cos(a) > 0 ? 1 : -1, rank: 0.6,
    });
  }

  // on the stools, and standing two-deep behind them waiting to be served
  for (let i = 0; i < 7; i++) {
    seats.push({
      pos: new THREE.Vector3(-4.6 + i * 1.05 + (Math.random() - 0.5) * 0.2, 0.75, TIKI_BAR_Z + 0.9),
      sit: true, side: 0, rank: 1.1, stool: true,
    });
  }
  for (let i = 0; i < 5; i++) {
    seats.push({
      pos: new THREE.Vector3(-4.2 + i * 1.3 + (Math.random() - 0.5) * 0.3, 0, TIKI_BAR_Z + 1.45),
      sit: false, side: 0, rank: 1.3,
    });
  }

  // deck chairs
  for (let i = 0; i < 3; i++) {
    const z = -1.6 + i * 2.1;
    for (const s of [-1, 1]) {
      seats.push({
        pos: new THREE.Vector3(TIKI_ROOM.w / 2 - 0.8, 0.42, z + s * 0.86),
        sit: true, side: 1, rank: 1.5,
      });
    }
  }

  // a doomed game of volleyball, over by the net
  for (let i = 0; i < 4; i++) {
    seats.push({
      pos: new THREE.Vector3(5.6 + Math.random() * 1.6, 0, 1.4 + i * 0.8 + (Math.random() - 0.5) * 0.4),
      sit: false, side: 1, rank: 1.7,
    });
  }

  // strays, up from the water line
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 3.4 + Math.random() * 2.2;
    seats.push({
      pos: new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r * 0.85 + 1.0),
      sit: false, side: Math.cos(a) > 0 ? 1 : -1, rank: 1.9,
    });
  }

  seats.sort((a, b) => a.rank - b.rank);
  return seats.slice(0, Math.min(target, seats.length));
}

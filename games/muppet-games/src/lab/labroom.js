import * as THREE from 'three';
import { buildJar, jarSignTexture, dailyJar, JAR } from './jar.js';
import { buildBountyWall } from './bounty.js';
import { MemeWall } from './memewall.js';

const std = (o) => new THREE.MeshStandardMaterial(o);

/**
 * The rest of the pub: the shrine wall, the meme wall, the jar table, the
 * blackjack table and the shop shelf behind the bar.
 *
 * Laid out around the existing furniture — the bar runs along -z, the booths
 * are against +x, the jukebox is in the -x corner — so everything new lives in
 * the +z half where there is actually floor.
 */

export const SPOTS = {
  bounty: { x: -4.35, z: 3.6, r: 1.6, label: 'THE SHRINE', key: 'bounty' },
  memes: { x: 1.2, z: 4.35, r: 1.5, label: 'THE MEME WALL', key: 'memes' },
  jar: { x: 3.4, z: 3.35, r: 1.15, label: 'THE JAR', key: 'jar' },
  blackjack: { x: -2.6, z: 3.5, r: 1.3, label: 'BLACKJACK', key: 'blackjack' },
  shop: { x: 0.6, z: -3.05, r: 1.3, label: 'THE BAR', key: 'shop' },
  table: { x: 0, z: 1.55, r: 1.2, label: 'THE POOL TABLE', key: 'table' },
};

/** Rectangles the player cannot walk through. */
export const BLOCKERS = [
  [-1.25, -0.75, 1.25, 0.75],       // the pool table
  [-5.25, -4.45, 2.45, -3.60],      // the bar counter
  [-5.25, -5.10, 2.45, -4.50],      // the back bar
  [4.95, -2.90, 6.30, 3.90],        // the booths
  [-6.30, 0.95, -5.15, 2.30],       // the jukebox
  [2.95, 4.05, 3.85, 4.95],         // the jar table
  [-3.55, 4.10, -1.65, 5.10],       // the blackjack table
];

export const WALK_BOUNDS = { minX: -6.1, maxX: 6.1, minZ: -3.35, maxZ: 5.95 };

/* ------------------------------------------------------------------ */

function feltTexture(hue = 120) {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const img = g.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const n = (Math.random() - 0.5) * 18;
    const c = new THREE.Color(`hsl(${hue},42%,${22 + n * 0.4}%)`);
    img.data[i * 4] = c.r * 255;
    img.data[i * 4 + 1] = c.g * 255;
    img.data[i * 4 + 2] = c.b * 255;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function signTexture(lines, hue = 40) {
  const W = 512, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#efe4c6';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = `hsl(${hue},60%,30%)`;
  g.lineWidth = 7;
  g.strokeRect(10, 10, W - 20, H - 20);
  g.fillStyle = `hsl(${hue},64%,24%)`;
  g.textAlign = 'center';
  lines.forEach((l, i) => {
    g.font = `700 ${i === 0 ? 52 : 30}px "Barlow Condensed", Impact, sans-serif`;
    g.fillText(l, W / 2, 82 + i * 48);
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */

/** The jar, its table, the pencil and the honesty box. */
function buildJarTable(packed) {
  const group = new THREE.Group();
  const H = 0.78;

  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.44, 0.44, 0.05, 20),
    std({ color: '#5a3d26', roughness: 0.5 }),
  );
  top.position.y = H;
  top.castShadow = top.receiveShadow = true;
  group.add(top);

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.14, H, 12),
    std({ color: '#2b2b30', roughness: 0.4, metalness: 0.6 }),
  );
  stem.position.y = H / 2;
  group.add(stem);

  const jar = buildJar(packed);
  jar.group.position.set(0, H + 0.026, 0);
  group.add(jar.group);

  // the card taped to the front of the jar
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.2),
    std({ map: jarSignTexture(packed.kind), roughness: 0.9, side: THREE.DoubleSide }),
  );
  sign.position.set(0, H + 0.42, 0.16);
  sign.rotation.x = -0.12;
  group.add(sign);

  // a pad and a chewed pencil
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.008, 0.2),
    std({ color: '#efe8d0', roughness: 0.95 }),
  );
  pad.position.set(0.26, H + 0.03, 0.1);
  pad.rotation.y = 0.3;
  group.add(pad);
  const pencil = new THREE.Mesh(
    new THREE.CylinderGeometry(0.005, 0.005, 0.12, 6),
    std({ color: '#d8a52a', roughness: 0.6 }),
  );
  pencil.position.set(0.28, H + 0.04, 0.05);
  pencil.rotation.set(0, 0.4, Math.PI / 2);
  group.add(pencil);

  const lamp = new THREE.PointLight(0xffd9a8, 2.4, 2.4, 2);
  lamp.position.set(0, H + 0.95, 0);
  group.add(lamp);

  return { group, jar };
}

/** A small blackjack table with a dealer who is clearly not licensed. */
function buildBlackjackTable() {
  const group = new THREE.Group();
  const H = 0.76;
  const felt = feltTexture(148);

  // half-moon top
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 0.78, Math.PI, 0, true);
  shape.lineTo(-0.78, 0);
  const top = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false }),
    std({ map: felt, roughness: 0.95 }),
  );
  top.rotation.x = Math.PI / 2;
  top.position.y = H + 0.05;
  top.castShadow = top.receiveShadow = true;
  group.add(top);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.78, 0.03, 8, 28, Math.PI),
    std({ color: '#3a2418', roughness: 0.5 }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = H + 0.06;
  group.add(rim);

  for (const sx of [-0.5, 0.5]) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, H, 8),
      std({ color: '#2b2b30', roughness: 0.4, metalness: 0.6 }),
    );
    leg.position.set(sx, H / 2, -0.2);
    group.add(leg);
  }

  // betting circles printed on the felt
  for (let i = -1; i <= 1; i++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.1, 0.006, 6, 20),
      std({ color: '#e8d9a8', roughness: 0.6 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(i * 0.32, H + 0.052, 0.34);
    group.add(ring);
  }

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.31),
    std({ map: signTexture(['BLACKJACK', 'DEALER STANDS ON 17', 'POINTS ONLY. NO CASH.'], 148), roughness: 0.9 }),
  );
  sign.position.set(0, H + 0.44, -0.42);
  group.add(sign);

  // the dealer: a shape behind the table with a bow tie and no licence
  const dealer = new THREE.Group();
  const fur = std({ color: '#8f6bd8', roughness: 1 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), fur);
  body.scale.set(1.05, 1.2, 0.9);
  body.position.y = 0.42;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 12), fur);
  head.position.y = 0.82;
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 9),
      std({ color: 0xfdfbf4, roughness: 0.25 }));
    eye.position.set(s * 0.1, 0.88, 0.15);
    dealer.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 7),
      std({ color: 0x0a090c, roughness: 0.2 }));
    pupil.position.set(s * 0.1, 0.88, 0.21);
    dealer.add(pupil);
  }
  const tie = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.03),
    std({ color: '#c0281f', roughness: 0.6 }));
  tie.position.set(0, 0.62, 0.2);
  dealer.add(body, head, tie);
  dealer.position.set(0, 0, -0.75);
  dealer.rotation.y = Math.PI;
  group.add(dealer);

  const lamp = new THREE.PointLight(0xffe0b0, 2.6, 3.2, 2);
  lamp.position.set(0, 1.7, 0.1);
  group.add(lamp);

  const dyn = [{
    update(t) {
      dealer.position.y = Math.sin(t * 1.3) * 0.012;
      dealer.rotation.z = Math.sin(t * 0.9) * 0.03;
      head.rotation.y = Math.sin(t * 0.7) * 0.25;
    },
  }];

  return { group, dyn };
}

/** The gear on the shelf behind the bar that you can actually buy. */
function buildShopShelf() {
  const group = new THREE.Group();

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.55),
    std({ map: signTexture(['THE SHOP', 'CUES · CLOTH · DRINK', 'POINTS ONLY'], 34), roughness: 0.9 }),
  );
  sign.position.set(1.5, 2.05, -4.55);
  group.add(sign);

  // cues in a rack behind the bar
  for (let i = 0; i < 4; i++) {
    const cue = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.014, 1.4, 7),
      std({
        color: ['#c9a066', '#5a3520', '#2b2b30', '#c9a03a'][i],
        roughness: i === 3 ? 0.2 : 0.45,
        metalness: i === 3 ? 0.85 : 0.05,
      }),
    );
    cue.position.set(0.6 + i * 0.16, 1.42, -4.62);
    cue.rotation.x = 0.08;
    group.add(cue);
  }

  // rolls of cloth
  for (let i = 0; i < 3; i++) {
    const roll = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.42, 12),
      std({ color: ['#1d4f86', '#7a1f22', '#4a2472'][i], roughness: 0.95 }),
    );
    roll.position.set(1.9 + i * 0.17, 1.32, -4.6);
    roll.rotation.z = Math.PI / 2;
    group.add(roll);
  }

  return { group };
}

/* ------------------------------------------------------------------ */

/**
 * Build everything and return it with the interaction points already wired to
 * the geometry, so the walker only has to be told where to stand.
 */
export async function buildLabFittings(opts = {}) {
  const group = new THREE.Group();
  const dyn = [];

  const packed = dailyJar(opts.storage);
  const jarTable = buildJarTable(packed);
  jarTable.group.position.set(SPOTS.jar.x, 0, SPOTS.jar.z + 0.9);
  group.add(jarTable.group);

  const bj = buildBlackjackTable();
  bj.group.position.set(SPOTS.blackjack.x, 0, SPOTS.blackjack.z + 1.1);
  bj.group.rotation.y = Math.PI;
  group.add(bj.group);
  dyn.push(...bj.dyn);

  const shop = buildShopShelf();
  group.add(shop.group);

  const memes = new MemeWall({
    origin: new THREE.Vector3(1.2, 0, 6.2),
    rotationY: Math.PI,
    width: 4.6, height: 2.4,
    onChange: opts.onMemeChange,
  });
  group.add(memes.group);
  dyn.push(...memes.dyn);

  // the shrine is fetched, so it arrives late and gets added when it is ready
  const bountyHolder = new THREE.Group();
  group.add(bountyHolder);
  const bountyPromise = buildBountyWall({
    origin: new THREE.Vector3(-6.42, 0, 3.6),
    rotationY: Math.PI / 2,
    width: 5.0, height: 2.4,
  }).then((wall) => {
    bountyHolder.add(wall.group);
    dyn.push(...wall.dyn);
    return wall;
  }).catch(() => null);

  return {
    group, dyn, packed, memes, bountyPromise,
    jarCount: packed.count,
  };
}

import * as THREE from 'three';

/**
 * The meme wall.
 *
 * Three switchable categories, as asked for. What the wall renders by default
 * is its own artwork: I will not draw likenesses of real people or put words in
 * a real person's mouth, so the built-in posters are muppet-bar nonsense in the
 * game's own style rather than fake photographs or invented quotes.
 *
 * The wall is built to take real images instead. Drop files in
 * `public/memes/<category-id>/` with an `index.json` listing them:
 *
 *   { "images": ["one.jpg", "two.png"], "captions": ["optional", "optional"] }
 *
 * and this picks them up automatically — no code change, and whatever goes on
 * the wall is the owner's call, not mine.
 */

const std = (o) => new THREE.MeshStandardMaterial(o);

export const CATEGORIES = [
  {
    id: 'vance',
    label: 'VANCE',
    sub: 'POLITICS CORNER',
    hue: 210,
    // built-in fallbacks: no likeness, no quotes, just the bar's own daftness
    posters: [
      ['THE COUCH', 'IS INNOCENT AND HAS BEEN THROUGH ENOUGH'],
      ['SOMEONE EXPLAIN', 'THE INTERNET TO THE LANDLORD'],
      ['POLITICS NIGHT', 'CANCELLED AFTER LAST TIME'],
      ['NO POLITICS', 'AT THE POOL TABLE'],
    ],
  },
  {
    id: 'kirk',
    label: 'DEBATE CLUB',
    sub: 'CHANGE MY MIND',
    hue: 32,
    posters: [
      ['CHANGE MY MIND', 'THE SIDE POCKET IS HARDER THAN THE CORNER'],
      ['PROVE ME WRONG', 'A BENT CUE IS A PERSONALITY'],
      ['DEBATE ME', 'ABOUT WHOSE ROUND IT IS'],
      ['FOLDING TABLE', 'AVAILABLE FOR HIRE'],
    ],
  },
  {
    id: 'knicks',
    label: 'KNICKS',
    sub: 'A RED MUPPET SITUATION',
    hue: 16,
    posters: [
      ['THE RED ONE', 'HAS OPINIONS ABOUT THE KNICKS'],
      ['BANNED', 'FROM THE SPORTS SCREEN'],
      ['HE WAS ASKED', 'TO STOP AND HE DID NOT STOP'],
      ['WE DO NOT', 'TALK ABOUT THE FOURTH QUARTER'],
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Posters                                                             */
/* ------------------------------------------------------------------ */

/** A drawn poster in the bar's own style. No likenesses, no fake quotes. */
function drawnPoster(cat, [top, bottom], index) {
  const W = 512, H = 640;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');

  g.fillStyle = `hsl(${cat.hue}, 46%, 22%)`;
  g.fillRect(0, 0, W, H);
  // print grain
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }

  // a big daft muppet head, drawn not photographed
  const cx = W / 2, cy = H / 2 + 20, r = 150;
  g.fillStyle = `hsl(${(cat.hue + 180) % 360}, 62%, 56%)`;
  g.beginPath(); g.ellipse(cx, cy, r, r * 1.05, 0, 0, 7); g.fill();
  // eyes
  for (const s of [-1, 1]) {
    g.fillStyle = '#fdfbf4';
    g.beginPath(); g.ellipse(cx + s * 58, cy - 46, 46, 52, 0, 0, 7); g.fill();
    g.fillStyle = '#0a090c';
    g.beginPath(); g.arc(cx + s * 58 + (index % 3 - 1) * 9, cy - 40, 19, 0, 7); g.fill();
  }
  // mouth
  g.fillStyle = '#4a1020';
  g.beginPath();
  g.ellipse(cx, cy + 66, 70, 34 + (index % 3) * 12, 0, 0, Math.PI);
  g.fill();
  // hair tufts
  g.strokeStyle = `hsl(${(cat.hue + 90) % 360}, 80%, 60%)`;
  g.lineWidth = 11;
  for (let i = -2; i <= 2; i++) {
    g.beginPath();
    g.moveTo(cx + i * 26, cy - r * 0.94);
    g.lineTo(cx + i * 34, cy - r * 1.3 - Math.abs(i) * 8);
    g.stroke();
  }

  // impact caption, top and bottom
  const caption = (text, y) => {
    g.font = '700 54px Impact, "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 8;
    g.strokeStyle = '#0c0a08';
    g.fillStyle = '#f6f2e4';
    const words = String(text).split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (g.measureText(test).width > W - 48 && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    lines.forEach((l, i) => {
      const yy = y + i * 52;
      g.strokeText(l, W / 2, yy);
      g.fillText(l, W / 2, yy);
    });
  };
  caption(top, 74);
  g.font = '700 40px Impact, "Barlow Condensed", sans-serif';
  caption(bottom, H - 96);

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Load the owner's own images for a category, if any have been dropped in. */
async function loadCustom(cat) {
  try {
    const res = await fetch(`/memes/${cat.id}/index.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const data = await res.json();
    const files = data.images ?? [];
    if (!files.length) return null;
    const textures = await Promise.all(files.map((f) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const t = new THREE.Texture(img);
        t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
        resolve(t);
      };
      img.onerror = () => resolve(null);
      img.src = `/memes/${cat.id}/${f}`;
    })));
    const usable = textures.filter(Boolean);
    return usable.length ? usable : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* The wall                                                            */
/* ------------------------------------------------------------------ */

export class MemeWall {
  constructor(opts) {
    this.group = new THREE.Group();
    this.group.position.copy(opts.origin);
    this.group.rotation.y = opts.rotationY ?? 0;
    this.dyn = [];
    this.category = 0;
    this.slide = 0;
    this.textures = new Map();       // categoryId -> texture[]
    this.custom = new Map();
    this.onChange = opts.onChange ?? (() => {});

    const W = opts.width ?? 4.6;
    const H = opts.height ?? 2.4;
    const baseY = opts.baseY ?? 0.95;
    this.size = { W, H, baseY };

    const board = new THREE.Mesh(
      new THREE.BoxGeometry(W, H, 0.06),
      std({ color: '#241d28', roughness: 0.8 }),
    );
    board.position.set(0, baseY + H / 2, -0.04);
    this.group.add(board);

    // the big frame
    const frameW = 1.7, frameH = 2.1;
    this.frameSize = { frameW, frameH };
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(frameW + 0.1, frameH + 0.1, 0.05),
      std({ color: '#c9a03a', roughness: 0.35, metalness: 0.75 }),
    );
    frame.position.set(0, baseY + H / 2, 0.0);
    this.group.add(frame);

    this.poster = new THREE.Mesh(
      new THREE.PlaneGeometry(frameW, frameH),
      std({ color: 0xffffff, roughness: 0.85 }),
    );
    this.poster.position.set(0, baseY + H / 2, 0.032);
    this.group.add(this.poster);

    // a backlight so the wall glows a bit in a dark bar
    this.glow = new THREE.PointLight(0xffd8a0, 2.2, 3.4, 2);
    this.glow.position.set(0, baseY + H / 2, 0.5);
    this.group.add(this.glow);

    /* category plaques, left and right of the frame */
    this.plaques = CATEGORIES.map((cat, i) => {
      const px = (i - 1) * 1.42;
      const plaque = new THREE.Mesh(
        new THREE.PlaneGeometry(1.2, 0.34),
        std({ map: this._plaqueTexture(cat, false), roughness: 0.7 }),
      );
      plaque.position.set(px, baseY + 0.24, 0.04);
      this.group.add(plaque);
      return { cat, plaque };
    });

    this._label = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.3),
      std({ map: this._captionTexture('LOADING'), roughness: 0.9, transparent: true }),
    );
    this._label.position.set(0, baseY + H - 0.18, 0.04);
    this.group.add(this._label);

    this.dyn.push({
      update: (t) => {
        this.glow.intensity = 2.0 + Math.sin(t * 2.3) * 0.25;
      },
    });

    this._ready = this.select(0);
  }

  _plaqueTexture(cat, on) {
    const W = 512, H = 144;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = on ? `hsl(${cat.hue},70%,46%)` : '#17141a';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = on ? '#fff6d8' : `hsl(${cat.hue},60%,42%)`;
    g.lineWidth = 6;
    g.strokeRect(6, 6, W - 12, H - 12);
    g.fillStyle = on ? '#1a1208' : '#e8e2d2';
    g.textAlign = 'center';
    g.font = '700 58px "Barlow Condensed", Impact, sans-serif';
    g.fillText(cat.label, W / 2, 72);
    g.font = '400 26px "Barlow Condensed", Impact, sans-serif';
    g.fillText(cat.sub, W / 2, 112);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  _captionTexture(text) {
    const W = 1024, H = 128;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#f2e6c8';
    g.textAlign = 'center';
    g.font = '700 60px "Barlow Condensed", Impact, sans-serif';
    g.fillText(String(text), W / 2, 82);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  async _texturesFor(cat) {
    if (this.textures.has(cat.id)) return this.textures.get(cat.id);
    const custom = await loadCustom(cat);
    const list = custom ?? cat.posters.map((p, i) => drawnPoster(cat, p, i));
    this.custom.set(cat.id, !!custom);
    this.textures.set(cat.id, list);
    return list;
  }

  async select(index) {
    this.category = ((index % CATEGORIES.length) + CATEGORIES.length) % CATEGORIES.length;
    this.slide = 0;
    const cat = CATEGORIES[this.category];
    this.plaques.forEach(({ cat: c, plaque }, i) => {
      plaque.material.map?.dispose();
      plaque.material.map = this._plaqueTexture(c, i === this.category);
      plaque.material.needsUpdate = true;
    });
    const list = await this._texturesFor(cat);
    this._show(list[0]);
    this._setLabel(cat);
    this.onChange(this.status());
  }

  next(step = 1) {
    const cat = CATEGORIES[this.category];
    const list = this.textures.get(cat.id) ?? [];
    if (!list.length) return;
    this.slide = ((this.slide + step) % list.length + list.length) % list.length;
    this._show(list[this.slide]);
    this._setLabel(cat);
    this.onChange(this.status());
  }

  cycleCategory() { this.select(this.category + 1); }

  _show(tex) {
    if (!tex) return;
    this.poster.material.map = tex;
    this.poster.material.needsUpdate = true;
    // keep the aspect honest rather than stretching someone's image
    const img = tex.image;
    if (img && img.width && img.height) {
      const { frameW, frameH } = this.frameSize;
      const scale = Math.min(frameW / img.width, frameH / img.height);
      this.poster.scale.set((img.width * scale) / frameW, (img.height * scale) / frameH, 1);
    } else {
      this.poster.scale.set(1, 1, 1);
    }
  }

  _setLabel(cat) {
    const list = this.textures.get(cat.id) ?? [];
    const own = this.custom.get(cat.id) ? '' : ' · HOUSE ARTWORK';
    this._label.material.map?.dispose();
    this._label.material.map = this._captionTexture(
      `${cat.label} — ${this.slide + 1}/${list.length}${own}`,
    );
    this._label.material.needsUpdate = true;
  }

  status() {
    const cat = CATEGORIES[this.category];
    const list = this.textures.get(cat.id) ?? [];
    return {
      category: cat.label,
      sub: cat.sub,
      slide: this.slide + 1,
      total: list.length,
      custom: !!this.custom.get(cat.id),
    };
  }
}

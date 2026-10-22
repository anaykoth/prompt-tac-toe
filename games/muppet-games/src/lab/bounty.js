import * as THREE from 'three';

/**
 * The wanted wall.
 *
 * Real public data, pulled fresh: the FBI's Ten Most Wanted Fugitives, and
 * INTERPOL's public red notices where they are reachable. Names, charges,
 * rewards and photos are reproduced exactly as the agencies publish them —
 * nothing about a listed person is invented, and if a feed is down the wall
 * says so rather than filling the gap. The lunacy is entirely in the framing:
 * the muppets have made it into a shrine, with candles, red string and their
 * own annotations, and the annotations are about the shrine, never about the
 * people on it.
 */

const FBI_URL = '/api/fbi?poster_classification=ten&pageSize=20';
const INTERPOL_URL = '/api/interpol?resultPerPage=12';
const IMG = (u) => `/api/img?u=${encodeURIComponent(u)}`;

const CACHE_KEY = 'fuzz-and-feather:wanted';
const CACHE_MS = 6 * 60 * 60 * 1000;      // the list does not change hourly

/** Muppet marginalia. Never a claim about anyone on the wall. */
const SCRAWLS = [
  'MY FAVOURITE', 'DO NOT TOUCH THE CANDLES', 'I WOULD SPLIT THE REWARD',
  'GERALD IS OBSESSED WITH THIS ONE', 'NUMBER ONE IN OUR HEARTS',
  'WE RING THE BELL WHEN THE LIST CHANGES', 'PLEASE STOP ADDING GLITTER',
  'THE LANDLORD SAYS THIS IS NOT A HOBBY',
];

const clean = (s, max = 240) => {
  if (!s) return '';
  const t = String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

async function fetchFbi() {
  const res = await fetch(FBI_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`FBI ${res.status}`);
  const data = await res.json();
  return (data.items ?? []).map((it) => {
    const img = (it.images ?? [])[0];
    return {
      source: 'FBI',
      name: clean(it.title, 60) || 'NAME WITHHELD',
      // the charges as published, not a summary of our own
      charges: clean(it.description) || clean((it.caution || '').split('.')[0]) || 'SEE NOTICE',
      caution: clean(it.caution, 320),
      reward: clean(it.reward_text, 160),
      nationality: clean(it.nationality, 40),
      url: it.url,
      image: img ? IMG(img.large || img.original || img.thumb) : null,
    };
  });
}

async function fetchInterpol(want = 4) {
  const res = await fetch(INTERPOL_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`INTERPOL ${res.status}`);
  const data = await res.json();
  const notices = (data?._embedded?.notices ?? []).slice(0, want);

  /* The list endpoint does not carry the charges — those live on each notice —
     so the few we actually display get fetched properly rather than shown with
     a vague stand-in. */
  return Promise.all(notices.map(async (n) => {
    let charges = '';
    try {
      const href = n._links?.self?.href;
      if (href) {
        const path = new URL(href).pathname.replace(/^\/notices\/v1\/red/, '');
        const detail = await fetch(`/api/interpol${path}`, { headers: { accept: 'application/json' } });
        if (detail.ok) {
          const d = await detail.json();
          charges = clean((d.arrest_warrants ?? []).map((w) => w.charge).filter(Boolean).join('; '));
        }
      }
    } catch { /* the notice still goes up, just without the charge text */ }

    return {
      source: 'INTERPOL',
      name: clean([n.forename, n.name].filter(Boolean).join(' '), 60) || 'NAME WITHHELD',
      charges: charges || 'RED NOTICE — CHARGES PUBLISHED BY THE REQUESTING COUNTRY',
      caution: '',
      reward: '',
      nationality: clean((n.nationalities ?? []).join(', '), 40),
      url: n._links?.self?.href,
      image: n._links?.thumbnail?.href ? IMG(n._links.thumbnail.href) : null,
    };
  }));
}

/**
 * The ranked wall. FBI first because their list is genuinely ranked as a top
 * ten; INTERPOL red notices fill any remaining slots.
 * @returns {{entries: object[], sources: object}}
 */
export async function fetchMostWanted({ cache = true } = {}) {
  if (cache) {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const c = JSON.parse(raw);
        if (Date.now() - c.at < CACHE_MS && c.entries?.length) return c;
      }
    } catch { /* fall through */ }
  }

  const sources = {};
  const [fbi, interpol] = await Promise.allSettled([fetchFbi(), fetchInterpol(4)]);

  const fbiList = fbi.status === 'fulfilled' ? fbi.value : [];
  const intList = interpol.status === 'fulfilled' ? interpol.value : [];
  sources.FBI = fbi.status === 'fulfilled'
    ? { ok: true, count: fbiList.length }
    : { ok: false, why: String(fbi.reason?.message ?? fbi.reason) };
  sources.INTERPOL = interpol.status === 'fulfilled'
    ? { ok: true, count: intList.length }
    : { ok: false, why: String(interpol.reason?.message ?? interpol.reason) };

  /* Six from the FBI's actual top ten and four red notices, so both agencies
     are on the wall; if one feed is down the other fills the board rather than
     leaving gaps. */
  let entries = [...fbiList.slice(0, 6), ...intList.slice(0, 4)];
  if (entries.length < 10) {
    entries = entries.concat(fbiList.slice(6), intList.slice(4)).slice(0, 10);
  }
  entries = entries.slice(0, 10).map((e, i) => ({ ...e, rank: i + 1 }));
  const payload = { entries, sources, at: Date.now() };
  if (cache && entries.length) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(payload)); } catch { /* ignore */ }
  }
  return payload;
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrapText(g, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text).split(' ');
  let line = '';
  let lines = 0;
  for (let i = 0; i < words.length && lines < maxLines; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (g.measureText(test).width > maxWidth && line) {
      g.fillText(line, x, y + lines * lineHeight);
      lines++;
      line = words[i];
    } else {
      line = test;
    }
  }
  if (line && lines < maxLines) g.fillText(line, x, y + lines * lineHeight);
  return lines + 1;
}

/** One tacked-up poster: photo, rank, name, and the charges as published. */
async function cardTexture(entry) {
  const W = 384, H = 540;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');

  // yellowed paper
  g.fillStyle = '#e8dcc0';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = `rgba(120,96,58,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  g.strokeStyle = '#2b2116';
  g.lineWidth = 4;
  g.strokeRect(10, 10, W - 20, H - 20);

  g.fillStyle = '#8c1b16';
  g.fillRect(10, 10, W - 20, 54);
  g.fillStyle = '#f4ead2';
  g.font = '700 34px "Barlow Condensed", Impact, sans-serif';
  g.textAlign = 'left';
  g.fillText('WANTED', 24, 50);
  g.textAlign = 'right';
  g.font = '700 26px "Barlow Condensed", Impact, sans-serif';
  g.fillText(entry.source, W - 24, 48);

  // rank badge
  g.fillStyle = '#2b2116';
  g.beginPath(); g.arc(W - 44, 96, 26, 0, 7); g.fill();
  g.fillStyle = '#f2c736';
  g.font = '700 30px "Barlow Condensed", Impact, sans-serif';
  g.textAlign = 'center';
  g.fillText(String(entry.rank), W - 44, 106);

  // photo
  const img = await loadImage(entry.image);
  const px = 26, py = 78, pw = 250, ph = 250;
  g.fillStyle = '#c3b795';
  g.fillRect(px, py, pw, ph);
  if (img) {
    // cover-fit so faces are not squashed
    const scale = Math.max(pw / img.width, ph / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    g.save();
    g.beginPath(); g.rect(px, py, pw, ph); g.clip();
    g.drawImage(img, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh);
    g.restore();
  } else {
    g.fillStyle = '#8d8168';
    g.font = '400 18px "Barlow Condensed", Impact, sans-serif';
    g.textAlign = 'center';
    g.fillText('NO PHOTOGRAPH', px + pw / 2, py + ph / 2);
  }
  g.strokeStyle = '#2b2116';
  g.lineWidth = 3;
  g.strokeRect(px, py, pw, ph);

  // name
  g.fillStyle = '#1f1810';
  g.textAlign = 'left';
  g.font = '700 30px "Barlow Condensed", Impact, sans-serif';
  const nameLines = wrapText(g, entry.name.toUpperCase(), 26, 368, W - 52, 30, 2);

  let y = 368 + nameLines * 30 + 6;
  if (entry.nationality) {
    g.fillStyle = '#5a4a30';
    g.font = '400 18px "Barlow Condensed", Impact, sans-serif';
    g.fillText(entry.nationality.toUpperCase(), 26, y);
    y += 22;
  }

  /* The reward gets a fixed strip along the bottom and the charges get whatever
     is left above it — otherwise a long charge list runs straight through the
     reward line and neither can be read. */
  const footerTop = entry.reward ? H - 74 : H - 18;
  const room = Math.max(1, Math.floor((footerTop - y - 6) / 21));

  g.fillStyle = '#3a2c1c';
  g.font = '400 19px "Barlow Condensed", Impact, sans-serif';
  wrapText(g, entry.charges, 26, y, W - 52, 21, room);

  if (entry.reward) {
    g.fillStyle = 'rgba(140,27,22,0.10)';
    g.fillRect(14, footerTop - 20, W - 28, 62);
    g.fillStyle = '#8c1b16';
    g.font = '700 18px "Barlow Condensed", Impact, sans-serif';
    wrapText(g, entry.reward, 26, footerTop, W - 52, 19, 3);
  }

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Shown when a feed will not answer — never replaced with made-up entries. */
function outageTexture(sources) {
  const W = 384, H = 540;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#1d1a16';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#6b5a3a';
  g.lineWidth = 4;
  g.strokeRect(10, 10, W - 20, H - 20);
  g.fillStyle = '#e8dcc0';
  g.textAlign = 'center';
  g.font = '700 40px "Barlow Condensed", Impact, sans-serif';
  g.fillText('THE WIRE', W / 2, 90);
  g.fillText('IS DOWN', W / 2, 132);
  g.font = '400 20px "Barlow Condensed", Impact, sans-serif';
  g.fillStyle = '#a2937a';
  let y = 210;
  for (const [name, s] of Object.entries(sources)) {
    g.fillText(`${name}: ${s.ok ? `${s.count} NOTICES` : 'NO ANSWER'}`, W / 2, y);
    y += 30;
  }
  g.font = '400 17px "Barlow Condensed", Impact, sans-serif';
  wrapText(g, 'The muppets refuse to put anything on this wall that did not come off the wire.',
    36, y + 24, W - 72, 22, 5);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function scrawlTexture(text) {
  const W = 256, H = 96;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#f2e9cf';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#8c1b16';
  g.textAlign = 'center';
  g.font = '700 26px "Barlow Condensed", Impact, sans-serif';
  wrapText(g, text, W / 2, 40, W - 20, 28, 2);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */
/* The wall                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build the shrine at a wall. `opts.origin` is the centre of the wall panel,
 * `opts.normal` is the direction it faces (unit, in XZ).
 */
export async function buildBountyWall(opts) {
  const group = new THREE.Group();
  const dyn = [];
  const { entries, sources } = await fetchMostWanted().catch(() => ({ entries: [], sources: {} }));

  const std = (o) => new THREE.MeshStandardMaterial(o);
  const W = opts.width ?? 5.2;
  const H = opts.height ?? 2.5;
  const baseY = opts.baseY ?? 0.95;

  /* backing board: chipboard, nailed over the wall by someone unwell */
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(W, H, 0.05),
    std({ color: '#4a3826', roughness: 0.85 }),
  );
  board.position.set(0, baseY + H / 2, -0.03);
  group.add(board);

  const header = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 0.8, 0.34),
    std({ map: (() => {
      const cv = document.createElement('canvas');
      cv.width = 1024; cv.height = 128;
      const g = cv.getContext('2d');
      g.fillStyle = '#12100c'; g.fillRect(0, 0, 1024, 128);
      g.fillStyle = '#f2c736';
      g.textAlign = 'center';
      g.font = '700 76px "Barlow Condensed", Impact, sans-serif';
      g.fillText('THE TEN MOST WANTED', 512, 92);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })(), roughness: 0.9 }),
  );
  header.position.set(0, baseY + H - 0.22, 0.002);
  group.add(header);

  /* the cards, in two rows of five */
  const CARD_W = 0.62, CARD_H = 0.87;
  const cols = 5;
  const rows = 2;
  const gapX = (W - cols * CARD_W) / (cols + 1);
  const pins = [];
  const list = entries.length ? entries : [null];

  for (let i = 0; i < Math.max(list.length, entries.length ? entries.length : 1); i++) {
    const entry = entries[i] ?? null;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = -W / 2 + gapX + CARD_W / 2 + col * (CARD_W + gapX);
    const y = baseY + H - 0.52 - CARD_H / 2 - row * (CARD_H + 0.14);
    if (row >= rows) break;

    const tex = entry ? await cardTexture(entry) : outageTexture(sources);
    const card = new THREE.Mesh(
      new THREE.PlaneGeometry(CARD_W, CARD_H),
      std({ map: tex, roughness: 0.92 }),
    );
    card.position.set(x, y, 0.006 + row * 0.001);
    card.rotation.z = (Math.random() - 0.5) * 0.07;   // nobody hung these straight
    card.userData.entry = entry;
    group.add(card);

    const pin = new THREE.Mesh(
      new THREE.SphereGeometry(0.011, 8, 6),
      std({ color: ['#d8342c', '#f2c736', '#3d7fd8'][i % 3], roughness: 0.3 }),
    );
    pin.position.set(x, y + CARD_H / 2 - 0.03, 0.016);
    group.add(pin);
    pins.push(pin.position.clone());
  }

  /* red string between the pins, because of course there is red string */
  if (pins.length > 1) {
    const pts = [];
    const order = [...pins.keys()].sort((a, b) => (a % 2) - (b % 2) || a - b);
    for (const i of order) pts.push(pins[i].clone().add(new THREE.Vector3(0, 0, 0.004)));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xc0281f }),
    );
    group.add(line);
  }

  /* scrawled notes taped around the edges */
  for (let i = 0; i < 4; i++) {
    const note = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.13),
      std({ map: scrawlTexture(SCRAWLS[(i * 3) % SCRAWLS.length]), roughness: 0.95 }),
    );
    const side = i % 2 ? 1 : -1;
    note.position.set(side * (W / 2 - 0.24), baseY + 0.28 + i * 0.16, 0.02);
    note.rotation.z = (Math.random() - 0.5) * 0.3;
    group.add(note);
  }

  /* a shelf of candles under the board */
  const shelf = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.7, 0.05, 0.18),
    std({ color: '#3d2b1c', roughness: 0.8 }),
  );
  shelf.position.set(0, baseY - 0.06, 0.09);
  group.add(shelf);

  const flames = [];
  for (let i = 0; i < 9; i++) {
    const x = -W * 0.3 + i * (W * 0.6 / 8);
    const h = 0.09 + Math.random() * 0.09;
    const wax = new THREE.Mesh(
      new THREE.CylinderGeometry(0.021, 0.023, h, 10),
      std({ color: ['#e8e2d2', '#d8c0a8', '#c8d8d0'][i % 3], roughness: 0.75 }),
    );
    wax.position.set(x, baseY - 0.035 + h / 2, 0.09);
    group.add(wax);

    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.011, 0.032, 6),
      new THREE.MeshBasicMaterial({ color: 0xffb44a, transparent: true, opacity: 0.9 }),
    );
    flame.position.set(x, baseY - 0.035 + h + 0.02, 0.09);
    group.add(flame);

    const light = new THREE.PointLight(0xffa02a, 0.16, 0.9, 2);
    light.position.set(x, baseY - 0.035 + h + 0.05, 0.13);
    group.add(light);
    flames.push({ flame, light, phase: Math.random() * 9, base: 0.16 });
  }

  dyn.push({
    update(t) {
      for (const f of flames) {
        const flick = 0.75 + Math.sin(t * 11 + f.phase) * 0.15 + Math.sin(t * 23 + f.phase * 2) * 0.1;
        f.flame.scale.set(1, flick, 1);
        f.light.intensity = f.base * flick;
      }
    },
  });

  /* plastic flowers, because a shrine needs plastic flowers */
  for (let i = 0; i < 6; i++) {
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.004, 0.16, 5),
      std({ color: '#2f6b32', roughness: 0.9 }),
    );
    const x = -W * 0.32 + i * (W * 0.64 / 5) + (Math.random() - 0.5) * 0.06;
    stem.position.set(x, baseY + 0.06, 0.14);
    stem.rotation.z = (Math.random() - 0.5) * 0.5;
    group.add(stem);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 8, 6),
      std({ color: ['#e04f8a', '#f2c736', '#d84f4f'][i % 3], roughness: 0.8 }),
    );
    head.scale.set(1, 0.55, 1);
    head.position.set(x + Math.sin(stem.rotation.z) * -0.08, baseY + 0.14, 0.14);
    group.add(head);
  }

  // face the wall the right way
  group.position.copy(opts.origin);
  group.rotation.y = opts.rotationY ?? 0;

  return { group, dyn, entries, sources };
}

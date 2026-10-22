/**
 * Billiard simulation.
 *
 * Deliberately free of three.js: it has to run headless (tests today, an
 * authoritative server once this goes online) and it has to be deterministic —
 * same shot parameters plus same seed must produce the same table, on every
 * machine, so netplay can ship a 6-float shot instead of 16 ball states.
 *
 * Model: each ball carries linear velocity and a full 3D angular velocity.
 * Cloth friction switches between sliding and rolling by looking at the
 * velocity of the material point at the contact patch, which is what makes
 * draw, follow, stun and swerve fall out for free rather than being faked.
 */

export const BALL_R = 0.028575;          // 57.15 mm ball
export const BALL_M = 0.17;
export const G = 9.806;

/* 7-foot bar box, nose-to-nose playing surface. */
export const TABLE = {
  halfLen: 0.9906,
  halfWid: 0.4953,
  height: 0.78,                          // cloth height above the bar floor
  /* Pocket spec, in the terms a table mechanic would use. The mouth is the gap
     between the two cushion noses; the facings are the angled cuts either side
     of it; the shelf is how far past the mouth a ball must travel before it
     actually drops. The shelf is the reason a ball can rattle in the jaws and
     come back out, which a plain capture circle can never reproduce. */
  cornerMouth: 0.117,                    // 4.6" between the cushion noses
  sideMouth: 0.133,                      // 5.25" — sides are always cut wider
  /* Shelf: how far past the mouth the centre travels before the slate opens.
     Corner pockets have a real shelf (1"-2.25"); side pockets have almost none,
     which is exactly why a ball can hang in a corner and never in a side. */
  cornerShelf: 0.041,                    // 1.6"
  sideShelf: 0.009,                      // 0.35"
  /* Width of the opening cut in the slate behind the mouth. Together with the
     mouth and the shelf this fixes the facing angles, rather than quoting an
     angle whose reference line I would only be half sure of. */
  cornerBack: 0.150,
  sideBack: 0.150,
  facingRestitution: 0.55,               // leather-backed, deader than cushion

  /* Cushion and rail, in the terms a table fitter uses. The nose height is the
     important one: the ball must strike at 62.5-64.5% of its own diameter, and
     the sim already assumes that via CFG.railNose, so the visible rubber has to
     be built to the same figure or the picture lies about the physics. */
  noseHeight: 0.0363,                    // 63.5% of a 57.15 mm ball
  cushionTop: 0.0415,
  cushionDepth: 0.044,                   // rubber, nose to sub-rail
  /* Wide, at 6.6". The binding constraint is the side pocket: its shelf is
     almost nothing, so the rail is the only depth a 150 mm opening has to fit
     into, and at 4.5" there was only room for a 103 mm hole there — which left
     the sides visibly smaller than the corners. Still inside the 4"-7.5" the
     spec allows, and bar tables do carry heavy rails. */
  railWidth: 0.170,                      // nose to the outside of the rail cap
  railTop: 0.041,                        // rail cap surface above the cloth
  slate: 0.019,                          // 3/4" slate
};

/* Cloth + collision constants. Bar cloth is slow, dirty and slightly sticky. */
export const CFG = {
  muSlide: 0.20,       // ball sliding on cloth
  /* Rolling resistance. Measured values for pool cloth sit between 0.005 and
     0.015 (a deceleration of roughly 0.05-0.15 m/s²); this is the dirty end of
     that range, for a bar table nobody has brushed. Anything much above it and
     a ball will not cross the table, which is wrong however "slow" the cloth is
     meant to feel — slowness belongs in the stroke, not in glue on the slate. */
  muRoll: 0.014,
  facingScale: 0.66,   // pocket facings vs cushion rubber
  dropDepth: 0.35,     // fraction of the shelf the centre must cross to drop
  /* Spin is the point of the game, so it is allowed to live: english decays
     slowly, the cushions bite it properly, and ball-ball contact throws. */
  muSpin: 0.014,       // vertical-axis spin decay
  eBall: 0.95,
  eRail: 0.82,
  eCloth: 0.45,        // airborne ball landing
  muBall: 0.075,       // ball-ball tangential (throw)
  muRail: 0.21,
  railNose: 0.27,      // rail contact height above ball centre, in radii
  stopV: 0.012,        // below this, a ball is asleep
  stopW: 0.35,
  maxStepDist: 0.12,   // substep size cap, in radii of travel
};

const I_FACTOR = 2 / 5;                  // solid sphere
const FLAT = { h: 0, gx: 0, gz: 0 };     // the bed, unless a design says otherwise

/* ------------------------------------------------------------------ */
/* Deterministic RNG — chaos has to replay identically on both clients */
/* ------------------------------------------------------------------ */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Table geometry: cushion segments, jaws, pockets                     */
/* ------------------------------------------------------------------ */

/**
 * Build one pocket from its mouth.
 *
 * Shared by every table design, so a hexagon or a nonsense polygon gets pockets
 * that rattle and drop exactly like the bar box's. `ox, oz` is any vector
 * pointing out of the table at this mouth — it only fixes which way is "out".
 */
export function makePocket({ ax, az, bx, bz, ox, oz, kind = 'corner', id = 0,
  t = TABLE, facings = [] }) {
  const ex0 = bx - ax, ez0 = bz - az;
  const len = Math.hypot(ex0, ez0);
  const ex = ex0 / len, ez = ez0 / len;
  // outward normal: away from the table centre
  let nx = -ez, nz = ex;
  if (nx * ox + nz * oz < 0) { nx = -nx; nz = -nz; }

  const shelf = kind === 'corner' ? t.cornerShelf : t.sideShelf;
  const back = kind === 'corner' ? t.cornerBack : t.sideBack;
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const dropX = mx + nx * shelf, dropZ = mz + nz * shelf;
  const dropR = back / 2;

  /* Each facing runs from its cushion tip to the corresponding corner of the
     slate opening, so the flare of the pocket is a consequence of the mouth,
     the shelf and the opening rather than a number picked to look right. */
  const backA = { x: dropX - ex * dropR, z: dropZ - ez * dropR };
  const backB = { x: dropX + ex * dropR, z: dropZ + ez * dropR };

  const facing = (tx, tz, px, pz) => {
    const dx = px - tx, dz = pz - tz;
    const l = Math.hypot(dx, dz) || 1;
    let fnx = -dz / l, fnz = dx / l;
    // the normal must point into the funnel, i.e. towards the drop centre
    if (fnx * (dropX - tx) + fnz * (dropZ - tz) < 0) { fnx = -fnx; fnz = -fnz; }
    facings.push({ ax: tx, az: tz, bx: px, bz: pz, nx: fnx, nz: fnz, pocket: id, len: l });
  };
  facing(ax, az, backA.x, backA.z);
  facing(bx, bz, backB.x, backB.z);

  // the cut of the facing away from the cushion line, for reference
  const flare = Math.atan2((back - len) / 2, shelf);

  return {
    ax, az, bx, bz, nx, nz, ex, ez, len, kind, id, shelf, back, flare,
    backA, backB,
    dropX, dropZ, dropR,
    // where the ball disappears — also the hole in the slate, for rendering
    x: dropX, z: dropZ, r: dropR,
  };
}


/**
 * Finish a set of cushions and pockets into a full geometry.
 *
 * Rounds every cushion end into a jaw, works out which way the rubber runs
 * behind each facing, and which way is "outside" at each mouth tip. Every table
 * design needs exactly this, and getting any of it wrong produces bugs that
 * only show up as balls leaking out of the table or facings sprawling across a
 * pocket mouth — so it lives in one place.
 */
export function finishGeometry(cushions, pockets, facings, jawR = 0.010) {
  const jaws = [];
  for (const c of cushions) {
    jaws.push({ x: c.ax - c.nx * jawR, z: c.az - c.nz * jawR, r: jawR });
    jaws.push({ x: c.bx - c.nx * jawR, z: c.bz - c.nz * jawR, r: jawR });
  }

  const cushionAt = (x, z) => {
    for (const c of cushions) {
      for (const [ex, ez, ox, oz] of [[c.ax, c.az, c.bx, c.bz], [c.bx, c.bz, c.ax, c.az]]) {
        if (Math.hypot(ex - x, ez - z) < 1e-9) {
          const dx = ox - ex, dz = oz - ez;
          const l = Math.hypot(dx, dz) || 1;
          return { alongX: dx / l, alongZ: dz / l, outX: -c.nx, outZ: -c.nz };
        }
      }
    }
    return null;
  };

  for (const f of facings) {
    const c = cushionAt(f.ax, f.az);
    f.awayX = c ? c.alongX : -f.nx;
    f.awayZ = c ? c.alongZ : -f.nz;
  }
  for (const p of pockets) {
    const a = cushionAt(p.ax, p.az);
    const b = cushionAt(p.bx, p.bz);
    p.aOut = a ? { x: a.outX, z: a.outZ } : { x: p.nx, z: p.nz };
    p.bOut = b ? { x: b.outX, z: b.outZ } : { x: p.nx, z: p.nz };
  }

  return { cushions, jaws, pockets, facings };
}

/**
 * Cushions are line segments rather than infinite walls so that the pocket
 * mouths are genuinely open — a ball can only drop where the cloth actually
 * ends. The segment endpoints become "jaws": little circular obstacles that
 * make balls rattle in the jaws exactly like the real thing.
 */
export function buildTableGeometry(t = TABLE) {
  const L = t.halfLen, W = t.halfWid;
  const cg = t.cornerMouth / Math.SQRT2;   // cushion gap either side of a corner
  const sg = t.sideMouth / 2;              // half the side pocket mouth

  const cushions = [];
  const seg = (ax, az, bx, bz, nx, nz) => cushions.push({ ax, az, bx, bz, nx, nz });

  // head and foot rails (short) — normals point along -x / +x into the table
  seg(-L, -W + cg, -L, W - cg, 1, 0);
  seg(L, -W + cg, L, W - cg, -1, 0);
  // long rails, split by the side pockets
  seg(-L + cg, -W, -sg, -W, 0, 1);
  seg(sg, -W, L - cg, -W, 0, 1);
  seg(-L + cg, W, -sg, W, 0, -1);
  seg(sg, W, L - cg, W, 0, -1);

  /* The pocket facings. Each sits tangent to the cushion nose — pushed back
     behind the nose line by its own radius — so that a ball rolling along the
     cushion just grazes past it instead of being kicked off the rail, while a
     ball arriving at an angle still rattles in the jaws. */
  const jaws = [];
  const jr = 0.010;
  for (const c of cushions) {
    jaws.push({ x: c.ax - c.nx * jr, z: c.az - c.nz * jr, r: jr });
    jaws.push({ x: c.bx - c.nx * jr, z: c.bz - c.nz * jr, r: jr });
  }

  /* A pocket is a mouth, two angled facings and a shelf — not a capture circle.
     The mouth is the line between the cushion tips; the facings funnel back
     from those tips to the drop; the ball is only down once it has crossed most
     of the shelf. A ball arriving at a shallow angle hits a facing and comes
     back out, which is exactly the rattle a real table gives you, and the
     funnel is closed so nothing can thread through and leave the table. */
  const facings = [];
  const mouth = (ax, az, bx, bz, ox, oz, kind, id) =>
    makePocket({ ax, az, bx, bz, ox, oz, kind, id, t, facings });

  const pockets = [
    mouth(-L, -W + cg, -L + cg, -W, -1, -1, 'corner', 0),
    mouth(-L, W - cg, -L + cg, W, -1, 1, 'corner', 1),
    mouth(-sg, -W, sg, -W, 0, -1, 'side', 2),
    mouth(-sg, W, sg, W, 0, 1, 'side', 3),
    mouth(L, -W + cg, L - cg, -W, 1, -1, 'corner', 4),
    mouth(L, W - cg, L - cg, W, 1, 1, 'corner', 5),
  ];

  /** The cushion a given point sits on the end of, if any. */
  const cushionAt = (x, z) => {
    for (const c of cushions) {
      for (const [ex, ez, ox, oz] of [[c.ax, c.az, c.bx, c.bz], [c.bx, c.bz, c.ax, c.az]]) {
        if (Math.hypot(ex - x, ez - z) < 1e-9) {
          const dx = ox - ex, dz = oz - ez;
          const l = Math.hypot(dx, dz) || 1;
          // along: into the cushion; out: away from the table, behind the rubber
          return { alongX: dx / l, alongZ: dz / l, outX: -c.nx, outZ: -c.nz };
        }
      }
    }
    return null;
  };

  /* Which way the cushion runs behind each facing. A facing is the cut end of a
     cushion, so anything given to it thickness has to grow along that cushion,
     away from the pocket. Growing it along the facing's own normal instead
     pushes it sideways across the mouth, because on a side pocket the facing is
     nearly perpendicular to the rail and its normal nearly parallel to it. */
  for (const f of facings) {
    const c = cushionAt(f.ax, f.az);
    f.awayX = c ? c.alongX : -f.nx;
    f.awayZ = c ? c.alongZ : -f.nz;
  }

  /* And which way is "behind the rubber" at each mouth tip, so the rail can be
     built starting where the cushion stops instead of sharing a plane with it. */
  for (const p of pockets) {
    const a = cushionAt(p.ax, p.az);
    const b = cushionAt(p.bx, p.bz);
    p.aOut = a ? { x: a.outX, z: a.outZ } : { x: p.nx, z: p.nz };
    p.bOut = b ? { x: b.outX, z: b.outZ } : { x: p.nx, z: p.nz };
  }

  return { cushions, jaws, pockets, facings };
}

/**
 * The table in plan, as closed polygons.
 *
 * Walks the boundary of the playing area once: along each cushion nose, then
 * out around each pocket throat and across the mouth of the slate opening. That
 * single loop is everything the presentation layer needs — the cloth is this
 * outline with the openings cut out of it, and the rail is a rectangle with
 * this outline cut out of it, so the wood is one continuous piece and the cloth
 * can never overlap a hole or a hole overlap the felt.
 *
 * @returns {{railInner: {x,z}[], openings: {x,z}[][]}}
 */
export function tableOutline(geo, railInset = TABLE.cushionDepth - 0.003) {
  /* Which tip the walk arrives at, going anticlockwise from the left rail. The
     order is fixed by how the pockets are constructed above. */
  const WALK = [
    { id: 0, from: 'A' }, { id: 2, from: 'A' }, { id: 4, from: 'B' },
    { id: 5, from: 'A' }, { id: 3, from: 'B' }, { id: 1, from: 'B' },
  ];

  /* One hole size for the whole table. The pockets have very different room
     behind them — a corner runs out on the diagonal, a side has only the width
     of the rail — so the shared radius is whatever the tightest of them can
     take. Sizing each pocket to its own limit is what left the sides visibly
     smaller than the corners. */
  let holeR = Infinity;
  for (const q of geo.pockets) {
    const cap = q.shelf * CFG.dropDepth;
    const space = q.kind === 'corner'
      ? TABLE.railWidth * Math.SQRT2 + q.len / 2      // corners run on the diagonal
      : TABLE.railWidth;
    holeR = Math.min(holeR, (space - 0.009 - cap) / 2);
  }
  holeR = Math.min(holeR, TABLE.cornerBack / 2);

  const railInner = [];      // the playing region: throats AND slate openings
  const railEdge = [];       // where the woodwork actually starts, behind the rubber
  const clothEdge = [];      // cloth's edge: throats, stopping at the openings
  /* Indexed by pocket id, not by the order the walk happens to visit them.
     They are not the same order, and anything that looked one up by pocket
     index was quietly getting a different pocket's hole. */
  const openings = [];
  const holes = [];          // {x, z, r} per pocket — the single source for the hole

  for (const { id, from } of WALK) {
    const p = geo.pockets.find((q) => q.id === id);
    const fromA = from === 'A';
    const inTip = fromA ? { x: p.ax, z: p.az } : { x: p.bx, z: p.bz };
    const outTip = fromA ? { x: p.bx, z: p.bz } : { x: p.ax, z: p.az };
    const inBack = fromA ? p.backA : p.backB;
    const outBack = fromA ? p.backB : p.backA;

    /* The slate opening is a circle, because a pocket is cut with a router.
       The two facing ends already sit exactly one drop-radius either side of the
       drop centre, so a true arc of that radius passes through both of them and
       the hole comes out round — a sine bulge across the same two points is a
       flat lens and reads as an oval. Only the outward half is swept: the
       inward half is where the shelf is. */
    /* The hole is one true circle, and everything else is hung off it: the cut
       in the cloth, the throat, the rail's edge and the net all read from the
       same centre and radius, so nothing inside the pocket can disagree with
       the shape of the pocket. Two blended arcs gave a 150 x 102 oval with a
       round net sitting 24 mm off its centre, which is what stopped it looking
       like a cut-out at all.

       Near edge on the capture line, so the hole you see is the hole that takes
       the ball; radius as large as will fit before it would break out through
       the outside of the rail, which on a side pocket is the binding limit. */
    const capture = p.shelf * CFG.dropDepth;
    const r = holeR;
    const mx = (p.ax + p.bx) / 2, mz = (p.az + p.bz) / 2;
    const cx = mx + p.nx * (capture + r);
    const cz = mz + p.nz * (capture + r);
    holes[p.id] = { x: cx, z: cz, r };

    const STEPS = 30;
    const circle = [];
    for (let i = 0; i < STEPS; i++) {
      const a = (i / STEPS) * Math.PI * 2;
      circle.push({
        x: cx + p.ex * r * Math.cos(a) + p.nx * r * Math.sin(a),
        z: cz + p.ez * r * Math.cos(a) + p.nz * r * Math.sin(a),
      });
    }
    openings[p.id] = circle;

    // the half of it facing away from the table, for the rail to wrap around
    const outer = [];
    const HALF = 16;
    for (let i = 0; i <= HALF; i++) {
      const a = Math.PI - (i / HALF) * Math.PI;        // π -> 0 over the +n side
      const ang = fromA ? a : Math.PI - a;
      outer.push({
        x: cx + p.ex * r * Math.cos(ang) + p.nx * r * Math.sin(ang),
        z: cz + p.ez * r * Math.cos(ang) + p.nz * r * Math.sin(ang),
      });
    }

    railInner.push(inTip, ...outer, outTip);

    /* The rail is cut back to where the cushion ends. Running it to the nose
       line instead leaves its inner wall in exactly the same plane as the face
       of the cushion, and the two z-fight into a flickering see-through band
       along the whole rail — which is also not how a table is built: the
       sub-rail begins behind the rubber. */
    const inOut = from === 'A' ? p.aOut : p.bOut;
    const outOut = from === 'A' ? p.bOut : p.aOut;
    railEdge.push(
      { x: inTip.x + inOut.x * railInset, z: inTip.z + inOut.z * railInset },
      ...outer,
      { x: outTip.x + outOut.x * railInset, z: outTip.z + outOut.z * railInset },
    );
    /* The cloth stops at the back of the shelf rather than carrying on round
       the opening. Cutting the openings out as holes instead would make them
       share an edge with the outer boundary, which is degenerate for any
       ear-clipping triangulator and silently drops triangles — the shelf comes
       out unclothed. Two simple polygons beat one polygon with touching holes. */
    clothEdge.push(inTip, inBack, outBack, outTip);
  }

  return { railInner, railEdge, clothEdge, openings, holes };
}

/* ------------------------------------------------------------------ */
/* Balls                                                               */
/* ------------------------------------------------------------------ */

export function makeBall(num, x, z, opts = {}) {
  return {
    num,                       // 0 = cue ball, 1..15 objects, -1 = junk
    x, y: 0, z,                // y is height of the ball centre above the cloth
    vx: 0, vy: 0, vz: 0,
    wx: 0, wy: 0, wz: 0,       // angular velocity, rad/s, world axes
    q: [0, 0, 0, 1],           // orientation, for rendering the numbers
    r: opts.r ?? BALL_R,
    m: opts.m ?? BALL_M,
    junk: !!opts.junk,
    kind: opts.kind ?? 'ball',
    live: true,                // still on the table
    pocketed: false,
    pocket: -1,
    airborne: false,
    asleep: true,
  };
}

/** Standard 8-ball rack, apex on the foot spot, 8 in the middle. */
export function rackEight(rng = Math.random) {
  const R = BALL_R;
  const gap = R * 2 + 0.0004;
  const apexX = TABLE.halfLen * 0.5;      // foot spot
  const rowDx = gap * Math.sqrt(3) / 2;

  // legal-ish rack: 8 in the centre, a stripe and a solid in the back corners
  const solids = [1, 2, 3, 4, 5, 6, 7];
  const stripes = [9, 10, 11, 12, 13, 14, 15];
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  shuffle(solids); shuffle(stripes);

  const order = new Array(15).fill(0);
  order[0] = solids.pop();                 // apex
  order[4] = 8;                            // centre of the third row
  order[10] = solids.pop();                // back corners, one of each
  order[14] = stripes.pop();
  const rest = shuffle(solids.concat(stripes));
  for (let i = 0; i < 15; i++) if (!order[i]) order[i] = rest.pop();

  const balls = [];
  let i = 0;
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k <= row; k++) {
      const x = apexX + row * rowDx;
      const z = (k - row / 2) * gap;
      balls.push(makeBall(order[i++], x, z));
    }
  }
  // cue ball behind the head string
  balls.unshift(makeBall(0, -TABLE.halfLen * 0.5, 0));
  return balls;
}

/* ------------------------------------------------------------------ */
/* The simulation                                                      */
/* ------------------------------------------------------------------ */

export class PoolSim {
  constructor(opts = {}) {
    this.geo = buildTableGeometry();
    this.cfg = { ...CFG, ...(opts.cfg || {}) };
    this.balls = [];
    this.puddles = [];          // { x, z, r, strength }
    this.events = [];           // drained by the presentation layer each frame
    this.time = 0;
    this.rng = opts.rng ?? mulberry32(12345);
    /* Optional height field, for tables whose bed is not flat. Returns the bed
       height under a point and its gradient. A rolling sphere on a slope
       accelerates at (5/7)g·sinθ rather than g·sinθ, because five sevenths of
       the energy goes into the ball's rotation. */
    this.terrain = opts.terrain ?? null;
    this.inBounds = opts.inBounds ?? null;
    if (opts.geo) this.geo = opts.geo;
    this.resetShotLog();
  }

  resetShotLog() {
    this.log = {
      firstContact: null,       // number of the first object ball the cue struck
      railAfterContact: false,
      cueHitRail: false,
      pocketed: [],             // ball numbers, in the order they dropped
      pocketDetail: {},         // ball number -> pocket id, for called shots
      cueScratch: false,
      offTable: [],
      contacts: 0,
    };
  }

  add(ball) {
    // sit it on the bed, which on a warped table is not y = 0. Dropping a ball
    // in at nominal height and letting the cloth clamp it up is a free lift.
    if (this.terrain && !ball.airborne) ball.y = Math.max(ball.y, this._ground(ball).h);
    this.balls.push(ball);
    return ball;
  }

  byNum(n) { return this.balls.find((b) => b.num === n); }

  get cue() { return this.byNum(0); }

  /** Balls still on the cloth (not pocketed, not knocked off). */
  live() { return this.balls.filter((b) => b.live); }

  moving() {
    for (const b of this.balls) if (b.live && !b.asleep) return true;
    return false;
  }

  event(e) { this.events.push(e); }

  drainEvents() { const e = this.events; this.events = []; return e; }

  /* ---------------- the stroke ---------------- */

  /**
   * Strike the cue ball.
   * @param {number} yaw        aim direction, radians (0 = +x)
   * @param {number} speed      cue tip speed, m/s
   * @param {number} tipX       side offset of the tip on the ball face, -1..1 of R
   * @param {number} tipY       vertical offset, -1..1 of R (+ = above centre)
   * @param {number} elevation  butt elevation, radians
   */
  strike(yaw, speed, tipX = 0, tipY = 0, elevation = 0) {
    const cue = this.cue;
    if (!cue || !cue.live) return null;
    const R = cue.r;

    const off = Math.hypot(tipX, tipY);
    // past ~half a radius the tip slides off the ball: miscue
    const miscue = off > 0.55 ? Math.min(1, (off - 0.55) * 3) : 0;

    // momentum transfer, cue 0.54 kg against ball 0.17 kg, e ~ 0.75
    const mc = 0.54;
    let v = speed * (1 + 0.75) / (1 + cue.m / mc);
    v *= (1 - 0.28 * off * off);                     // off-centre bleeds into spin
    v *= (1 - miscue * 0.65);
    v *= Math.cos(elevation) * 0.94 + 0.06;

    // squirt: side english pushes the cue ball off the aim line
    const squirt = -tipX * 0.055 * (1 - elevation * 0.3);
    const a = yaw + squirt + (miscue ? (this.rng() - 0.5) * miscue * 0.25 : 0);

    const dx = Math.cos(a), dz = Math.sin(a);
    const horiz = v * Math.cos(elevation);
    cue.vx = dx * horiz;
    cue.vz = dz * horiz;
    cue.vy = v * Math.sin(elevation) * 0.8;
    cue.airborne = cue.vy > 0.05;

    // ω = (5/2)·(offset/R)·v — the 40%-of-a-radius natural-roll rule falls out
    const k = 2.5 * v / R;
    /* Top/bottom spin is about the horizontal axis perpendicular to the shot.
       Sign convention: rolling means u = (vx + R·ωz, vz − R·ωx) = 0, so a ball
       rolling along +x carries ωz = −v/R. */
    const wTop = k * tipY * (1 - miscue * 0.5);
    cue.wx = dz * wTop;
    cue.wz = -dx * wTop;
    // side english is about the vertical axis
    cue.wy = -k * tipX * Math.cos(elevation) * (1 - miscue * 0.5);
    // an elevated cue converts side english into swerve-inducing masse spin
    if (elevation > 0.05) {
      const masse = k * tipX * Math.sin(elevation);
      cue.wx += dx * masse;
      cue.wz += dz * masse;
    }

    cue.asleep = false;
    this.resetShotLog();
    this.event({ type: 'strike', speed: v, miscue });
    return { v, miscue };
  }

  /* ---------------- stepping ---------------- */

  step(dt) {
    const cfg = this.cfg;
    let remaining = Math.min(dt, 0.1);
    let guard = 0;

    while (remaining > 1e-6 && guard++ < 500) {
      let vmax = 0;
      for (const b of this.balls) {
        if (!b.live || b.asleep) continue;
        const s = Math.hypot(b.vx, b.vz) + Math.abs(b.vy);
        if (s > vmax) vmax = s;
      }
      // never travel more than a fraction of a radius per substep, so discrete
      // collision detection cannot tunnel through a ball
      let h = vmax > 1e-4 ? (cfg.maxStepDist * BALL_R) / vmax : 1 / 240;
      h = Math.max(1 / 4000, Math.min(h, 1 / 240, remaining));
      this._substep(h);
      remaining -= h;
      this.time += h;
    }
  }

  _substep(h) {
    const cfg = this.cfg;
    const balls = this.balls;

    for (const b of balls) {
      if (!b.live || b.asleep) continue;
      this._cloth(b, h);
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.z += b.vz * h;
      this._spinQuat(b, h);
    }

    // ball-ball
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (!a.live) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (!b.live) continue;
        if (a.asleep && b.asleep) continue;
        this._collide(a, b);
      }
    }

    for (const b of balls) {
      if (!b.live || b.asleep) continue;
      this._cushions(b);
      this._jaws(b);
      this._pockets(b);
      this._sleep(b);
    }
  }

  /** Gravity, cloth friction, rolling resistance, spin decay. */
  /** Bed height and slope under a ball. Flat unless the table says otherwise. */
  _ground(b) {
    if (!this.terrain) return FLAT;
    return this.terrain(b.x, b.z) || FLAT;
  }

  _cloth(b, h) {
    const cfg = this.cfg;
    const ground = this._ground(b);

    if (b.airborne || b.y > ground.h + 1e-4) {
      b.vy -= G * h;
      if (b.y <= ground.h && b.vy < 0) {
        b.y = ground.h;
        if (Math.abs(b.vy) < 0.25) {
          b.vy = 0;
          b.airborne = false;
        } else {
          this.event({ type: 'land', ball: b.num, speed: -b.vy, x: b.x, z: b.z });
          b.vy = -b.vy * cfg.eCloth;
          // landing scrubs a chunk of horizontal speed and spin
          b.vx *= 0.86; b.vz *= 0.86;
          b.wx *= 0.7; b.wz *= 0.7;
        }
      }
      if (b.y > ground.h + 1e-4) {
        // in flight only air drag and spin decay act
        const d = 1 - 0.02 * h;
        b.vx *= d; b.vz *= d;
        return;
      }
    }

    /* On the cloth. The slate is not optional: ball-ball impulses and the rail
       nose both produce a little downward velocity, and without this a resting
       ball quietly sinks through the table for ever and never sleeps. */
    if (b.y < ground.h) b.y = ground.h;
    if (b.vy < 0) b.vy = 0;
    b.airborne = false;


    // velocity of the material point at the contact patch
    let ux = b.vx + b.r * b.wz;
    let uz = b.vz - b.r * b.wx;
    const u = Math.hypot(ux, uz);

    let muRoll = cfg.muRoll;
    let muSlide = cfg.muSlide;
    if (this.puddles.length) {
      const p = this._puddleAt(b.x, b.z);
      if (p) {
        muRoll *= 1 + 5.5 * p.strength;
        muSlide *= 1 + 0.8 * p.strength;
        // a slick of muppet sick does not decelerate a ball evenly
        const wob = Math.sin((b.x * 37.1 + b.z * 51.7) * 12.0) * p.strength * 0.5;
        const sp = Math.hypot(b.vx, b.vz);
        if (sp > 0.02) {
          const nx = -b.vz / sp, nz = b.vx / sp;
          b.vx += nx * wob * 0.35 * h * 9;
          b.vz += nz * wob * 0.35 * h * 9;
        }
      }
    }

    /* Slip closes at (7/2)·µ_s·g. If a whole substep would overshoot that, the
       friction direction flips next step and the ball glides for ever in a
       limit cycle — so when the transition lands inside this step, snap to the
       exact rolling state instead: v_roll = v − (2/7)·u. */
    const slipClose = 3.5 * muSlide * G * h;

    /* Gravity down the slope. The familiar (5/7)·g·sinθ is the *rolling*
       answer — it already has the rolling constraint baked into it, and using
       it while the ball is still sliding both under-accelerates the ball and
       quietly creates energy, because the spin is free to disagree. So the
       sliding branch gets the full g·sinθ on the centre of mass and leaves the
       spin alone, and the rolling branch gets the five sevenths. */
    if (ground.gx || ground.gz) {
      const k = u > slipClose ? 1 : 5 / 7;
      b.vx -= k * G * ground.gx * h;
      b.vz -= k * G * ground.gz * h;
    }

    if (u > slipClose) {
      /* sliding: friction opposes the contact-point velocity, and the torque it
         makes about the centre is what spins a stunned ball up into a roll */
      const a = muSlide * G;
      const ax = (-ux / u) * a, az = (-uz / u) * a;
      b.vx += ax * h;
      b.vz += az * h;
      // τ = r × F with r = (0,−R,0) and F = m·a  ->  α = (−2.5·az/R, 0, 2.5·ax/R)
      const c = 2.5 / b.r;
      b.wx += -c * az * h;
      b.wz += c * ax * h;
    } else {
      // finish any remaining slip exactly, then roll
      if (u > 1e-9) {
        b.vx -= (2 / 7) * ux;
        b.vz -= (2 / 7) * uz;
      }
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 1e-5) {
        const a = muRoll * G;
        const dv = Math.min(sp, a * h);
        b.vx -= (b.vx / sp) * dv;
        b.vz -= (b.vz / sp) * dv;
      }
      b.wx = b.vz / b.r;
      b.wz = -b.vx / b.r;
    }

    // spin about the vertical axis decays on its own
    if (b.wy !== 0) {
      const dw = (5 * cfg.muSpin * G) / (2 * b.r) * h;
      b.wy = Math.abs(b.wy) <= dw ? 0 : b.wy - Math.sign(b.wy) * dw;
    }
  }

  _puddleAt(x, z) {
    for (const p of this.puddles) {
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz < p.r * p.r) return p;
    }
    return null;
  }

  /** Integrate the orientation quaternion so the numbers roll properly. */
  _spinQuat(b, h) {
    const q = b.q;
    const hx = b.wx * h * 0.5, hy = b.wy * h * 0.5, hz = b.wz * h * 0.5;
    const x = q[0], y = q[1], z = q[2], w = q[3];
    q[0] = x + (hx * w + hy * z - hz * y);
    q[1] = y + (hy * w + hz * x - hx * z);
    q[2] = z + (hz * w + hx * y - hy * x);
    q[3] = w - (hx * x + hy * y + hz * z);
    const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    q[0] /= n; q[1] /= n; q[2] /= n; q[3] /= n;
  }

  /* ---------------- collisions ---------------- */

  _collide(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y;
    const sum = a.r + b.r;
    const d2 = dx * dx + dz * dz + dy * dy;
    if (d2 >= sum * sum || d2 < 1e-12) return;

    const d = Math.sqrt(d2);
    const nx = dx / d, ny = dy / d, nz = dz / d;

    // separate
    const push = (sum - d) * 0.5 + 1e-6;
    const ma = a.m, mb = b.m;
    const wa = mb / (ma + mb), wb = ma / (ma + mb);
    a.x -= nx * push * 2 * wa; a.y -= ny * push * 2 * wa; a.z -= nz * push * 2 * wa;
    b.x += nx * push * 2 * wb; b.y += ny * push * 2 * wb; b.z += nz * push * 2 * wb;
    if (a.y < 0) a.y = 0;
    if (b.y < 0) b.y = 0;

    const rvx = b.vx - a.vx, rvy = b.vy - a.vy, rvz = b.vz - a.vz;
    const vn = rvx * nx + rvy * ny + rvz * nz;
    if (vn > 0) return;                    // already separating

    const e = (a.junk || b.junk) ? 0.55 : this.cfg.eBall;
    const inv = 1 / ma + 1 / mb;
    const jn = -(1 + e) * vn / inv;

    a.vx -= (jn / ma) * nx; a.vy -= (jn / ma) * ny; a.vz -= (jn / ma) * nz;
    b.vx += (jn / mb) * nx; b.vy += (jn / mb) * ny; b.vz += (jn / mb) * nz;

    /* tangential friction at the contact patch: this is "throw", and it is why
       a ball cut with running english does not leave on the pure tangent line */
    const cax = nx * a.r, cay = ny * a.r, caz = nz * a.r;
    const cbx = -nx * b.r, cby = -ny * b.r, cbz = -nz * b.r;
    // surface velocity = v + ω × r
    const sax = a.vx + (a.wy * caz - a.wz * cay);
    const say = a.vy + (a.wz * cax - a.wx * caz);
    const saz = a.vz + (a.wx * cay - a.wy * cax);
    const sbx = b.vx + (b.wy * cbz - b.wz * cby);
    const sby = b.vy + (b.wz * cbx - b.wx * cbz);
    const sbz = b.vz + (b.wx * cby - b.wy * cbx);
    let tx = sbx - sax, ty = sby - say, tz = sbz - saz;
    const tn = tx * nx + ty * ny + tz * nz;
    tx -= tn * nx; ty -= tn * ny; tz -= tn * nz;
    const tl = Math.hypot(tx, ty, tz);
    if (tl > 1e-5) {
      tx /= tl; ty /= tl; tz /= tl;
      const mu = this.cfg.muBall;
      // impulse needed to kill the slip, capped by Coulomb friction
      const jtFull = -tl / (inv * (1 + 1 / I_FACTOR));
      const jt = Math.max(jtFull, -mu * Math.abs(jn));
      a.vx -= (jt / ma) * tx; a.vy -= (jt / ma) * ty; a.vz -= (jt / ma) * tz;
      b.vx += (jt / mb) * tx; b.vy += (jt / mb) * ty; b.vz += (jt / mb) * tz;
      const ia = I_FACTOR * ma * a.r * a.r, ib = I_FACTOR * mb * b.r * b.r;
      // τ = r × J
      a.wx -= (cay * (jt * tz) - caz * (jt * ty)) / ia;
      a.wy -= (caz * (jt * tx) - cax * (jt * tz)) / ia;
      a.wz -= (cax * (jt * ty) - cay * (jt * tx)) / ia;
      b.wx += (cby * (jt * tz) - cbz * (jt * ty)) / ib;
      b.wy += (cbz * (jt * tx) - cbx * (jt * tz)) / ib;
      b.wz += (cbx * (jt * ty) - cby * (jt * tx)) / ib;
    }

    a.asleep = false; b.asleep = false;
    const speed = Math.abs(vn);
    this.log.contacts++;
    if (a.num === 0 && !b.junk && this.log.firstContact === null) this.log.firstContact = b.num;
    if (b.num === 0 && !a.junk && this.log.firstContact === null) this.log.firstContact = a.num;
    this.event({
      type: (a.junk || b.junk) ? 'junkhit' : 'click',
      speed,
      x: (a.x + b.x) / 2, z: (a.z + b.z) / 2,
      a: a.num, b: b.num,
    });
  }

  _cushions(b) {
    if (b.y > b.r * 0.9) return;           // jumped clean over the rail
    this._walls(b, this.geo.cushions, 1);
    // pocket facings are leather over wood: they take the sting out of a rattle
    this._walls(b, this.geo.facings, this.cfg.facingScale);
  }

  _walls(b, segments, scale) {
    for (const c of segments) {
      // distance from the ball centre to the segment
      const ex = c.bx - c.ax, ez = c.bz - c.az;
      const len2 = ex * ex + ez * ez;
      let t = ((b.x - c.ax) * ex + (b.z - c.az) * ez) / len2;
      if (t < 0 || t > 1) continue;        // the caps are handled as jaws
      const px = c.ax + ex * t, pz = c.az + ez * t;
      const dx = b.x - px, dz = b.z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist >= b.r) continue;
      // always resolve along the cushion's inward normal
      const nx = c.nx, nz = c.nz;
      const pen = b.r - (dx * nx + dz * nz);
      if (pen <= 0) continue;
      b.x += nx * pen;
      b.z += nz * pen;
      this._railImpulse(b, nx, nz, scale);
    }
  }

  _jaws(b) {
    for (const j of this.geo.jaws) {
      const dx = b.x - j.x, dz = b.z - j.z;
      const sum = b.r + j.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= sum * sum || d2 < 1e-12) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d, nz = dz / d;
      b.x += nx * (sum - d);
      b.z += nz * (sum - d);
      this._railImpulse(b, nx, nz, 0.9);
    }
  }

  /**
   * Rail impulse applied at the cushion nose, which sits above the ball's
   * equator — that offset is what makes a ball come off the rail with topspin,
   * and lets running english widen the angle out of the cushion.
   */
  _railImpulse(b, nx, nz, scale = 1) {
    const cfg = this.cfg;
    const vn = b.vx * nx + b.vz * nz;
    if (vn >= 0) return;
    const speed = Math.abs(vn);

    const e = cfg.eRail * scale * (1 - Math.min(0.18, speed * 0.02));
    const jn = -(1 + e) * vn * b.m;

    b.vx += (jn / b.m) * nx;
    b.vz += (jn / b.m) * nz;

    // contact point: out along -n at the ball radius, raised by the nose height
    const cx = -nx * b.r, cy = cfg.railNose * b.r, cz = -nz * b.r;
    const sx = b.vx + (b.wy * cz - b.wz * cy);
    const sy = b.vy + (b.wz * cx - b.wx * cz);
    const sz = b.vz + (b.wx * cy - b.wy * cx);
    // tangential component of the surface velocity
    const sn = sx * nx + sz * nz;
    let tx = sx - sn * nx, ty = sy, tz = sz - sn * nz;
    const tl = Math.hypot(tx, ty, tz);
    if (tl > 1e-5) {
      tx /= tl; ty /= tl; tz /= tl;
      const jt = -Math.min(cfg.muRail * jn, tl * b.m * 0.4);
      b.vx += (jt / b.m) * tx;
      b.vy += (jt / b.m) * ty * 0.35;
      b.vz += (jt / b.m) * tz;
      const I = I_FACTOR * b.m * b.r * b.r;
      b.wx += (cy * (jt * tz) - cz * (jt * ty)) / I;
      b.wy += (cz * (jt * tx) - cx * (jt * tz)) / I;
      b.wz += (cx * (jt * ty) - cy * (jt * tx)) / I;
    }
    if (b.vy > 0.02) b.airborne = true;

    b.asleep = false;
    if (b.num === 0) this.log.cueHitRail = true;
    if (this.log.firstContact !== null) this.log.railAfterContact = true;
    this.event({ type: 'rail', speed, x: b.x, z: b.z, ball: b.num });
  }

  _pockets(b) {
    if (b.y > b.r * 1.2) return;
    for (const p of this.geo.pockets) {
      /* A hole cut in the middle of the cloth is not a rail pocket: it has no
         mouth, no shelf and no facings, and a ball goes in when it is over it.
         Faking one out of a ring of rail pockets gives it a six-pointed star of
         facings that flick balls inward — a magnet, not a hole. */
      if (p.kind === 'island') {
        if (Math.hypot(b.x - p.x, b.z - p.z) > p.r - b.r * 0.55) continue;
        b.live = false; b.pocketed = true; b.pocket = p.id; b.asleep = true;
        const sp = Math.hypot(b.vx, b.vz);
        if (b.junk) this.event({ type: 'junkpocket', ball: b, pocket: p, speed: sp });
        else {
          if (b.num === 0) this.log.cueScratch = true;
          this.log.pocketed.push(b.num);
          this.log.pocketDetail[b.num] = p.id;
          this.event({ type: 'pocket', ball: b.num, pocket: p.id, speed: sp, x: p.x, z: p.z });
        }
        return;
      }

      /* Across the shelf, not merely through the mouth. Anything short of this
         is still in the jaws and can be spat back out by a facing. The
         threshold sits inside the facings' reach, so the funnel stays sealed. */
      const d = (b.x - p.ax) * p.nx + (b.z - p.az) * p.nz;
      if (d < p.shelf * (this.cfg.dropDepth ?? 0.6)) continue;
      // and how far along the mouth it crossed
      const t = (b.x - p.ax) * p.ex + (b.z - p.az) * p.ez;
      if (t < -b.r || t > p.len + b.r) continue;
      b.live = false;
      b.pocketed = true;
      b.pocket = p.id;
      b.asleep = true;
      const speed = Math.hypot(b.vx, b.vz);
      if (b.junk) {
        this.event({ type: 'junkpocket', ball: b, pocket: p, speed });
      } else {
        if (b.num === 0) this.log.cueScratch = true;
        this.log.pocketed.push(b.num);
        this.log.pocketDetail[b.num] = p.id;
        this.event({ type: 'pocket', ball: b.num, pocket: p.id, speed, x: p.x, z: p.z });
      }
      return;
    }
    // knocked clean off the table
    const bound = 0.30;
    if (Math.abs(b.x) > TABLE.halfLen + bound || Math.abs(b.z) > TABLE.halfWid + bound) {
      b.live = false;
      b.asleep = true;
      if (!b.junk) {
        this.log.offTable.push(b.num);
        if (b.num === 0) this.log.cueScratch = true;
      }
      this.event({ type: 'offtable', ball: b.num, x: b.x, z: b.z });
    }
  }

  _sleep(b) {
    if (b.airborne || b.y > this._ground(b).h + 1e-4) return;
    const cfg = this.cfg;
    const v = Math.hypot(b.vx, b.vz);
    const w = Math.hypot(b.wx, b.wy, b.wz);
    if (v < cfg.stopV && w < cfg.stopW) {
      b.vx = b.vy = b.vz = 0;
      b.wx = b.wy = b.wz = 0;
      b.asleep = true;
    } else {
      b.asleep = false;
    }
  }

  /* ---------------- table services ---------------- */

  /** Is this spot clear enough to drop a ball on? */
  freeAt(x, z, r = BALL_R, skip = null) {
    /* `inBounds` lets a design say what "on the table" means for it. Without one
       this is the house rectangle, which would happily place a ball outside a
       hexagon's cushions. */
    if (this.inBounds) { if (!this.inBounds(x, z, r)) return false; }
    else if (Math.abs(x) > TABLE.halfLen - r || Math.abs(z) > TABLE.halfWid - r) return false;
    for (const b of this.balls) {
      if (!b.live || b === skip) continue;
      const dx = b.x - x, dz = b.z - z;
      if (dx * dx + dz * dz < (b.r + r) * (b.r + r) * 1.02) return false;
    }
    return true;
  }

  /** Nearest legal spot to (x,z) — used for spotting balls and ball-in-hand. */
  nearestFree(x, z, r = BALL_R, skip = null) {
    if (this.freeAt(x, z, r, skip)) return { x, z };
    for (let ring = 1; ring < 40; ring++) {
      const rad = ring * r * 0.6;
      for (let a = 0; a < 16; a++) {
        const t = (a / 16) * Math.PI * 2;
        const nx = x + Math.cos(t) * rad, nz = z + Math.sin(t) * rad;
        if (this.freeAt(nx, nz, r, skip)) return { x: nx, z: nz };
      }
    }
    return { x, z };
  }

  /** Put the cue ball back on the cloth after a scratch. */
  placeCue(x, z) {
    let cue = this.cue;
    if (!cue) cue = this.add(makeBall(0, x, z));
    const spot = this.nearestFree(x, z, cue.r, cue);
    cue.x = spot.x; cue.z = spot.z; cue.y = 0;
    cue.vx = cue.vy = cue.vz = 0;
    cue.wx = cue.wy = cue.wz = 0;
    cue.live = true; cue.pocketed = false; cue.airborne = false; cue.asleep = true;
    return cue;
  }

  /**
   * Freeze / thaw the whole table. The AI plays candidate shots out on the real
   * sim and rewinds; online play will use the same pair for rollback.
   */
  snapshot() {
    return {
      time: this.time,
      // the ref is kept so restore can write back into the very same object the
      // presentation layer has bound a mesh to
      balls: this.balls.map((b) => ({ ref: b, state: { ...b, q: b.q.slice() } })),
      puddles: this.puddles.map((p) => ({ ...p })),
      log: { ...this.log, pocketed: this.log.pocketed.slice(), offTable: this.log.offTable.slice() },
    };
  }

  restore(s) {
    this.time = s.time;
    this.balls = s.balls.map(({ ref, state }) => {
      Object.assign(ref, state);
      ref.q = state.q.slice();
      return ref;
    });
    this.puddles = s.puddles.map((p) => ({ ...p }));
    this.log = { ...s.log, pocketed: s.log.pocketed.slice(), offTable: s.log.offTable.slice() };
    this.events.length = 0;
  }

  addPuddle(x, z, r, strength = 1) {
    const p = { x, z, r, strength, born: this.time };
    this.puddles.push(p);
    return p;
  }

  clearPuddle(p) {
    const i = this.puddles.indexOf(p);
    if (i >= 0) this.puddles.splice(i, 1);
  }

  removeBall(b) {
    const i = this.balls.indexOf(b);
    if (i >= 0) this.balls.splice(i, 1);
  }

  /**
   * Advance by a wall-clock duration. `step` deliberately clamps a single call
   * to 100 ms so a stalled tab cannot explode the sim; use this when you mean
   * "simulate n seconds" rather than "one frame".
   */
  advance(seconds, h = 1 / 240) {
    let t = 0;
    while (t < seconds) {
      this.step(Math.min(h, seconds - t));
      t += h;
    }
  }

  /** Run the table out with no rendering — used by the AI and by tests. */
  settle(maxSeconds = 30) {
    let t = 0;
    while (this.moving() && t < maxSeconds) {
      this.step(1 / 120);
      t += 1 / 120;
    }
    return t;
  }
}

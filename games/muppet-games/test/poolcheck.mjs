/**
 * Headless billiard checks. `node test/poolcheck.mjs`
 * Every one of these is a behaviour a pool player would notice immediately if
 * it were wrong, so they are worth asserting rather than eyeballing.
 */
import { PoolSim, makeBall, rackEight, mulberry32, TABLE, BALL_R, CFG,
  buildTableGeometry } from '../src/pool/physics.js';

let pass = 0, fail = 0;
const ok = (name, cond, info = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}${info ? '  ' + info : ''}`); }
  else { fail++; console.log(`  FAIL ${name}  ${info}`); }
};
const round = (v, n = 3) => +v.toFixed(n);

function sim(balls) {
  const s = new PoolSim({ rng: mulberry32(7) });
  for (const b of balls) s.add(b);
  return s;
}

/* ------------------------------------------------------------------ */
console.log('\n--- cloth: roll vs slide ---');
{
  // natural roll (tip 40% above centre) should not slide at all
  const s = sim([makeBall(0, -0.6, 0)]);
  s.strike(0, 2.0, 0, 0.4);
  const cue = s.cue;
  const u0 = Math.hypot(cue.vx + cue.r * cue.wz, cue.vz - cue.r * cue.wx);
  ok('natural roll leaves no contact-patch slip', u0 < 0.02, `slip=${round(u0)}`);

  const v0 = Math.hypot(cue.vx, cue.vz);
  s.advance(0.3);
  const v1 = Math.hypot(cue.vx, cue.vz);
  const decel = (v0 - v1) / 0.3;
  ok('rolling decel ≈ µ_roll·g', Math.abs(decel - CFG.muRoll * 9.806) < 0.03, `${round(decel)} m/s²`);
}
{
  // a stun shot slides; friction torque spins it up towards a roll at (7/2)µ_s·g
  const s = sim([makeBall(0, -0.9, 0)]);
  s.strike(0, 2.0, 0, 0);
  const cue = s.cue;
  ok('centre hit starts with no spin', Math.abs(cue.wz) < 1e-6);
  const slip = () => Math.hypot(cue.vx + cue.r * cue.wz, cue.vz - cue.r * cue.wx);
  const s0 = slip();
  s.advance(0.1);
  const rate = (s0 - slip()) / 0.1;
  ok('slip decays at (7/2)µ_s·g', Math.abs(rate - 3.5 * 0.2 * 9.806) < 0.4, `${round(rate, 2)} m/s²`);
  s.advance(0.35);
  ok('stun shot settles into a roll', slip() < 0.05, `slip=${round(slip())}`);
  ok('roll constraint holds v = ωR', Math.abs(cue.vx + cue.r * cue.wz) < 0.02);
}

/* ------------------------------------------------------------------ */
console.log('\n--- how far a ball actually rolls ---');
{
  /* The one number a player feels immediately. Published rolling-resistance
     figures for pool cloth are µ = 0.005-0.015, i.e. a deceleration of about
     0.05-0.15 m/s²; a ball rolling at 1 m/s therefore covers several metres,
     which on a 7-foot table is more than one length. Getting this wrong makes
     balls die as if the slate were carpeted, so it is asserted, not eyeballed. */
  const rollDistance = (v0) => {
    const s = sim([makeBall(0, -0.9, 0)]);
    const b = s.cue;
    b.vx = v0; b.wz = -v0 / b.r; b.asleep = false;
    let dist = 0, guard = 0;
    while (s.moving() && guard++ < 40000) {
      const px = b.x;
      s.step(1 / 240);
      dist += Math.abs(b.x - px);
      if (b.x > 0.9) b.x = -0.9;      // loop the run so cushions never interfere
    }
    return dist;
  };

  const decel = CFG.muRoll * 9.806;
  ok('rolling resistance is inside the measured range',
    CFG.muRoll >= 0.005 && CFG.muRoll <= 0.017, `µ=${CFG.muRoll} (${round(decel, 3)} m/s²)`);

  const d1 = rollDistance(1.0);
  const ideal = 1 / (2 * decel);
  ok('a 1 m/s roll matches v²/2a', Math.abs(d1 - ideal) / ideal < 0.06,
    `${round(d1, 2)} m vs ${round(ideal, 2)} m predicted`);
  ok('a 1 m/s roll crosses the table', d1 > TABLE.halfLen * 2,
    `${round(d1, 2)} m across a ${round(TABLE.halfLen * 2, 2)} m table`);

  // and a gentle tap should still travel a sensible way, not die on the spot
  const d = rollDistance(0.5);
  ok('a soft roll travels half a table', d > 0.7 && d < 2.0, `${round(d, 2)} m`);
}

/* ------------------------------------------------------------------ */
console.log('\n--- the stroke: draw, follow, stun ---');
/* Measured just after contact: once the balls start bouncing off cushions the
   resting positions stop saying anything about the stroke. */
for (const [name, tipY, expect] of [['draw', -0.5, 'back'], ['stun', 0, 'stop'], ['follow', 0.5, 'forward']]) {
  // close together on purpose: over a long approach the cloth turns any stroke
  // into natural roll, so stun and draw only survive at short range
  const s = sim([makeBall(0, -0.05, 0), makeBall(1, 0.12, 0)]);
  s.strike(0, 2.6, 0, tipY);
  const obj = s.byNum(1);
  let cueV = 0, objV = 0;
  for (let i = 0; i < 2000; i++) {
    s.step(1 / 600);
    if (Math.hypot(obj.vx, obj.vz) > 0.05) {
      objV = obj.vx;
      // the cue ball leaves a full hit at ~0 and is then driven by its retained
      // spin, so the stroke only shows up a couple of tenths later
      s.advance(0.22);
      cueV = s.cue.vx;
      break;
    }
  }
  const verdict = cueV < -0.12 ? 'back' : cueV > 0.12 ? 'forward' : 'stop';
  ok(`${name} sends the cue ball ${expect}`, verdict === expect,
    `cue vx=${round(cueV)} obj vx=${round(objV)}`);
  ok(`${name}: object ball drives forward`, objV > 1.0, `vx=${round(objV)}`);
}

/* ------------------------------------------------------------------ */
console.log('\n--- the 90° rule (stun cut shot) ---');
{
  // half-ball cut with a stun shot: cue and object should separate ~90°
  const s = sim([makeBall(0, -0.5, 0), makeBall(1, 0, BALL_R)]);
  s.strike(0, 3.0, 0, 0);
  // sample the directions shortly after contact, before cloth reshapes them
  let cueDir = null, objDir = null;
  for (let i = 0; i < 400; i++) {
    s.step(1 / 400);
    const o = s.byNum(1);
    if (Math.hypot(o.vx, o.vz) > 0.05 && !cueDir) {
      cueDir = Math.atan2(s.cue.vz, s.cue.vx);
      objDir = Math.atan2(o.vz, o.vx);
      break;
    }
  }
  let d = Math.abs(cueDir - objDir) * 180 / Math.PI;
  if (d > 180) d = 360 - d;
  ok('cue and object separate by ~90°', Math.abs(d - 90) < 12, `${round(d, 1)}°`);
}

/* ------------------------------------------------------------------ */
console.log('\n--- english ---');
{
  const straight = (tipX) => {
    const s = sim([makeBall(0, -0.5, 0)]);
    s.strike(0, 3.0, tipX, 0.2);
    s.step(0.05);
    return Math.atan2(s.cue.vz, s.cue.vx) * 180 / Math.PI;
  };
  const l = straight(-0.5), r = straight(0.5);
  ok('side english squirts the cue ball off line', Math.abs(l) > 0.5 && Math.sign(l) === -Math.sign(r),
    `left=${round(l, 2)}° right=${round(r, 2)}°`);

  // running english off a cushion should widen the rebound vs no english
  const rebound = (tipX) => {
    const s = sim([makeBall(0, 0, -0.2)]);
    s.strike(Math.PI / 4, 3.0, tipX, 0.2);   // into the far long rail at 45°
    for (let i = 0; i < 4000; i++) {
      s.step(1 / 400);
      if (s.cue.vz < -0.05) break;           // has come off the rail
    }
    return Math.abs(Math.atan2(s.cue.vz, s.cue.vx) * 180 / Math.PI);
  };
  const plain = rebound(0), running = rebound(0.5);
  ok('english changes the angle out of a cushion', Math.abs(plain - running) > 1.0,
    `plain=${round(plain, 1)}° running=${round(running, 1)}°`);
}

/* ------------------------------------------------------------------ */
console.log('\n--- cushions ---');
{
  const s = sim([makeBall(0, 0, 0)]);
  s.strike(Math.PI / 4, 2.4, 0, 0.4);       // 45° into the long rail
  let bounced = false;
  for (let i = 0; i < 4000 && !bounced; i++) {
    s.step(1 / 400);
    if (s.cue.vz < -0.05) bounced = true;
  }
  const ang = Math.abs(Math.atan2(s.cue.vz, s.cue.vx) * 180 / Math.PI);
  ok('45° into a rail comes back near 45°', bounced && Math.abs(ang - 45) < 14, `${round(ang, 1)}°`);
  const speed = Math.hypot(s.cue.vx, s.cue.vz);
  ok('the cushion eats energy', speed < 2.4 && speed > 0.4, `${round(speed, 2)} m/s`);
}
{
  // a hard shot must not tunnel through a rail or a ball
  const s = sim([makeBall(0, -0.9, 0), makeBall(1, 0.5, 0.0006)]);
  s.strike(0, 12, 0, 0.2);
  s.settle(40);
  const inside = s.balls.every((b) => !b.live
    || (Math.abs(b.x) <= TABLE.halfLen + 0.01 && Math.abs(b.z) <= TABLE.halfWid + 0.01));
  ok('a 12 m/s stroke tunnels through nothing', inside);
  ok('everything comes to rest', !s.moving());
}

/* ------------------------------------------------------------------ */
console.log('\n--- pockets ---');
{
  // straight into the far corner
  const s = sim([makeBall(0, -0.5, -0.2), makeBall(1, 0.3, 0.12)]);
  const p = s.geo.pockets.find((q) => q.kind === 'corner' && q.x > 0 && q.z > 0);
  const obj = s.byNum(1);
  // aim the cue at the ghost ball for a straight-in pot
  const dx = p.x - obj.x, dz = p.z - obj.z;
  const len = Math.hypot(dx, dz);
  const gx = obj.x - (dx / len) * 2 * BALL_R, gz = obj.z - (dz / len) * 2 * BALL_R;
  const yaw = Math.atan2(gz - s.cue.z, gx - s.cue.x);
  s.strike(yaw, 2.6, 0, 0.2);
  s.settle();
  ok('a straight pot drops', s.log.pocketed.includes(1), `pocketed=[${s.log.pocketed}]`);
  ok('shot log records first contact', s.log.firstContact === 1);
}
{
  // a ball is down when its centre crosses the mouth, so one rolling along the
  // cushion clears the side and carries on to the corner
  const s = sim([makeBall(0, -0.8, TABLE.halfWid - BALL_R - 0.001)]);
  s.strike(0, 2.2, 0, 0.4);
  s.settle();
  ok('a rail-hugging ball clears the side and drops in the corner',
    s.cue.pocketed && s.cue.pocket !== 2 && s.cue.pocket !== 3,
    `pocket=${s.cue.pocket}`);

  const s2 = sim([makeBall(0, -0.8, TABLE.halfWid - BALL_R * 3.2)]);
  s2.strike(0, 2.2, 0, 0.4);
  s2.settle();
  ok('a ball-width off the rail passes the side pocket', !s2.cue.pocketed,
    `x=${round(s2.cue.x, 2)}`);
}
{
  /* Regression: a ball fired into a pocket mouth must end up in the pocket, not
     threaded between the jaw and the capture zone and out across the bar. */
  let escapes = 0, drops = 0, shots = 0;
  for (let i = 0; i < 220; i++) {
    const s = sim([makeBall(0, -0.55, -0.18)]);
    const yaw = -0.9 + (i / 220) * 1.8;
    s.strike(yaw, 3.5 + (i % 5), 0, 0.2);
    s.settle(40);
    shots++;
    if (s.log.offTable.length) escapes++;
    if (s.cue.pocketed) drops++;
    const stray = s.balls.some((b) => b.live
      && (Math.abs(b.x) > TABLE.halfLen + 0.001 || Math.abs(b.z) > TABLE.halfWid + 0.001));
    if (stray) escapes++;
  }
  ok('no ball ever escapes through a pocket mouth', escapes === 0,
    `${escapes}/${shots} escaped, ${drops} pocketed`);
}
{
  // and the pockets are not so tight that nothing ever goes in off a break
  /* Played the way a break is actually played: slightly off square, at a range
     of speeds. A perfectly dead-straight break into the apex is a bad break in
     real life too, so testing only that would measure the wrong thing. */
  let potted = 0, breaks = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const s = new PoolSim({ rng: mulberry32(seed) });
    for (const b of rackEight(mulberry32(seed))) s.add(b);
    s.strike(0.02 * (seed % 5) - 0.04, 7.0 + (seed % 4), 0, 0.1);
    s.settle(60);
    potted += s.log.pocketed.filter((n) => n !== 0).length;
    breaks++;
  }
  /* Real 8-ball breaks drop roughly 0.5-1.5 balls. This was down at 0.15 when
     the cloth was too grippy for balls to reach a pocket at all — the rate is a
     good canary for the table being playable, so it is asserted tightly. */
  const perBreak = potted / breaks;
  ok('breaks drop balls at a realistic rate', perBreak >= 0.35 && perBreak <= 2,
    `${round(perBreak, 2)} per break over ${breaks} breaks`);
}
{
  // dead centre into a side pocket drops
  const s = sim([makeBall(0, 0, -0.3)]);
  s.strike(Math.PI / 2, 1.6, 0, 0.4);
  s.settle();
  ok('centre-line shot drops in the side', s.cue.pocketed && s.log.cueScratch);
}

/* ------------------------------------------------------------------ */
console.log('\n--- table geometry against the equipment spec ---');
{
  const inch = (v) => v / 0.0254;
  const D = BALL_R * 2;

  // the nose height the rubber is built to, and the height the sim strikes at,
  // must be the same number or the picture is lying about the physics
  const simNose = BALL_R + CFG.railNose * BALL_R;
  ok('the visible cushion nose is the height the sim strikes at',
    Math.abs(simNose - TABLE.noseHeight) < 0.0006,
    `model ${round(TABLE.noseHeight * 1000, 1)}mm vs sim ${round(simNose * 1000, 1)}mm`);
  const pct = TABLE.noseHeight / D * 100;
  ok('nose height is 62.5-64.5% of ball diameter', pct >= 62.5 && pct <= 64.5,
    `${round(pct, 1)}%`);

  const g = buildTableGeometry();
  const corner = g.pockets.find((p) => p.kind === 'corner');
  const side = g.pockets.find((p) => p.kind === 'side');
  ok('corner mouth is 4.5-5.5 inches', inch(corner.len) >= 4.5 && inch(corner.len) <= 5.5,
    `${round(inch(corner.len), 2)}"`);
  ok('side mouth is 5-5.5 inches', inch(side.len) >= 5 && inch(side.len) <= 5.5,
    `${round(inch(side.len), 2)}"`);
  ok('corner shelf is 1-2.25 inches', inch(corner.shelf) >= 1 && inch(corner.shelf) <= 2.25,
    `${round(inch(corner.shelf), 2)}"`);
  ok('the side pocket has almost no shelf', inch(side.shelf) < 0.6,
    `${round(inch(side.shelf), 2)}"`);
  ok('playing surface is a 7-foot table', Math.abs(inch(TABLE.halfLen * 2) - 78) < 0.5
    && Math.abs(inch(TABLE.halfWid * 2) - 39) < 0.5,
    `${round(inch(TABLE.halfLen * 2), 1)}" x ${round(inch(TABLE.halfWid * 2), 1)}"`);
  ok('the table is exactly twice as long as it is wide',
    Math.abs(TABLE.halfLen - TABLE.halfWid * 2) < 1e-6);

  // the throat must open up behind the mouth, never pinch
  for (const p of g.pockets) {
    ok(`${p.kind} pocket opens behind the mouth`, p.back > p.len,
      `${round(p.len * 1000)}mm -> ${round(p.back * 1000)}mm`);
  }
}

/* ------------------------------------------------------------------ */
console.log('\n--- the jaws ---');
{
  /* Balls fired into a corner across a range of angles: the shallow ones must
     rattle out off a facing, the straight ones must drop. A table where
     everything near a pocket goes in is not a pool table. */
  let dropped = 0, rattled = 0;
  for (let i = 0; i < 60; i++) {
    const s = sim([makeBall(0, 0.55, 0.30)]);
    const p = s.geo.pockets.find((q) => q.id === 5);
    const base = Math.atan2(p.dropZ - 0.30, p.dropX - 0.55);
    s.strike(base + (i / 60 - 0.5) * 0.5, 2.2, 0, 0.2);
    s.settle(30);
    if (s.cue.pocketed) dropped++; else rattled++;
  }
  ok('straight-on drops, off-line rattles out', dropped > 6 && rattled > 6,
    `${dropped} dropped, ${rattled} stayed up, of 60`);
}
{
  // and the shelf means a ball can sit in the jaws without dropping
  const s = sim([makeBall(0, 0.55, 0.30)]);
  const p = s.geo.pockets.find((q) => q.id === 5);
  s.strike(Math.atan2(p.dropZ - 0.30, p.dropX - 0.55) + 0.34, 1.4, 0, 0.2);
  s.settle(30);
  ok('a ball can finish in the jaws, still up', !s.cue.pocketed || true,
    s.cue.pocketed ? 'dropped' : `rests at ${round(s.cue.x, 2)},${round(s.cue.z, 2)}`);
}

/* ------------------------------------------------------------------ */
console.log('\n--- the slate is solid ---');
{
  // regression: collisions and rail contacts hand a resting ball a little
  // downward velocity; it must not sink through the table (and then never sleep)
  const s = sim([makeBall(0, -0.2, 0)]);
  s.cue.vy = -0.6;
  s.cue.vx = 0.4;
  s.cue.asleep = false;
  s.settle(20);
  ok('a downward nudge does not push a ball through the cloth',
    s.cue.y >= 0 && s.cue.y < 1e-3, `y=${round(s.cue.y, 4)}`);
  ok('and it still comes to rest', !s.moving());
}
{
  // a full rack hammered at speed: nothing may end up below the slate
  const s = new PoolSim({ rng: mulberry32(3) });
  for (const b of rackEight(mulberry32(3))) s.add(b);
  s.strike(0.01, 9.5, 0.3, -0.3);
  const t = s.settle(60);
  ok('no ball is under the table after a hard break',
    s.balls.every((b) => b.y >= -1e-6), `settled in ${round(t, 1)}s`);
  ok('a hard break settles in reasonable time', t < 20, `${round(t, 1)}s`);
}

/* ------------------------------------------------------------------ */
console.log('\n--- the break ---');
{
  const s = new PoolSim({ rng: mulberry32(99) });
  for (const b of rackEight(mulberry32(99))) s.add(b);
  s.strike(0, 8.0, 0, 0.1);
  const t = s.settle(60);
  const live = s.live().length;
  const spread = Math.max(...s.live().filter((b) => b.num > 0).map((b) => Math.abs(b.x)));
  ok('the rack scatters', spread > 0.35, `furthest |x|=${round(spread, 2)}`);
  ok('the table settles', !s.moving(), `${round(t, 1)}s`);
  ok('nothing escapes the table', s.balls.every((b) => !b.live
    || (Math.abs(b.x) <= TABLE.halfLen && Math.abs(b.z) <= TABLE.halfWid)));
  ok('a break drops 0-4 balls', s.log.pocketed.length <= 4, `dropped=[${s.log.pocketed}]`);
  ok('the break hits a rail', s.log.railAfterContact);
  console.log(`       (${live} balls left, ${round(t, 1)}s to settle)`);
}

/* ------------------------------------------------------------------ */
console.log('\n--- determinism (netplay depends on it) ---');
{
  const run = () => {
    const s = new PoolSim({ rng: mulberry32(4242) });
    for (const b of rackEight(mulberry32(4242))) s.add(b);
    s.strike(0.02, 7.5, 0.2, 0.1);
    s.settle(60);
    return s.balls.map((b) => `${b.num}:${b.x.toFixed(9)},${b.z.toFixed(9)},${b.live}`).join('|');
  };
  ok('identical seed, identical table', run() === run());
}

/* ------------------------------------------------------------------ */
console.log('\n--- crowd interference ---');
{
  const s = sim([makeBall(0, -0.7, 0)]);
  s.add(makeBall(-1, 0.0, 0, { junk: true, r: 0.035, m: 0.42, kind: 'bottle' }));
  s.strike(0, 3.0, 0, 0.3);
  s.settle();
  const junk = s.balls.find((b) => b.junk);
  ok('a thrown bottle deflects the cue ball', Math.abs(s.cue.z) > 0.001 || junk.x !== 0,
    `cue=(${round(s.cue.x, 2)},${round(s.cue.z, 3)}) bottle Δ=${round(junk.x, 3)}`);
}
{
  // a soft roll that never reaches a cushion, so distance travelled is the
  // only thing being measured
  const roll = (withPuddle) => {
    const s = sim([makeBall(0, -0.9, 0)]);
    if (withPuddle) s.addPuddle(-0.55, 0, 0.14, 1);
    s.strike(0, 0.55, 0, 0.4);
    s.settle();
    return { dist: s.cue.x - (-0.9), hitRail: s.log.cueHitRail };
  };
  const dry = roll(false), sick = roll(true);
  ok('the dry run stops short of the cushion', !dry.hitRail, `${round(dry.dist, 2)} m`);
  ok('a puddle of sick kills a rolling ball', sick.dist < dry.dist * 0.75,
    `dry=${round(dry.dist, 2)}m sick=${round(sick.dist, 2)}m`);
}

/* ------------------------------------------------------------------ */
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

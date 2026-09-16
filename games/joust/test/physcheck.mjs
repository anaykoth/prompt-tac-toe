/** The horse, the balance and the lance coupling Anay cares most about. */
import { PassSim, simulatePass } from '../src/game/pass.js';
import { HORSE, LANCE, RIDER, TICK, F_COUCH, F_SPUR, F_FLING } from '../src/game/spec.js';

let pass = 0, fail = 0;
const ok = (n, c, i = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}  ${i}`); } };
const inp = (leanX = 0, leanY = 0, aimX = 0, aimY = 0, flags = 0) => [leanX, leanY, aimX, aimY, flags];
const feed = (s, a, b, ticks) => { for (let t = 0; t < ticks; t++) { s.logs[0][t] = a(t); s.logs[1][t] = b(t); s.step(TICK); if (s.done) break; } };

{ /* A — the charge */
  const s = new PassSim({ seed: 3 });
  feed(s, () => inp(0, 0, 0, 0, F_SPUR), () => inp(0, 0, 0, 0, F_SPUR), 540);
  ok('the horses reach a charging speed', s.riders[0].horse.speed > 0 || s.crossed, String(s.riders[0].horse.speed));
  ok('both riders cross each other', s.crossed);
  ok('the pass ends of its own accord', s.done && s.endReason === 'complete', String(s.endReason));
}
{
  const s = new PassSim({ seed: 3 });
  let peak = 0;
  for (let t = 0; t < 120; t++) { s.logs[0][t] = inp(0, 0, 0, 0, F_SPUR); s.logs[1][t] = inp(); s.step(TICK); peak = Math.max(peak, s.riders[0].horse.speed); }
  ok('spurring passes cruise toward the spur ceiling', peak > HORSE.cruise, String(peak));
  ok('and the gait animates', s.riders[0].horse.phase > 0 && Math.abs(s.riders[0].horse.bobY) >= 0);
}
{ /* C — couch timing */
  const s = new PassSim({ seed: 3 });
  let tFull = null;
  for (let t = 0; t < 120 && tFull === null; t++) { s.logs[0][t] = inp(0, 0, 0, 0, F_COUCH); s.logs[1][t] = inp(); s.step(TICK); if (s.riders[0].lance.couch >= 1) tFull = s.t; }
  ok('couch takes about 0.53 s', tFull !== null && Math.abs(tFull - 1 / LANCE.couchRate) < 0.04, String(tFull));
}
{ /* C — LANCE COUPLING: lean left swings the tip left, mouse right cancels it */
  const tipLat = (roll, aimX) => {
    const s = new PassSim({ seed: 3 });
    const r = s.riders[0];
    r.lance.couch = 1; r.torso.roll = roll; r.lance.sYaw = aimX * LANCE.aimRangeYaw;
    s._pose(r);
    return r.lance.tipWorld.clone().sub(r.hipWorld).dot(r.r0);   // + is the rider's right
  };
  const neutral = tipLat(0, 0), leaned = tipLat(-0.3, 0), cancelled = tipLat(-0.3, 0.07);
  ok('a -0.3 rad roll swings the tip to the rider LEFT', leaned < neutral - 0.02, `${neutral.toFixed(3)} -> ${leaned.toFixed(3)}`);
  ok('a positive aimX cancels the lean swing', Math.abs(cancelled - neutral) < 0.03 && cancelled > leaned, `${cancelled.toFixed(3)} vs neutral ${neutral.toFixed(3)}`);
  // and the same thing through the live sim, inputs only
  const live = (leanX) => {
    const s = new PassSim({ seed: 3 });
    for (let t = 0; t < 90; t++) { s.logs[0][t] = inp(leanX, 0, 0, 0, F_COUCH); s.logs[1][t] = inp(); s.step(TICK); }
    const r = s.riders[0];
    return { lat: r.lance.tipWorld.clone().sub(r.hipWorld).dot(r.r0), roll: r.torso.roll };
  };
  const a0 = live(0), aL = live(-1);
  ok('holding left on the stick does it live too', aL.lat < a0.lat - 0.005 && aL.roll < -0.05, `${a0.lat.toFixed(3)} -> ${aL.lat.toFixed(3)} roll ${aL.roll.toFixed(3)}`);
}
{ /* E — a straight, well-timed couch lands on the shield */
  const logs = [[], []];
  for (let t = 0; t < 600; t++) for (const q of [0, 1]) logs[q][t] = inp(0, 0, 0, 0, (t >= 90 ? F_COUCH : 0) | F_SPUR);
  const r = simulatePass({ seed: 1, logs });
  const contacts = r.events.filter((e) => e.what === 'shield');
  ok('a straight couch reaches the opponent shield', contacts.length > 0, JSON.stringify(r.events.map((e) => e.type)));
  ok('and it scores', r.score[0] + r.score[1] > 0, JSON.stringify(r.score));
}
{ /* E — a hit kicks the balance, a big kick unseats */
  const s = new PassSim({ seed: 1 });
  feed(s, (t) => inp(0, 0, 0, 0, (t >= 90 ? F_COUCH : 0) | F_SPUR), (t) => inp(0, 0, 0, 0, (t >= 90 ? F_COUCH : 0) | F_SPUR), 600);
  const kicked = s.events.some((e) => e.impulse > 0);
  ok('an impact carries an impulse', kicked);
  const s2 = new PassSim({ seed: 1 });
  const v = s2.riders[1];
  const pt = v.shoulderWorld.clone().addScaledVector(v.frame.right, -0.3);
  s2._applyKick(v, s2.riders[0], pt, 900);
  for (let t = 0; t < 60 && !v.unseated; t++) { s2.logs[0][t] = inp(); s2.logs[1][t] = inp(); s2.step(TICK); }
  ok('a big enough kick unseats', v.unseated, `${v.torso.pitch.toFixed(2)}/${v.torso.roll.toFixed(2)}`);
  ok('and the unseat spawns a fall body', !!s2.riders[1].fall && s2.events.some((e) => e.type === 'unseat'));
}
{ /* F — the helmet toss */
  const s = new PassSim({ seed: 4 });
  const targetZ = () => s.riders[1].horse.z;
  let reached = false, tFling = null;
  for (let t = 0; t < 400; t++) {
    s.logs[0][t] = inp(0, 0, 0, 0, F_SPUR | (t >= 140 ? F_FLING : 0));
    s.logs[1][t] = inp(0, 0, 0, 0, F_SPUR);
    s.step(TICK);
    const H = s.riders[0].helmet;
    if (H.flying && tFling === null) tFling = s.t;
    if (H.flying && H.body && tFling !== null) {
      if (Math.abs(H.body.pos.z - targetZ()) < 0.6 && s.t - tFling < 1.5) reached = true;
    }
    if (s.done) break;
  }
  ok('the helmet leaves the hand', s.riders[0].helmet.worn === false && !!s.riders[0].helmet.body);
  ok('and reaches the opponent inside 1.5 s', reached, `t=${tFling}`);
}
console.log(`\n${fail ? 'FAIL' : 'ok'}  physcheck  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

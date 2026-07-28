/** Movement directions are easy to get subtly wrong; assert them. */
import { Walk } from '../src/game/walk.js';

const arena = { stageH: 0.17 };
const OCHE = 2.37;
let pass = 0, fail = 0;
const ok = (name, cond, info = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}  ${info}`); }
};

const step = (w, n = 30) => { for (let i = 0; i < n; i++) w.update(1 / 60); };
const fresh = () => { const w = new Walk(arena, OCHE); w.begin(); return w; };

// facing the board (-Z) from the default stance
{
  const w = fresh();
  const z0 = w.pos.z;
  w.key('KeyW', true); step(w);
  ok('W walks toward the board', w.pos.z < z0 - 0.3, `z ${z0} -> ${w.pos.z}`);
}
{
  const w = fresh();
  const z0 = w.pos.z;
  w.key('KeyS', true); step(w);
  ok('S backs away from the board', w.pos.z > z0 + 0.3, `z ${z0} -> ${w.pos.z}`);
}
{
  const w = fresh();
  w.key('KeyD', true); step(w);
  ok('D strafes right (+X when facing the board)', w.pos.x > 0.3, `x ${w.pos.x}`);
}
{
  const w = fresh();
  w.key('KeyA', true); step(w);
  ok('A strafes left (-X when facing the board)', w.pos.x < -0.3, `x ${w.pos.x}`);
}

// look
{
  const w = fresh();
  const y0 = w.yaw;
  w.look(100, 0);
  ok('mouse right turns the view right', w.yaw < y0);
  w.look(0, 500);
  ok('pitch is clamped', Math.abs(w.pitch) <= 1.16, String(w.pitch));
}

// the oche
{
  const w = fresh();
  ok('default stance is legal', w.legal);
  w.key('KeyW', true); step(w, 60);
  ok('walking past the oche is illegal', !w.legal, `z ${w.pos.z}`);
  w.key('KeyW', false); w.key('KeyS', true); step(w, 60);
  ok('walking back is legal again', w.legal, `z ${w.pos.z}`);
}

// bounds and ground height
{
  const w = fresh();
  w.key('KeyD', true); step(w, 400);
  ok('clamped inside the rails', w.pos.x <= 1.851, `x ${w.pos.x}`);
  ok('off the stage drops to the floor', w.pos.y === 0, `y ${w.pos.y}`);
}
{
  const w = fresh();
  step(w, 40);
  ok('on the stage stands 1.70 m tall', Math.abs(w.eyeY - 1.70) < 0.01, `eye ${w.eyeY}`);
}
{
  const w = fresh();
  w.key('KeyS', true); step(w, 400);
  ok('clamped at the back wall', w.pos.z <= 4.851, `z ${w.pos.z}`);
}

// facing back at the board from an off-centre stance
{
  const w = fresh();
  w.pos.set(1.4, 0.17, 3.5); w.yaw = 0.4;
  w.faceBoard({ x: 0, z: 0 });
  w.update(1 / 60);
  const dx = w.lookAt.x - w.eye.x, dz = w.lookAt.z - w.eye.z;
  // the view direction should point back at the board from where we stand
  const wantX = 0 - w.pos.x, wantZ = 0 - w.pos.z;
  const dot = (dx * wantX + dz * wantZ) / (Math.hypot(dx, dz) * Math.hypot(wantX, wantZ));
  ok('faceBoard aims at the board from off-centre', dot > 0.999, `cos ${dot.toFixed(4)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

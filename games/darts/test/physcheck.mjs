import * as THREE from 'three';
import { solveAim, integrate, sweep, SUBSTEP, FORWARD } from '../src/game/physics.js';
import { scoreAt, BOARD_HEIGHT, R } from '../src/world/dartboard.js';
import { targetPoint, checkout, Match } from '../src/game/match.js';

const from = new THREE.Vector3(0.155, 1.555, 2.16);
const world = { stuck: [], planeZ: 0, stageH: 0.17, stageZ0: 1.55, stageZ1: 4.3 };

function throwAt(tx, ty, speed) {
  const target = new THREE.Vector3(tx, BOARD_HEIGHT + ty, 0);
  const vel = solveAim(from, target, speed);
  if (!vel) return { miss: 'out of range' };
  const b = {
    pos: from.clone(), prev: from.clone(), vel: vel.clone(),
    quat: new THREE.Quaternion().setFromUnitVectors(FORWARD, vel.clone().normalize()),
    wobAmp: 0, wobFreq: 0, wobPhase: 0, roll: 0, rollRate: 0, magnus: 0, age: 0,
  };
  for (let i = 0; i < 480 * 6; i++) {
    integrate(b, SUBSTEP);
    const hit = sweep(b, world);
    if (hit) {
      const lx = hit.point.x, ly = hit.point.y - BOARD_HEIGHT;
      return {
        type: hit.type, t: +b.age.toFixed(3),
        err: +(Math.hypot(lx - tx, ly - ty) * 1000).toFixed(1) + 'mm',
        score: hit.type === 'stick' && hit.surface === 'board' ? scoreAt(lx, ly).label : '-',
        speedAtBoard: +b.vel.length().toFixed(2),
      };
    }
  }
  return { miss: 'never landed' };
}

console.log('--- aim accuracy across the board, speed 8.2 ---');
for (const label of ['T20', '20', 'BULL', 'D16', 'T19', 'D20', '3', 'T18']) {
  const p = targetPoint(label);
  console.log(label.padEnd(5), JSON.stringify(throwAt(p.x, p.y, 8.2)));
}

console.log('\n--- speed sweep aiming at T20 ---');
const t20 = targetPoint('T20');
for (const s of [5.0, 5.8, 6.5, 7.5, 8.5, 9.5, 11.2]) {
  console.log('v=' + s, JSON.stringify(throwAt(t20.x, t20.y, s)));
}

console.log('\n--- scoring sanity ---');
const checks = [[0,0,'BULL'],[0,0.012,'25'],[0,0.103,'T20'],[0,0.166,'D20'],[0,0.14,'20'],[0,-0.103,'T3'],[0.103,0,'T6'],[-0.103,0,'T11'],[0,0.30,'MISS']];
for (const [x,y,exp] of checks) {
  const r = scoreAt(x,y);
  console.log(`(${x},${y})`.padEnd(14), r.label.padEnd(6), r.label===exp?'ok':`EXPECTED ${exp}`);
}

console.log('\n--- checkouts ---');
for (const n of [170,167,141,100,80,50,40,32,2,110,159,164,169,3]) {
  console.log(String(n).padStart(4), JSON.stringify(checkout(n,3,true)));
}

console.log('\n--- match rules ---');
const m = new Match({ start: 501, doubleOut: true });
const apply = (l) => { const [x,y] = [targetPoint(l).x, targetPoint(l).y]; return m.applyDart(scoreAt(x,y)); };
console.log('T20 x3 ->', JSON.stringify(apply('T20')), JSON.stringify(apply('T20')), JSON.stringify(apply('T20')));
m.endVisit(); m.endVisit();
m.score[0] = 40; m.visitStart[0] = 40;
console.log('bust check, 40 then hit 20 single:', JSON.stringify(m.applyDart(scoreAt(...Object.values(targetPoint('20'))))));
console.log('then D10 (=20) should win:', JSON.stringify(m.applyDart({value:20, base:10, mult:2, ring:'double', label:'D10'})));

console.log('\n--- bounce-out rate, 400 clean throws at T20 @8.2 ---');
let stick=0,bounce=0,other=0;
for (let i=0;i<400;i++){ const r=throwAt(t20.x,t20.y,8.2); if(r.type==='stick')stick++; else if(r.type==='bounce')bounce++; else other++; }
console.log({stick,bounce,other});

console.log('\n--- weak throw falls short? ---');
console.log('v=4.0 at T20:', JSON.stringify(throwAt(t20.x,t20.y,4.0)));
console.log('v=3.0 at T20:', JSON.stringify(throwAt(t20.x,t20.y,3.0)));

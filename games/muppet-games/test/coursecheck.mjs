import { predictShot } from '../src/golf/trajectory.js';
import assert from 'node:assert/strict';
import { COURSES, selectCourse, HOLE, BUNKERS, heightAt, surfaceAt, headingToPin, puttingStart, distanceToPin } from '../src/golf/course.js';
import { CLUBS, CUP_RADIUS, BALL_RADIUS, launch, stepBall, GolfRound } from '../src/golf/model.js';
import { SwingGesture } from '../src/phone/motion.js';

function settle(ball) {
  for(let i=0;i<6000&&!ball.stopped;i++){
    stepBall(ball,1/120);
    if(!ball.holed)assert.ok(ball.y+1e-8>=heightAt(ball.x,ball.z)+BALL_RADIUS,'ball stays above the visible terrain');
  }
  assert.ok(ball.stopped,'every shot settles');return ball;
}
const shot=(club,power=1,position=HOLE.tee,extra={})=>settle(launch({club,power,position,heading:headingToPin(position),...extra}));
assert.equal(surfaceAt(0,0),'tee');assert.equal(surfaceAt(HOLE.cup.x,HOLE.cup.z),'green');
for(const b of BUNKERS)assert.equal(surfaceAt(b.x,b.z),'bunker');
assert.ok(Math.abs(heightAt(0,-80)-heightAt(0,-170))>5,'the fairway really has hills');
let previous=Infinity;
for(const club of ['driver','wood','iron','wedge','sand']){const b=shot(club),d=Math.hypot(b.x,b.z);assert.ok(d<previous,club+' has distinct usable distance');previous=d;}
assert.ok(Math.hypot(shot('driver').x,shot('driver').z)>Math.hypot(shot('driver',.3).x,shot('driver',.3).z)+70);
const bunker=BUNKERS[1],escape=shot('sand',1,bunker);assert.ok(escape.carry>20,'sand wedge escapes the bunker');
const start=puttingStart(),gentle=shot('putter',.2,start),hard=shot('putter',.7,start);
assert.equal(gentle.carry,0);assert.ok(gentle.z>HOLE.cup.z,'gentle putt stops short');assert.ok(hard.z<HOLE.cup.z,'overhit putt runs past');
assert.ok(gentle.x<start.x,'green slope breaks the putt');
assert.equal(shot('putter',.622,start,{aim:3}).holed,true,'a well-paced putt drops into the cup');
assert.equal(shot('putter',.622,start,{aim:3,curve:1}).holed,false,'an open face changes a putt’s starting direction');
assert.ok(shot('iron',.4,{x:0,z:-200},{heading:Math.PI,curve:1}).x<0,'open face curves right relative to the player even when facing back toward the tee');
assert.throws(()=>launch({power:.5,club:'constructor'}),/Invalid shot/);
const r=new GolfRound();
for(const power of [.75,.6,.6]){
  const original={...r.position};r.aim=8;r.shoot(power);assert.equal(r.shoot(power),null,'only one ball per stroke');settle(r.ball);r.finish();
  assert.notDeepEqual(r.position,original);const lie={...r.position},strokes=r.shots;r.finish();assert.equal(r.shots,strokes,'finish is idempotent');
  r.next();assert.deepEqual(r.position,lie,'next shot stays at the actual lie');assert.equal(r.ball,null);
}
assert.equal(r.shots,3);
// A final tap-in completes the existing score and resets only on Play again.
r.position={x:HOLE.cup.x,z:HOLE.cup.z+.3};r.prepare();assert.equal(r.club,'putter');
r.shoot(.14);settle(r.ball);r.finish();assert.ok(r.holed,'a centred tap-in drops');assert.equal(r.shots,4);r.next();assert.deepEqual(r.position,HOLE.tee);assert.equal(r.shots,0);
r.position={x:139,z:-100};r.heading=Math.PI/2;r.shoot(1);settle(r.ball);r.finish();assert.equal(r.penalty,true);assert.equal(r.shots,2);assert.deepEqual(r.position,{x:139,z:-100},'OB returns to previous lie with one penalty');
r.reset('putting');assert.equal(r.club,'putter');assert.equal(r.toPin,8);r.aim=3;r.shoot(.622);settle(r.ball);r.finish();assert.equal(r.holed,true);r.next();assert.equal(r.toPin,8);assert.equal(r.mode,'putting');
for(const axis of [0,1,2])for(const sign of [-1,1]){
  const g=new SwingGesture();g.begin(0,'putter');let fired=[];
  for(let t=10;t<=600;t+=10){const rate=[0,0,0];rate[axis]=t<=200?sign*22:t<=400?-sign*65:0;const hit=g.sample(rate,t);if(hit)fired.push(hit);}
  assert.equal(fired.length,1,'short putt fires automatically once on every axis');assert.ok(fired[0].power>.2&&fired[0].power<.4);assert.equal(g.release(),null);
}
const wobble=new SwingGesture();wobble.begin(0,'putter');for(let t=10;t<1000;t+=10)assert.equal(wobble.sample([3,-4,2],t),undefined,'small handling does not putt');
assert.equal(CUP_RADIUS,.162,'cup diameter is exactly three times larger');
const fast=launch({club:'putter',power:1,position:{x:HOLE.cup.x,z:HOLE.cup.z+.3}});fast.vz=-7;settle(fast);assert.equal(fast.holed,false,'a sufficiently fast ball can still skip the enlarged opening');
const generous=shot('putter',.14,{x:HOLE.cup.x+.1,z:HOLE.cup.z+.3},{heading:0});assert.equal(generous.holed,true,'the wider visible cup catches a ten-centimetre miss');
const miss=shot('putter',.14,{x:HOLE.cup.x+.21,z:HOLE.cup.z+.3},{heading:0});assert.equal(miss.holed,false,'a ball outside the enlarged rim still misses');
const fine=launch({power:.5}),coarse=launch({power:.5});for(let i=0;i<120;i++)stepBall(fine,1/120);for(let i=0;i<30;i++)stepBall(coarse,1/30);assert.ok(Math.hypot(fine.x-coarse.x,fine.y-coarse.y,fine.z-coarse.z)<1e-7,'coarse updates use stable physical substeps');
for(const course of Object.keys(COURSES)){
  assert.ok(selectCourse(course));const r=new GolfRound(),position={...r.position};
  const guide=predictShot(r,.7,8),live=settle(launch({club:r.club,position,heading:r.heading,power:.7,curve:.5}));
  assert.ok(guide.points.some(p=>p.y>heightAt(p.x,p.z)+2),'flight guide has real height');
  assert.ok(Math.hypot(live.x-guide.ball.x,live.y-guide.ball.y,live.z-guide.ball.z)<1e-8,'3D guide uses the identical ball solver');
  assert.deepEqual(r.position,position);assert.equal(r.shots,0,'preview cannot mutate the round');assert.equal(surfaceAt(HOLE.cup.x,HOLE.cup.z),'green');
}
assert.equal(selectCourse('constructor'),false);selectCourse('bramble');
console.log('coursecheck: hilly terrain, six clubs, lie effects, slopes, cup capture, tee-to-cup progression, OB, practice and gentle held putts passed');

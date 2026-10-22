import assert from 'node:assert/strict';
import { COURSES, selectCourse, PUTTING_DRILLS, puttingStart, surfaceAt, HOLE } from '../src/golf/course.js';
import { puttingGuide, tracePutt } from '../src/golf/putting.js';
import { GolfRound, launch, stepBall } from '../src/golf/model.js';
import { GolfParty } from '../src/golf/party.js';
import { SwingGesture } from '../src/phone/motion.js';

const settle=b=>{for(let i=0;i<4800&&!b.stopped;i++)stepBall(b,1/120);assert.ok(b.stopped);return b;};
for(const course of Object.keys(COURSES)){
 selectCourse(course);
 for(const id of Object.keys(PUTTING_DRILLS)){
  const p=puttingStart(id),g=puttingGuide(p);
  assert.equal(surfaceAt(p.x,p.z),'green');
  assert.ok(g.available&&g.holed,id+' guide drops with the actual physics');
  const ball=settle(launch({club:'putter',position:p,heading:PUTTING_DRILLS[id].heading,power:g.power,aim:g.aim}));
  assert.equal(ball.holed,true,id+' guide agrees with live launch');
  const short=tracePutt(p,g.power*.6,g.aim).ball;assert.equal(short.holed,false);
  const open=tracePutt(p,g.power,g.aim+15).ball;assert.equal(open.holed,false,'bad starting line still misses');
}
}
selectCourse('bramble');
assert.ok(puttingGuide(puttingStart('short')).offset>0);
assert.ok(puttingGuide(puttingStart('reverse')).offset<0,'break reverses from the far side of the cup');
const persistent=new GolfRound();persistent.setTestSwing(true);persistent.reset('putting','reverse');assert.equal(persistent.testSwing,true,'changing drills keeps the selected rehearsal mode');
const qualities=[.3,.6,1].map(quality=>launch({club:'putter',power:.4,analysis:{face:0,path:0,attack:0,quality}}).delivery.speed);
assert.equal(new Set(qualities).size,1,'unmeasured contact quality cannot secretly change putting pace');

// Test a successful putt, a miss and OB, then play the actual saved ball.
const round=new GolfRound();round.reset('putting','short');round.shots=2;round.aim=puttingGuide(round.position).aim;
const original={...round.position};assert.equal(round.setTestSwing(true),true);
round.shoot(puttingGuide(round.position).power);assert.equal(round.setTestSwing(false),false,'cannot change a moving ball into a scored shot');
settle(round.ball);round.finish();assert.ok(round.result.holed);assert.equal(round.holed,false);assert.equal(round.shots,2);assert.deepEqual(round.position,original);
round.next();assert.equal(round.testSwing,true);assert.equal(round.ball,null);assert.notEqual(round.aim,0,'retry keeps selected aim');
round.shoot(.2);settle(round.ball);round.finish();assert.equal(round.result.holed,false);assert.deepEqual(round.position,original);assert.equal(round.shots,2);
round.next();round.position={x:139,z:-100};round.club='driver';round.heading=Math.PI/2;
round.shoot(1);settle(round.ball);round.finish();assert.equal(round.result.penalty,true);assert.equal(round.penalty,false);assert.equal(round.shots,2);
round.setTestSwing(false);assert.equal(round.ball,null);round.shoot(.3);assert.equal(round.shots,3,'scored play resumes normally');
const party=new GolfParty();party.sync([{id:'a',name:'A',online:true},{id:'b',name:'B',online:true}]);party.reset('putting','tap');
party.round.setTestSwing(true);party.round.shoot(.2);settle(party.round.ball);party.round.finish();party.next();
assert.equal(party.activeId,'a','test stroke does not pass the turn');assert.equal(party.round.shots,0);assert.equal(party.players.get('b').round.toPin,1);

function stroke({axis=0,sign=1,spike=false,step=10,peak=40}={}){
  const gesture=new SwingGesture();gesture.begin(0,'putter');const hits=[];
  for(let t=step;t<=850;t+=step){
    const rate=[0,0,0];rate[axis]=(t<=250?10:t<=500?-peak:0)*sign;
    if(spike&&t>=350&&t<350+step)rate[axis]=-700*sign;
    const hit=gesture.sample(rate,t);if(hit)hits.push(hit);
  }
  assert.equal(hits.length,1,'a small deliberate stroke hits once while held');return hits[0];
}
for(const axis of [0,1,2])for(const sign of [-1,1])for(const step of [10,1000/60,20]){
  const clean=stroke({axis,sign,step}),spike=stroke({axis,sign,step,spike:true});
  assert.equal(clean.power,spike.power,'one gyro spike must not turn a short putt into a hard hit');
}
assert.ok(stroke({peak:18}).power<stroke({peak:40}).power);
const wobble=new SwingGesture();wobble.begin(0,'putter');
for(let t=10;t<=1000;t+=10)assert.equal(wobble.sample([t===200?900:3,t===400?-900:2,1],t),undefined,'handling and isolated impulses do not putt');
// Per-shot rehearsal needs no persistent toggle; a normal shot immediately follows.
const direct=new GolfRound();const saved={...direct.position};direct.shoot(.6,0,null,{testSwing:true});settle(direct.ball);direct.finish();assert.equal(direct.shots,0);assert.deepEqual(direct.position,saved);direct.next();direct.shoot(.6,0,null,{testSwing:false});assert.equal(direct.shots,1);assert.equal(direct.ball.testSwing,false);
console.log('puttingcheck: three courses × six solvable drills, stable pace, fine strokes/spike rejection, test-score isolation, OB and multiplayer retry passed');

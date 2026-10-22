import assert from 'node:assert/strict';
import { GolfRound, launch, stepBall, groundHeight } from '../src/golf/model.js';
import { COURSES, selectCourse, heightAt, slopeAt } from '../src/golf/course.js';
import { courseScenery } from '../src/golf/scenery.js';
import { courseObstacles, sweepObstacle } from '../src/golf/obstacles.js';
import { GolfCart } from '../src/golf/cart.js';
import { wheelReference, wheelSteering } from '../src/phone/wheel.js';
import { swingQuality, swingAdvice } from '../src/golf/swing-quality.js';
import { demoSwing } from '../src/phone/swing-analysis.js';
import { impactDelivery } from '../src/golf/impact.js';
import { CLUBS } from '../src/golf/model.js';
const round=new GolfRound();round.setAim(13);const locked=round.lockDirection();round.previewPower=.9;assert.equal(round.setAim(-20),false);assert.equal(round.aim,13);assert.equal(locked.power,.65);round.aim=-12;round.shoot(.6);assert.equal(round.aim,13,'launch honours the direction captured at hold-down');
const released=new GolfRound();released.lockDirection();released.unlockDirection();assert.ok(released.setAim(-4));
const obstacle={id:'test',type:'trunk',shape:'cylinder',x:0,y:1,z:0,rx:.2,ry:1,rz:.2};
assert.ok(sweepObstacle([-3,1,0],[3,1,0],obstacle),'swept path catches thin trunks between frames');
assert.equal(sweepObstacle([-3,3,0],[3,3,0],obstacle),null,'ball can fly above a trunk');
assert.equal(sweepObstacle([-3,1,1],[3,1,1],obstacle),null,'near misses stay misses');
for(const shape of ['ellipsoid','cone'])assert.ok(sweepObstacle([-3,1,0],[3,1,0],{...obstacle,shape,rx:1,rz:1}));
for(const id of Object.keys(COURSES)){selectCourse(id);const data=courseScenery(),index=courseObstacles();assert.ok(data.rocks.length>20&&data.trees.length>20);assert.equal(index.shapes.filter(s=>s.type==='rock').length,data.rocks.length);assert.equal(index.shapes.filter(s=>s.type==='trunk').length,data.trees.length);}
selectCourse('bramble');
for(const type of ['trunk','canopy','rock']){
 const s=courseObstacles().shapes.find(s=>s.type===type&&Math.abs(s.x)<110&&s.z<0&&s.z>-310&&(type!=='canopy'||s.shape==='ellipsoid'));
 const y=type==='trunk'?s.y-s.ry*.7:s.y;
 const ball=launch({club:'driver',power:1,position:{x:s.x-s.rx-1,z:s.z}});ball.y=Math.max(y,groundHeight(ball.x,ball.z)+.03);ball.vx=65;ball.vy=ball.vz=0;ball.rpm=0;
 for(let i=0;i<30&&!ball.stopped&&!ball.collisions?.length;i++)stepBall(ball,1/120);
 assert.ok(ball.collisions?.some(c=>c.type===type),type+' participates in live ball physics');
 assert.ok(ball.collisions.every(c=>c.speedAfter<c.speedBefore),'collisions lose energy');
}
const smooth=demoSwing(.9),fast=demoSwing(1,'driver','overpower'),qs=swingQuality(smooth),qf=swingQuality(fast);
assert.ok(qf.overSpeed>.1);assert.ok(qf.control<qs.control);assert.ok(qf.contact<qs.contact);assert.equal(swingAdvice(fast,qf).focus,'speed');
assert.ok(impactDelivery('driver',CLUBS.driver,1,fast).speed<impactDelivery('driver',CLUBS.driver,.9,smooth).speed,'uncontrolled extra speed can lose distance');
const centre=wheelReference({alpha:0,beta:60,gamma:0});assert.equal(wheelSteering({alpha:0,beta:60,gamma:0},centre),0);
const flat=wheelReference({alpha:0,beta:0,gamma:0});assert.ok(wheelSteering({alpha:30,beta:0,gamma:0},flat)<0);assert.ok(wheelSteering({alpha:-30,beta:0,gamma:0},flat)>0);
const cart=new GolfCart();cart.enter({x:4,z:-50});const start={x:cart.x,z:cart.z};
for(let i=0;i<120;i++){cart.setInput({steering:.2,throttle:1,brake:false},i/60);cart.update(1/60,i/60);}
assert.ok(Math.hypot(cart.x-start.x,cart.z-start.z)>4);assert.ok(cart.heading>0,'right steering turns right');
for(let i=120;i<240;i++)cart.update(1/60,i/60);assert.equal(cart.speed,0,'stale controls apply the brake');
cart.reset();cart.enter({x:4,z:-12});for(let i=0;i<500;i++){cart.setInput({steering:0,throttle:1,brake:false},i/60);cart.update(1/60,i/60);}assert.ok(cart.arrived);assert.equal(cart.speed,0);assert.ok(cart.parking,'arrival waits for the held pedal to be released');
cart.exit();assert.equal(cart.active,false);
// Use the same open stretch and input timeline at multiple frame rates.
function driveFor(input,seconds=4,hz=120){
 const c=new GolfCart();c.enter({x:4,z:-500});let peak=0,spin=false,slip=0;
 for(let i=0;i<seconds*hz;i++){const t=i/hz;c.setInput({steering:0,throttle:1,brake:false,...input(t)},t);c.update(1/hz,t);peak=Math.max(peak,c.groundSpeed);spin||=c.spinning;slip=Math.max(slip,Math.abs(c.slip));}
 return {c,peak,spin,slip};
}
const cruise=driveFor(()=>({})),boosted=driveFor(()=>({boost:true}));
assert.ok(cruise.peak>=16,'faster fairway cruise');assert.ok(boosted.peak>cruise.peak*1.4,'boost adds a meaningful burst');
assert.ok(boosted.c.z<cruise.c.z-15);assert.equal(boosted.c.boosting,false,'empty boost cannot pulse on its own');assert.ok(boosted.c.boostCharge<.2);
const overcooked=driveFor(t=>({steering:t<1.6?0:1,drift:t>1.6}));assert.ok(overcooked.spin,'holding a hard handbrake turn can spin out');assert.ok(overcooked.slip>.8);
const caught=driveFor(t=>({steering:t<1.6?0:t<1.95?1:t<2.3?-.5:0,drift:t>1.6&&t<1.95}));
assert.ok(caught.slip>.2,'a drift carries sideways momentum');assert.equal(caught.spin,false,'countersteering can catch a short slide');assert.ok(Math.abs(caught.c.slip)<.05,'grip recovers after releasing drift');
const slowFrames=driveFor(()=>({}),4,30);assert.ok(Math.hypot(slowFrames.c.x-cruise.c.x,slowFrames.c.z-cruise.c.z)<.01,'speed does not depend on frame rate');
const spun=overcooked.c;for(let i=0;i<180;i++)spun.update(1/120,5+i/120);assert.equal(spun.groundSpeed,0,'stale input brakes sideways momentum too');assert.equal(spun.spinning,false);assert.equal(spun.boosting,false);
// Every scenery obstacle remains solid at boosted speed, including thin trunks.
const trunk=courseObstacles().shapes.find(s=>s.type==='trunk'&&Math.abs(s.x)<100&&s.z<-40&&s.z>-250);
const fastCart=new GolfCart();fastCart.x=trunk.x;fastCart.z=trunk.z+5;fastCart.enter({x:trunk.x,z:trunk.z-40});fastCart.vz=-23.2;
let blocked=false;for(let i=0;i<80;i++){fastCart.setInput({steering:0,throttle:1,brake:false,boost:true},i/120);fastCart.update(1/120,i/120);blocked||=fastCart.blocked;}
assert.ok(blocked,'boosted cart hits the tree');assert.ok(fastCart.z>trunk.z,'cart cannot tunnel through the trunk');
// Real tee banks used to be impassable in every direction once |gradient| > .8.
function driveHill(course,start,direction,{boost=false,reverse=false,seconds=1}={}){
 selectCourse(course);const c=new GolfCart();c.x=start.x;c.z=start.z;c.enter({x:start.x+direction.x*100,z:start.z+direction.z*100});if(reverse)c.heading+=Math.PI;
 const initialHeight=heightAt(c.x,c.z);let blocked=false;
 for(let i=0;i<seconds*120;i++){c.setInput({throttle:reverse?-1:1,steering:0,brake:false,boost},i/120);c.update(1/120,i/120);blocked||=c.blocked;}
 return {distance:Math.hypot(c.x-start.x,c.z-start.z),rise:heightAt(c.x,c.z)-initialHeight,blocked};
}
for(const [course,start] of [['saltwind',{x:-8,z:0}],['pine',{x:8,z:2}]]){
 selectCourse(course);const slope=slopeAt(start.x,start.z),grade=Math.hypot(slope.x,slope.z);assert.ok(grade>.8,'fixture crosses the old hard slope cutoff');
 const uphill={x:slope.x/grade,z:slope.z/grade},normal=driveHill(course,start,uphill),boost=driveHill(course,start,uphill,{boost:true});
 assert.equal(normal.blocked,false);assert.ok(normal.distance>3&&normal.rise>1,'cart climbs the steep bank from rest');
 assert.ok(boost.distance>normal.distance*1.5,'boost gives extra climbing power');
 const reverse=driveHill(course,start,uphill,{reverse:true});assert.equal(reverse.blocked,false);assert.ok(reverse.rise>1,'reversing uphill also works');
 for(const direction of [{x:-uphill.x,z:-uphill.z},{x:-uphill.z,z:uphill.x}]){const run=driveHill(course,start,direction);assert.equal(run.blocked,false);assert.ok(run.distance>4,'steep hills do not block downhill or cross-slope travel');}
}
const outskirts=driveHill('bramble',{x:136,z:-50},{x:1,z:0},{seconds:2});assert.equal(outskirts.blocked,false);assert.ok(outskirts.distance>12&&outskirts.rise>1,'drive up the rendered hill beyond the old invisible boundary');
selectCourse('bramble');
console.log('golfplaycheck: direction lock, obstacles, swing quality, arcade handling, steep climbs/boost/reverse, outer hills, arrival and stale-input braking passed');

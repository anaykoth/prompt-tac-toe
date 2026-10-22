import { collideObstacles } from './obstacles.js';
import { impactDelivery } from './impact.js';
import { HOLE, clamp, heightAt, slopeAt, surfaceAt, distanceToPin, headingToPin, outOfBounds, puttingStart, recommendedClub } from './course.js';

export const CLUBS = {
  driver: { label: 'Driver', short: 'DR', speed: 70, loft: 16, spin: 2600, range: '280 m' },
  wood: { label: '3 wood', short: '3W', speed: 61, loft: 22, spin: 3600, range: '240 m' },
  iron: { label: '7 iron', short: '7I', speed: 49, loft: 32, spin: 6500, range: '165 m' },
  wedge: { label: 'Pitching wedge', short: 'PW', speed: 36, loft: 46, spin: 8500, range: '110 m' },
  sand: { label: 'Sand wedge', short: 'SW', speed: 27, loft: 56, spin: 9500, range: '70 m' },
  putter: { label: 'Putter', short: 'PT', speed: 4.6, loft: 3, spin: 0, range: '0–20 m' },
};
export const BALL_RADIUS = .021335;
export const CUP_RADIUS = .054 * 3; // 324 mm opening: three times the original diameter.
export const SURFACE_SKIN = .055;
export const groundHeight = (x,z) => heightAt(x,z)+SURFACE_SKIN;
// Kept for the range's recording / physics regression fixtures.
export const TARGETS = [60, 110, 170];
export const TARGET_X = { 60: -16, 110: 0, 170: 19 };
const FRICTION = { green: .55, fringe: 1.5, fairway: 2.4, tee: 2.4, rough: 5, bunker: 9 };

export function launch({ power, curve = 0, aim = 0, club = 'driver', position = HOLE.tee, heading = 0, analysis = null }) {
  if (![power, curve, aim, position.x, position.z, heading].every(Number.isFinite) || !Object.hasOwn(CLUBS, club)) throw Error('Invalid shot');
  const c=CLUBS[club],putting=club==='putter',lie=surfaceAt(position.x,position.z);
  const contact=lie==='bunker'?(club==='sand'?.9:.55):lie==='rough'?.8:1;
  const delivery=impactDelivery(club,c,power,analysis,curve),speed=delivery.speed*contact;
  const angle=heading+(clamp(aim,-35,35)+delivery.startAngle)*Math.PI/180,loft=delivery.launchAngle*Math.PI/180;
  const spinAxis=delivery.spinAxis*Math.PI/180,spinHeading=heading+clamp(aim,-35,35)*Math.PI/180;
  return { x:position.x,y:groundHeight(position.x,position.z)+BALL_RADIUS,z:position.z,start:{...position},
    vx:Math.sin(angle)*speed*Math.cos(loft),vy:speed*Math.sin(loft),vz:-Math.cos(angle)*speed*Math.cos(loft),
    spin:[Math.cos(spinAxis)*Math.cos(spinHeading),-Math.sin(spinAxis),Math.cos(spinAxis)*Math.sin(spinHeading)],rpm:delivery.rpm*(lie==='rough'?.65:1),
    delivery,analysis,age:0,carry:putting?0:null,stopped:false,rolling:putting,holed:false,club };
}
// Quadratic drag and spin-dependent Magnus lift: a=ρA/(2m) v² C.
// Coefficients are a generic dimpled-ball approximation, not a fitted ball brand.
export function airAcceleration(ball){
  const v=[ball.vx,ball.vy,ball.vz],speed=Math.hypot(...v)||.001,u=v.map(x=>x/speed);
  const spinParameter=ball.rpm*Math.PI/30*BALL_RADIUS/speed;
  const cd=.23+.06*Math.min(1,spinParameter),cl=Math.min(.32,1.7*spinParameter/(1+2*spinParameter));
  const k=.5*1.225*Math.PI*BALL_RADIUS**2/.04593*speed**2;
  const w=ball.spin,lift=[w[1]*u[2]-w[2]*u[1],w[2]*u[0]-w[0]*u[2],w[0]*u[1]-w[1]*u[0]];
  return v.map((_,i)=>k*(-cd*u[i]+cl*lift[i])-(i===1?9.81:0));
}
export function stepBall(ball,dt){
  if(ball.stopped||!Number.isFinite(dt)||dt<=0)return;
  if(dt>1/120){for(let remaining=Math.min(dt,.25);remaining>1e-9&&!ball.stopped;remaining-=1/120)stepBall(ball,Math.min(remaining,1/120));return;}
  ball.age+=dt;
  const oldX=ball.x,oldZ=ball.z,oldPosition=[ball.x,ball.y,ball.z];
  if(!ball.rolling){
    const a=airAcceleration(ball),old=[ball.vx,ball.vy,ball.vz];
    ball.vx+=a[0]*dt;ball.vy+=a[1]*dt;ball.vz+=a[2]*dt;
    ball.x+=(old[0]+ball.vx)*.5*dt;ball.y+=(old[1]+ball.vy)*.5*dt;ball.z+=(old[2]+ball.vz)*.5*dt;ball.rpm*=Math.exp(-.025*dt);
  }else{
    const slope=slopeAt(ball.x,ball.z),friction=FRICTION[surfaceAt(ball.x,ball.z)],g=9.81*5/7;
    if(Math.hypot(ball.vx,ball.vz)<.008&&g*Math.hypot(slope.x,slope.z)<friction){stop(ball);return;}
    ball.vx-=g*slope.x*dt;ball.vz-=g*slope.z*dt;
    const speed=Math.hypot(ball.vx,ball.vz),ratio=Math.max(0,speed-friction*dt)/(speed||1);ball.vx*=ratio;ball.vz*=ratio;
    ball.x+=ball.vx*dt;ball.z+=ball.vz*dt;
  }
  const ground=groundHeight(ball.x,ball.z)+BALL_RADIUS;
  if(ball.y<=ground||ball.rolling){
    ball.y=ground;
    if(ball.carry===null)ball.carry=Math.hypot(ball.x-ball.start.x,ball.z-ball.start.z);
    if(!ball.rolling){
      const lie=surfaceAt(ball.x,ball.z),s=slopeAt(ball.x,ball.z),length=Math.hypot(s.x,1,s.z),n=[-s.x/length,1/length,-s.z/length];
      const v=[ball.vx,ball.vy,ball.vz],vn=v.reduce((sum,x,i)=>sum+x*n[i],0),e=lie==='bunker'?0:lie==='rough'?.12:.25;
      const tangent=v.map((x,i)=>x-vn*n[i]),speed=Math.hypot(...tangent),mu=lie==='bunker'?.95:lie==='rough'?.6:.32;
      const retain=Math.max(0,1-mu*(1+e)*Math.abs(vn)/(speed||1));
      const reflected=tangent.map((x,i)=>x*retain-Math.min(0,vn)*e*n[i]);
      [ball.vx,ball.vy,ball.vz]=reflected;ball.rpm*=.45;
      if(e*Math.abs(vn)<.65){ball.rolling=true;ball.vy=0;}
    }
  }
  collideObstacles(ball,oldPosition,BALL_RADIUS);
  if(!ball.holed)ball.y=Math.max(ball.y,groundHeight(ball.x,ball.z)+BALL_RADIUS);
  if(ball.rolling&&!ball.ignoreCup){
    const dx=ball.x-oldX,dz=ball.z-oldZ,t=clamp(((HOLE.cup.x-oldX)*dx+(HOLE.cup.z-oldZ)*dz)/(dx*dx+dz*dz||1),0,1);
    const miss=Math.hypot(oldX+dx*t-HOLE.cup.x,oldZ+dz*t-HOLE.cup.z),radius=CUP_RADIUS-BALL_RADIUS*.25;
    const chord=2*Math.sqrt(Math.max(0,radius*radius-miss*miss));
    const captureSpeed=chord/Math.sqrt(2*BALL_RADIUS/9.81);
    if(miss<radius&&Math.hypot(ball.vx,ball.vz)<captureSpeed){ball.x=HOLE.cup.x;ball.z=HOLE.cup.z;ball.y=groundHeight(ball.x,ball.z)-.08;ball.holed=true;stop(ball);return;}
  }
  if(outOfBounds(ball)||ball.age>40)stop(ball);
}
function stop(ball) { ball.stopped = true; ball.vx = ball.vy = ball.vz = 0; }
export function scoreShot(ball, target) {
  const miss = Math.hypot(ball.x - (TARGET_X[target] || 0), ball.z + target);
  return { miss, points: miss <= 5 ? 100 : miss <= 12 ? 50 : miss <= 22 ? 25 : 0, distance: Math.hypot(ball.x, ball.z), carry: ball.carry || 0 };
}
export class GolfRound {
  constructor() { this.reset(); }
  reset(mode = 'course', drill = 'standard') {
    this.mode = mode; this.drill = drill; this.position = { ...(mode === 'putting' ? puttingStart(drill) : HOLE.tee) };
    this.shots = 0; this.lastDistance = 0; this.holed = false; this.ball = null; this.finished = false; this.penalty = false;
    this.testSwing = !!this.testSwing; this.result = null;
    this.prepare();
  }
  lockDirection(){if(!this.directionLock)this.directionLock={heading:this.heading,aim:this.aim,power:this.previewPower??.65};return this.directionLock;}
  unlockDirection(){this.directionLock=null;}
  setAim(value){if(this.directionLock||this.ball&&!(this.finished&&this.ball.testSwing)||!Number.isFinite(value))return false;this.aim=clamp(value,-35,35);return true;}
  prepare() { this.directionLock=null; this.heading = headingToPin(this.position); this.aim = 0; this.club = recommendedClub(this.position); }
  shoot(power, curve = 0, analysis = null, {testSwing=this.testSwing} = {}) {
    if (this.ball) return null;
    if(this.directionLock){this.aim=this.directionLock.aim;this.heading=this.directionLock.heading;}
    this.ball = launch({ power, curve, aim: this.aim, club: this.club, position: this.position, heading: this.heading, analysis });
    this.ball.testSwing = !!testSwing;
    if(!testSwing)this.shots++;
    this.result = null; this.finished = false; return this.ball;
  }
  finish() {
    if (!this.ball?.stopped || this.finished) return;
    const b = this.ball; this.lastDistance = Math.hypot(b.x - b.start.x, b.z - b.start.z);
    this.result={position:{x:b.x,z:b.z},toPin:b.holed?0:distanceToPin(b),lie:b.holed?'holed':surfaceAt(b.x,b.z),holed:b.holed,penalty:outOfBounds(b)};
    if(b.testSwing){this.finished=true;return;}
    this.penalty = outOfBounds(b); this.holed = b.holed;
    if (this.penalty) this.shots++; else this.position = { x: b.x, z: b.z };
    this.finished = true;
  }
  next() {
    if (!this.finished) return;
    if(this.ball?.testSwing){this.ball=null;this.finished=false;this.result=null;return;}
    if (this.holed) this.reset(this.mode,this.drill);
    else { this.ball = null; this.finished = false; this.penalty = false; this.prepare(); }
  }
  get toPin() { return this.holed ? 0 : distanceToPin(this.position); }
  setTestSwing(enabled) {
    if(this.ball&&!this.finished||this.holed)return false;
    if(this.finished)this.next();
    this.testSwing=!!enabled;return true;
  }
  get lie() { return this.holed ? 'holed' : surfaceAt(this.position.x, this.position.z); }
}

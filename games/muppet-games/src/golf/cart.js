import { HOLE, heightAt, surfaceAt, slopeAt, headingToPin, clamp } from './course.js';
import { courseObstacles } from './obstacles.js';

const approach=(value,target,amount)=>value+clamp(target-value,-amount,amount);
const brakeInput=()=>({steering:0,throttle:0,brake:true,drift:false,boost:false});
// The rendered ground is 520 × 750 m, centred at z = -200. Leave a margin
// at its actual edge, rather than stopping at the ball's out-of-bounds line.
const DRIVE_BOUNDS={left:-245,right:245,near:160,far:-560};

// Arcade handling: the chassis turns independently of its world-space momentum.
// Rear grip drops under a handbrake or a hard, fast turn; countersteering catches it.
export class GolfCart {
  constructor(){this.reset();}
  reset(position=HOLE.tee){
    this.x=position.x+4;this.z=position.z+4;this.heading=headingToPin(this);this.active=false;this.target={...position};
    this.vx=this.vz=this.speed=this.yawRate=this.steer=this.slip=this.spinTime=this.spinCooldown=0;
    this.boostCharge=1;this.boostLocked=this.boosting=this.drifting=this.blocked=false;this.arrivalReached=this.parking=false;this.grade=0;this.blockedReason=null;this.stop();
  }
  get distance(){return Math.hypot(this.x-this.target.x,this.z-this.target.z);}
  get groundSpeed(){return Math.hypot(this.vx,this.vz);}
  get arrived(){return this.distance<4.5;}
  get spinning(){return this.spinTime>0;}
  enter(target){
    this.target={...target};this.heading=Math.atan2(target.x-this.x,this.z-target.z);this.active=true;
    this.vx=this.vz=this.speed=this.yawRate=this.steer=this.slip=this.spinTime=0;
    this.arrivalReached=this.arrived;this.parking=false;this.stop();
  }
  exit(){this.active=false;this.vx=this.vz=this.speed=this.yawRate=0;this.drifting=this.boosting=false;this.stop();}
  stop(){this.input=brakeInput();this.inputAt=-Infinity;}
  setInput(input,now){
    if(!this.active)return;
    if(this.parking){if(input.throttle!==0)return;this.parking=false;}
    this.input={steering:clamp(input.steering,-1,1),throttle:clamp(input.throttle,-1,1),brake:!!input.brake,drift:!!input.drift,boost:!!input.boost};this.inputAt=now;
  }
  update(dt,now){
    if(!this.active)return;
    // Small steps preserve handling and obstacle contact at low rendering rates.
    const elapsed=clamp(dt,0,.1),steps=Math.ceil(elapsed*120);
    const input=now-this.inputAt>.4?brakeInput():this.input;
    for(let i=0;i<steps;i++)this.step(elapsed/steps,this.parking?brakeInput():input);
    this.y=heightAt(this.x,this.z);
  }
  step(dt,input){
    const surface=surfaceAt(this.x,this.z),baseLimit=surface==='rough'?12:surface==='bunker'?6:surface==='green'?7:16;
    const velocity=this.groundSpeed;
    this.steer+=(input.steering-this.steer)*(1-Math.exp(-dt*10));
    this.spinCooldown=Math.max(0,this.spinCooldown-dt);
    if(!input.boost)this.boostLocked=false;
    this.boosting=input.boost&&!this.boostLocked&&!input.brake&&!input.drift&&input.throttle>0&&!this.spinning&&this.boostCharge>0;
    this.boostCharge=clamp(this.boostCharge+dt*(this.boosting?-.3:.14),0,1);
    if(!this.boostCharge)this.boostLocked=true;
    const f={x:Math.sin(this.heading),z:-Math.cos(this.heading)},r={x:Math.cos(this.heading),z:Math.sin(this.heading)},slope=slopeAt(this.x,this.z);
    const direction=input.throttle||Math.sign(this.speed)||1,driveX=f.x*direction,driveZ=f.z*direction;
    // Only the slope along the direction of travel resists the engine. A steep
    // hillside beside the cart must not block driving across it or downhill.
    const driveGrade=slope.x*driveX+slope.z*driveZ,climb=Math.max(0,driveGrade);
    this.grade=velocity>1?(slope.x*this.vx+slope.z*this.vz)/velocity:driveGrade;
    const hillPace=1/(1+climb*(this.boosting?.45:.85));
    const edgeRoom=Math.min(driveX>0?(DRIVE_BOUNDS.right-this.x)/driveX:driveX<0?(DRIVE_BOUNDS.left-this.x)/driveX:Infinity,driveZ>0?(DRIVE_BOUNDS.near-this.z)/driveZ:driveZ<0?(DRIVE_BOUNDS.far-this.z)/driveZ:Infinity);
    const edgePace=clamp(edgeRoom/35,0,1);
    let forward=this.vx*f.x+this.vz*f.z,lateral=this.vx*r.x+this.vz*r.z;
    if(input.brake){
      const remaining=Math.max(0,velocity-20*dt),ratio=velocity?remaining/velocity:0;
      this.vx*=ratio;this.vz*=ratio;this.yawRate*=Math.exp(-dt*10);this.spinTime=0;this.drifting=false;this.slip=0;
    }else if(this.spinning){
      this.spinTime=Math.max(0,this.spinTime-dt);this.yawRate*=Math.exp(-dt*1.05);
      this.vx*=Math.exp(-dt*1.25);this.vz*=Math.exp(-dt*1.25);this.drifting=true;
    }else{
      const hardTurn=clamp((Math.abs(this.steer)-.5)*2,0,1)*clamp((velocity-7)/7,0,1);
      const handbrake=input.drift&&velocity>3;
      const grip=handbrake?.8:6.5-hardTurn*4.3;
      const yawTarget=forward/2.7*Math.tan(this.steer*.48/(1+velocity*.025))*(handbrake?1.45:1);
      this.yawRate+=(yawTarget-this.yawRate)*(1-Math.exp(-dt*(handbrake?5:9)));
      lateral*=Math.exp(-grip*dt);
      const limit=baseLimit*(this.boosting?1.45:1)*hillPace*edgePace;
      const target=input.throttle>0?limit:input.throttle<0?-5*hillPace*edgePace:0;
      const acceleration=input.throttle?(this.boosting?17:10)/(1+climb*.35):7;
      forward=approach(forward,target,acceleration*dt);
      if(handbrake)forward*=Math.exp(-dt*.24);
      this.vx=f.x*forward+r.x*lateral;this.vz=f.z*forward+r.z*lateral;
      this.slip=Math.atan2(lateral,Math.max(1,Math.abs(forward)));
      this.drifting=velocity>4&&(Math.abs(this.slip)>.16||handbrake||hardTurn>.6);
      // A sustained overcooked slide spins the chassis. Easing off or steering
      // against the slide restores grip before this threshold is reached.
      if(!this.spinCooldown&&velocity>7&&Math.abs(this.slip)>.88&&Math.abs(this.steer)>.65&&this.steer*this.slip<0){
        this.spinTime=1.1;this.spinCooldown=2.2;this.yawRate=Math.sign(this.steer)*5.4;this.boosting=false;
      }
    }
    this.heading+=this.yawRate*dt;
    const x=this.x+this.vx*dt,z=this.z+this.vz*dt;
    let blocked=x<DRIVE_BOUNDS.left||x>DRIVE_BOUNDS.right||z>DRIVE_BOUNDS.near||z<DRIVE_BOUNDS.far;
    this.blockedReason=blocked?'edge':null;
    if(!blocked)for(const s of courseObstacles().shapes){
      if(s.type==='canopy'||Math.abs(s.x-x)>s.rx+1.05||Math.abs(s.z-z)>s.rz+1.05)continue;
      const next=Math.hypot((x-s.x)/(s.rx+.95),(z-s.z)/(s.rz+.95));
      // Allow reversing out of an existing overlap instead of trapping the cart.
      if(next<1&&next<Math.hypot((this.x-s.x)/(s.rx+.95),(this.z-s.z)/(s.rz+.95))){blocked=true;this.blockedReason=s.type;break;}
    }
    this.blocked=blocked;
    if(blocked){this.vx=this.vz=this.yawRate=this.spinTime=0;this.drifting=this.boosting=false;}
    else{this.x=x;this.z=z;}
    // Park alongside the ball without ever moving it. Release Drive to explore on.
    if(this.arrived&&!this.arrivalReached&&this.groundSpeed>0){
      this.vx=this.vz=this.yawRate=this.spinTime=0;this.stop();this.arrivalReached=this.parking=true;this.drifting=this.boosting=false;
    }
    this.speed=this.vx*Math.sin(this.heading)-this.vz*Math.cos(this.heading);
    if(this.groundSpeed<.01){this.vx=this.vz=this.speed=0;this.drifting=false;}
  }
}

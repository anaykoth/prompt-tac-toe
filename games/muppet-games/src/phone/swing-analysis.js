import { swingQuality } from '../golf/swing-quality.js';
// Deterministic virtual-club delivery from a time series. No random shot spread.
// Phone IMUs observe rotation and acceleration, not real contact or hand position.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),rad=Math.PI/180,deg=180/Math.PI;
const norm=v=>Math.hypot(...v),unit=v=>{const n=norm(v)||1;return v.map(x=>x/n);};
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const rms=a=>Math.sqrt(a.reduce((s,x)=>s+x*x,0)/(a.length||1));
const mean=a=>a.reduce((s,x)=>s+x,0)/(a.length||1);
const rounded=x=>Math.round(x*1000)/1000;
export const gradeFor=q=>q>=.88?'PURE':q>=.72?'SOLID':q>=.5?'UNTIDY':'MISHIT';

export function analyseSwing(samples,{club='driver',axis=0,sign=1,motionAt,forwardAt,peakAt,power=.5,source='phone'}={}){
  const start=motionAt??samples[0]?.t??0,forward=forwardAt??start+500,peak=peakAt??samples.at(-1)?.t??forward+200;
  const raw=samples.filter(s=>s.t>=start-35&&s.t<=peak+100);
  // Calibrate a virtual hinge from this stroke's backswing. A phone grip does
  // not identify a real shaft axis. Return path is relative to this plane.
  const back=raw.filter(s=>s.t<forward),backOmega=back.map(s=>s.omega||[s.rate[1],s.rate[2],s.rate[0]]);
  let right=unit([0,1,2].map(i=>-mean(backOmega.map(v=>v[i]))));
  if(norm(right)<.5)right=[1,0,0];
  let up=[0,1,0].map((v,i)=>v-right[1]*right[i]);
  if(norm(up)<.25)up=[0,0,1].map((v,i)=>v-right[2]*right[i]);
  up=unit(up);const toward=cross(right,up),basis=[right,up,toward];
  let omega=null,accel=null,angularAcceleration=null,last=null,shaft=[0,-1,0];
  const series=[];
  for(const s of raw){
    const dt=last?clamp((s.t-last.t)/1000,.001,.2):1/60,blend=1-Math.exp(-dt/.025);
    const world=s.omega||[s.rate[1],s.rate[2],s.rate[0]],input=basis.map(v=>dot(world,v));
    const next=omega?input.map((v,i)=>omega[i]+blend*(v-omega[i])):[...input];
    const aa=omega?next.map((v,i)=>(v-omega[i])/dt):[0,0,0];
    const jerk=angularAcceleration?norm(aa.map((v,i)=>(v-angularAcceleration[i])/dt)):0;
    let linearJerk=null;
    if(s.acceleration){const nextAccel=accel?s.acceleration.map((v,i)=>accel[i]+blend*(v-accel[i])):[...s.acceleration];if(accel)linearJerk=norm(nextAccel.map((v,i)=>(v-accel[i])/dt));accel=nextAccel;}
    const u=unit(next),angle=norm(next)*rad*dt,c=Math.cos(angle),sn=Math.sin(angle),uxr=cross(u,shaft),parallel=dot(u,shaft);
    shaft=shaft.map((v,i)=>v*c+uxr[i]*sn+u[i]*parallel*(1-c));
    const velocity=cross(next.map(v=>v*rad),shaft);
    series.push({...s,shaft:[...shaft],omega:next,velocity,jerk,linearJerk,filteredSpeed:norm(next)});
    omega=next;angularAcceleration=aa;last=s;
  }
  // Prefer the downswing's return through the address plane. If that crossing
  // is outside the captured stroke, use its speed peak and report lower confidence.
  const down=series.filter(s=>s.t>=forward&&s.t<=peak+65);
  let impact=null;
  for(let i=1;i<down.length;i++){
    const a=down[i-1],b=down[i];
    if(a.shaft[2]>0&&b.shaft[2]<=0&&b.shaft[1]<-.55&&b.filteredSpeed>15){
      const f=a.shaft[2]/(a.shaft[2]-b.shaft[2]),mix=(x,y)=>x+(y-x)*f;
      const shaft=unit(a.shaft.map((x,i)=>mix(x,b.shaft[i]))),omega=a.omega.map((x,i)=>mix(x,b.omega[i]));
      impact={...b,t:mix(a.t,b.t),face:mix(a.face,b.face),shaft,omega,velocity:cross(omega.map(v=>v*rad),shaft)};break;
    }
  }
  const crossed=!!impact;
  impact ||= series.reduce((best,s)=>!best||Math.abs(s.t-peak)<Math.abs(best.t-peak)?s:best,null);
  if(!impact)return null;
  const velocity=impact.velocity;
  const poseCount=raw.filter(s=>s.shaft&&s.omega).length,hasPose=poseCount>raw.length*.8;
  const face=clamp(impact.face, -45,45);
  const path=hasPose?clamp(Math.atan2(velocity[0],Math.max(.1,-velocity[2]))*deg,-35,35):0;
  const attack=hasPose?clamp(Math.atan2(velocity[1],Math.hypot(velocity[0],velocity[2]))*deg,-25,25):0;
  const faceWindow=series.filter(s=>s.t>=impact.t-110&&s.t<=impact.t+15);
  const faceMean=mean(faceWindow.map(s=>s.face)),faceStability=rms(faceWindow.map(s=>s.face-faceMean));
  const first=faceWindow[0]||impact,lastFace=faceWindow.at(-1)||impact;
  const closureRate=(lastFace.face-first.face)/Math.max(.02,(lastFace.t-first.t)/1000);
  const core=down.filter(s=>s.t>forward+40&&s.t<=impact.t+20),jerks=core.map(s=>s.jerk),linear=core.map(s=>s.linearJerk).filter(Number.isFinite);
  const angularJerk=rms(jerks),linearJerk=linear.length?rms(linear):null;
  const downswingMs=Math.max(40,impact.t-forward),backswingMs=Math.max(40,forward-start),tempo=backswingMs/downswingMs;
  const peakSpeed=Math.max(1,...down.map(s=>s.filteredSpeed));
  const normalizedJerk=angularJerk*(downswingMs/1000)**2/peakSpeed;
  const plane=unit([0,1,2].map(i=>mean(down.map(s=>s.omega[i]))));
  const planeError=rms(down.filter(s=>s.filteredSpeed>peakSpeed*.3).map(s=>Math.acos(clamp(Math.abs(dot(unit(s.omega),plane)),0,1))*deg));
  const smoothness=clamp(1-Math.max(0,normalizedJerk-8)/35,0,1);
  // These are game contact heuristics, explicitly not a measured smash factor.
  const quality=clamp(1-(1-smoothness)*.22-Math.min(.22,faceStability/40)-Math.min(.2,planeError/110)-Math.min(.22,Math.abs(face-path)/110)-(linearJerk===null?0:clamp((linearJerk-150)/600,0,1)*.12),.3,1);
  const coaching=swingQuality({club,peakSpeed,smoothness,planeError,faceStability,closureRate,quality,face,path,attack});
  const score=clamp(coaching.contact-Math.abs(face-path)/80-Math.abs(face)/140-Math.min(.12,Math.abs(Math.log(tempo/3))*.12),0,1);
  const gaps=raw.slice(1).map((s,i)=>s.t-raw[i].t),confidence=clamp((hasPose?.8:.35)-(crossed?0:.18)-(Math.max(0,...gaps)>70?.2:0),.1,.95);
  const trace=[];const stride=Math.max(1,Math.ceil(series.length/64));
  for(let i=0;i<series.length;i+=stride){const s=series[i];trace.push([Math.max(0,s.t-start),...s.shaft,s.filteredSpeed,s.face].map(rounded));}
  return {coaching,version:1,basis:'backswing-plane',source,club,duration:rounded(Math.max(0,series.at(-1).t-start)),impactMs:rounded(Math.max(0,impact.t-start)),impactMethod:crossed?'address-return':'speed-peak',
    face:rounded(face),path:rounded(path),attack:rounded(attack),faceToPath:rounded(face-path),faceStability:rounded(faceStability),closureRate:rounded(closureRate),
    backswingMs:rounded(backswingMs),downswingMs:rounded(downswingMs),tempo:rounded(tempo),peakSpeed:rounded(peakSpeed),angularJerk:rounded(angularJerk),linearJerk:linearJerk===null?null:rounded(linearJerk),
    planeError:rounded(planeError),smoothness:rounded(smoothness),quality:rounded(quality),score:rounded(score),grade:gradeFor(score),confidence:rounded(confidence),trace};
}

export function validateSwingAnalysis(s){
  const n=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
  if(!s||s.version!==1||s.basis!=='backswing-plane'||!['phone','demo'].includes(s.source)||!['driver','wood','iron','wedge','sand','putter'].includes(s.club)||!['PURE','SOLID','UNTIDY','MISHIT'].includes(s.grade)||!['address-return','speed-peak'].includes(s.impactMethod))return false;
  const ranges={duration:[0,12000],impactMs:[0,12000],face:[-45,45],path:[-35,35],attack:[-25,25],faceToPath:[-80,80],faceStability:[0,90],closureRate:[-4500,4500],backswingMs:[0,12000],downswingMs:[0,12000],tempo:[0,300],peakSpeed:[0,10000],angularJerk:[0,1e9],planeError:[0,180],smoothness:[0,1],quality:[.3,1],score:[0,1],confidence:[0,1]};
  if(!Object.entries(ranges).every(([k,[a,b]])=>n(s[k],a,b))||(s.linearJerk!==null&&!n(s.linearJerk,0,1e7)))return false;
  if(!Array.isArray(s.trace)||s.trace.length<2||s.trace.length>64)return false;
  return s.trace.every((p,i)=>Array.isArray(p)&&p.length===6&&n(p[0],0,12000)&&(!i||p[0]>=s.trace[i-1][0])&&p.slice(1,4).every(v=>n(v,-1.01,1.01))&&n(p[4],0,10000)&&n(p[5],-45,45));
}

export function demoSwing(power=.65,club='driver',preset='straight'){
  const path=preset==='slice'?-12:preset==='hook'?12:['jerky','overpower'].includes(preset)?-16:0;
  const face=preset==='slice'?4:preset==='hook'?-4:['jerky','overpower'].includes(preset)?-22:0;
  const samples=[],peak=club==='putter'?10+190*power:(35+650*power)*(preset==='overpower'?1.9:1);
  for(let t=0;t<=1200;t+=16){
    const down=t>=750,phase=down?(t-750)/450:t/750;
    const theta=down?1.1*(1-phase*1.4):1.1*Math.sin(phase*Math.PI/2);
    const a=(down?path:0)*rad,shaft=[-Math.sin(a)*Math.sin(theta),-Math.cos(theta),Math.cos(a)*Math.sin(theta)];
    const swingSpeed=(down?Math.sin(Math.min(1,phase)*Math.PI):.3*Math.sin(phase*Math.PI))*peak;
    const noise=['jerky','overpower'].includes(preset)&&down?Math.sin(phase*35)*peak*.32:0;
    const omega=[Math.cos(a)*(swingSpeed+noise)*(down?1:-1),0,Math.sin(a)*(swingSpeed+noise)*(down?1:-1)];
    samples.push({t,rate:[omega[2],omega[0],omega[1]],omega,shaft,face:face+(['jerky','overpower'].includes(preset)?Math.sin(phase*29)*10:0)});
  }
  return analyseSwing(samples,{club,motionAt:0,forwardAt:750,peakAt:1072,power,source:'demo'});
}

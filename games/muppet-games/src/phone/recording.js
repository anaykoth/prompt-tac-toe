import { validateCalibration, screenRelativePose } from './screen-pose.js';
export const MAX_TAKES=12,MAX_DURATION=12000,MAX_SAMPLES=2400;
const finite=Number.isFinite;
const vector=(value,keys)=>keys.map(k=>finite(value?.[k])?value[k]:null);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const delta=(a,b)=>((a-b+540)%360)-180;

/** Retain sensor input even when the swing recognizer rejects it. */
export class SwingRecording {
  constructor(now,{label='Swing',hand='right',neutral=null,screenAngle=0,calibration=null}={}){
    this.origin=now;this.closed=false;
    this.take={id:crypto.randomUUID(),recordedAt:new Date().toISOString(),label,hand,neutral:neutral?vector(neutral,['alpha','beta','gamma']):null,screenAngle,duration:0,endReason:'finished',notes:'',samples:[],events:[]};
    if(calibration)this.take.calibration=structuredClone(calibration);
  }
  sample(event,orientation,now){
    if(this.closed||this.take.samples.length>=MAX_SAMPLES)return false;
    const t=clamp(now-this.origin,0,MAX_DURATION);
    this.take.samples.push({t,rate:vector(event.rotationRate,['alpha','beta','gamma']),acceleration:vector(event.acceleration,['x','y','z']),gravity:vector(event.accelerationIncludingGravity,['x','y','z']),orientation:vector(orientation,['alpha','beta','gamma']),interval:finite(event.interval)?event.interval:null});
    this.take.duration=t;return true;
  }
  event(kind,now,value=null){if(!this.closed&&this.take.events.length<100)this.take.events.push({t:clamp(now-this.origin,0,MAX_DURATION),kind,value});}
  finish(now,reason='finished'){if(!this.closed){this.take.duration=Math.max(this.take.duration,clamp(now-this.origin,0,MAX_DURATION));this.take.endReason=reason;this.closed=true;}return this.take;}
}
export function validateTake(t){
  if(!t||typeof t!=='object'||typeof t.id!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(t.id)||typeof t.recordedAt!=='string'||!finite(Date.parse(t.recordedAt))||typeof t.label!=='string'||t.label.length>80||!['left','right','both'].includes(t.hand)||typeof t.notes!=='string'||t.notes.length>1000||typeof t.endReason!=='string'||t.endReason.length>40||!finite(t.screenAngle)||!finite(t.duration)||t.duration<0||t.duration>MAX_DURATION)return false;
  const vec=v=>Array.isArray(v)&&v.length===3&&v.every(n=>n===null||(finite(n)&&Math.abs(n)<100000));
  if(t.neutral!==null&&!vec(t.neutral))return false;
  if(t.calibration!==undefined&&!validateCalibration(t.calibration))return false;
  if(!Array.isArray(t.samples)||!t.samples.length||t.samples.length>MAX_SAMPLES||!Array.isArray(t.events)||t.events.length>100)return false;
  let previous=-1;
  if(!t.samples.every(s=>{if(!s||!finite(s.t)||s.t<previous||s.t>t.duration||!['rate','acceleration','gravity','orientation'].every(k=>vec(s[k]))||(s.interval!==null&&!finite(s.interval)))return false;previous=s.t;return true;}))return false;
  previous=-1;
  return t.events.every(e=>{if(!e||!finite(e.t)||e.t<previous||e.t>t.duration||!['grip-down','grip-up','cancel','recognized','rejected','marker'].includes(e.kind)||!(e.value===null||typeof e.value==='string'&&e.value.length<=200))return false;previous=e.t;return true;});
}
export function recordingMetrics(take){
  let peak=0,peakAt=0,maxGap=0,validRates=0;const gaps=[];
  take.samples.forEach((s,i)=>{if(s.rate.every(finite)){validRates++;const speed=Math.hypot(...s.rate);if(speed>peak){peak=speed;peakAt=s.t;}}if(i){const gap=s.t-take.samples[i-1].t;if(gap>0)gaps.push(gap);maxGap=Math.max(maxGap,gap);}});
  gaps.sort((a,b)=>a-b);const interval=gaps[Math.floor(gaps.length/2)];
  return {peak,peakAt,hz:interval?1000/interval:0,maxGap,validRates,recognized:take.events.filter(e=>e.kind==='recognized').length};
}
export function poseAt(take,time){
  const samples=take.samples;let i=0;while(i+1<samples.length&&samples[i+1].t<=time)i++;
  const a=samples[i],b=samples[Math.min(i+1,samples.length-1)],f=b.t>a.t?clamp((time-a.t)/(b.t-a.t),0,1):0;
  const neutral=take.neutral;
  if(!neutral?.every(finite)||!a.orientation.every(finite)||!b.orientation.every(finite))return null;
  if(take.calibration){const o=a.orientation.map((v,k)=>v+delta(b.orientation[k],v)*f);return {...screenRelativePose({alpha:o[0],beta:o[1],gamma:o[2]},take.calibration),armed:false};}
  const angles=a.orientation.map((v,k)=>delta(v+delta(b.orientation[k],v)*f,neutral[k]));
  return {yaw:angles[0],pitch:angles[1],roll:angles[2],armed:false};
}
export function recordingBundle(takes){return {format:'felt-fairway-swing-lab',version:2,exportedAt:new Date().toISOString(),units:'t/duration/interval: milliseconds. rate: alpha,beta,gamma in degrees/second. acceleration and gravity: x,y,z in metres/second²; gravity includes gravity. orientation/neutral: alpha,beta,gamma in degrees, browser device frame. null means unavailable. Optional calibration: position in black-marker widths at lock; multiply by markerWidthCm for estimated cm. Origin is browser viewport centre, x right, y up, z toward player. Rotation matrices row-major. Camera fieldOfView is assumed on the long image edge, not measured intrinsics; depth and tilt are approximate. Position is NOT updated after lock. Rotation is not a reconstructed hand position. Events describe grip and recognizer decisions; all sensor samples are retained independently.',takes:takes.map(t=>({...t,metrics:recordingMetrics(t)}))};}

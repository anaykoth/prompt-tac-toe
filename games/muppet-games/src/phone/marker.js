import aruco from 'js-aruco2';
import posit from 'js-aruco2/src/posit1.js';
import { cameraToScreen, isRotation, rotationDistance } from './screen-pose.js';

export const dictionary=new aruco.AR.Dictionary('ARUCO_MIP_36h12');
export const markerSVG=id=>dictionary.generateSVG(id);
export const createDetector=()=>new aruco.AR.Detector({dictionaryName:'ARUCO_MIP_36h12',maxHammingDistance:3});
const model=[[-.5,.5,0],[.5,.5,0],[.5,-.5,0],[-.5,-.5,0]];
export function estimateMarker(corners,width,height,{fieldOfView=60,screenAngle=0}={}){
  if(corners.length!==4||corners.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return null;
  const edges=corners.map((p,i)=>Math.hypot(p.x-corners[(i+1)%4].x,p.y-corners[(i+1)%4].y));
  if(Math.min(...edges)<48||Math.max(...edges)/Math.min(...edges)>3)return null;
  if(corners.some(p=>p.x<8||p.y<8||p.x>width-8||p.y>height-8))return null;
  // Browser camera intrinsics are unavailable. Keep this assumption in the saved calibration.
  const focalPixels=Math.max(width,height)/(2*Math.tan(fieldOfView*Math.PI/360));
  const centered=corners.map(p=>({x:p.x-width/2,y:height/2-p.y}));
  const pose=new posit.POS.Posit(1,focalPixels).pose(centered);
  const candidates=['best','alternative'].map(name=>{
    const r=pose[name+'Rotation']?.flat(),t=pose[name+'Translation'];
    if(!isRotation(r)||!t?.every(Number.isFinite)||t[2]<=0)return null;
    let error=0;
    for(let i=0;i<4;i++){
      const p=model[i],v=[0,3,6].map((row,k)=>r[row]*p[0]+r[row+1]*p[1]+t[k]);
      if(v[2]<=0)return null;
      error+=(v[0]*focalPixels/v[2]-centered[i].x)**2+(v[1]*focalPixels/v[2]-centered[i].y)**2;
    }
    const reprojectionError=Math.sqrt(error/4),spatial=cameraToScreen(r,t,screenAngle);
    if(reprojectionError>3||spatial.position[2]<.1||spatial.position.some(v=>Math.abs(v)>100))return null;
    return {...spatial,reprojectionError,focalPixels,fieldOfView,frame:[width,height],screenAngle};
  }).filter(Boolean).sort((a,b)=>a.reprojectionError-b.reprojectionError);
  return candidates[0]||null;
}
/** Collect ten recent good readings. Brief blur/occlusion pauses progress instead
 * of throwing it away. Pose estimates wobble near frontal views, so use generous
 * bounds and tolerate isolated outliers while still rejecting a different pose. */
export class StableMarker {
  reset(){this.samples=[];this.last=null;this.count=0;this.lastTime=null;this.accepted=false;this.outliers=0;}
  constructor(){this.reset();}
  sample(pose,time){
    this.accepted=false;
    if(this.lastTime!==null&&(time-this.lastTime>900||time<this.lastTime))this.reset();
    this.samples=this.samples.filter(s=>time-s.time<=2400);
    this.count=this.samples.length;
    if(!pose)return this.progress;
    if(time===this.lastTime)return this.progress;
    const reference=this.samples[0]?.pose;
    const moved=reference&&(rotationDistance(pose.device,reference.device)>15||Math.hypot(...pose.position.map((v,i)=>v-reference.position[i]))>Math.max(.3,pose.position[2]*.15));
    if(moved){
      if(++this.outliers<3)return this.progress;
      this.reset(); // Sustained relocation starts a fresh collection at the new pose.
    }
    this.outliers=0;this.accepted=true;this.last=pose;this.lastTime=time;
    this.samples.push({pose,time});this.samples=this.samples.slice(-30);this.count=this.samples.length;
    return this.progress;
  }
  get progress(){return this.count?Math.min(1,this.count/10,(this.lastTime-this.samples[0].time)/500):0;}
}

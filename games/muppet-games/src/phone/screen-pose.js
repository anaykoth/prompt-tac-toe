// Screen frame: +x right, +y up, +z out of the display toward the player.
// Matrices are row-major. The origin is the marker at the browser view's centre.
const rad=Math.PI/180,deg=180/Math.PI,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const IDENTITY=[1,0,0,0,1,0,0,0,1];
export const transpose=m=>[m[0],m[3],m[6],m[1],m[4],m[7],m[2],m[5],m[8]];
export const multiply=(a,b)=>Array.from({length:9},(_,i)=>{const r=Math.floor(i/3)*3,c=i%3;return a[r]*b[c]+a[r+1]*b[c+3]+a[r+2]*b[c+6];});
export const transform=(m,v)=>[0,3,6].map(i=>m[i]*v[0]+m[i+1]*v[1]+m[i+2]*v[2]);
export function rotation(axis,degrees){const c=Math.cos(degrees*rad),s=Math.sin(degrees*rad);return axis==='x'?[1,0,0,0,c,-s,0,s,c]:axis==='y'?[c,0,s,0,1,0,-s,0,c]:[c,-s,0,s,c,0,0,0,1];}
export function deviceMatrix({alpha,beta,gamma}){return multiply(multiply(rotation('z',alpha),rotation('x',beta)),rotation('y',gamma));}
export function rotationDistance(a,b){const r=multiply(a,transpose(b));return Math.acos(clamp((r[0]+r[4]+r[8]-1)/2,-1,1))*deg;}
export function isRotation(m){
  if(!Array.isArray(m)||m.length!==9||!m.every(v=>Number.isFinite(v)&&Math.abs(v)<=1.001))return false;
  const unit=multiply(m,transpose(m));
  const det=m[0]*(m[4]*m[8]-m[5]*m[7])-m[1]*(m[3]*m[8]-m[5]*m[6])+m[2]*(m[3]*m[7]-m[4]*m[6]);
  return Math.abs(det-1)<.01&&unit.every((v,i)=>Math.abs(v-IDENTITY[i])<.01);
}
/** POSIT uses x right, y up, positive depth; reflect both frames to obtain RH rotations. */
export function cameraToScreen(r,t,screenAngle=0){
  const flip=[1,0,0,0,1,0,0,0,-1],inv=transpose(r);
  const device=multiply(multiply(multiply(flip,inv),flip),rotation('z',screenAngle));
  const centre=transform(inv,t);
  return {device,position:[-centre[0],-centre[1],centre[2]]};
}
export function screenOrientation(orientation,calibration){return multiply(calibration.screenFromSensor,deviceMatrix(orientation));}
export function screenRelativePose(orientation,calibration){
  // Express the grip's change of rotation around SCREEN axes, not Euler-angle subtraction.
  const m=multiply(screenOrientation(orientation,calibration),transpose(calibration.gripScreen));
  const pitch=Math.asin(clamp(-m[5],-1,1));
  const yaw=Math.abs(m[5])<.999999?Math.atan2(m[2],m[8]):Math.atan2(-m[6],m[0]);
  const roll=Math.abs(m[5])<.999999?Math.atan2(m[3],m[4]):0;
  return {pitch:pitch*deg,yaw:yaw*deg,roll:roll*deg};
}
export function validateCalibration(c){
  const n=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
  return !!c&&c.version===1&&c.source==='screen-marker'&&c.reference==='viewport-center'
    &&Number.isInteger(c.markerId)&&n(c.markerId,0,249)&&typeof c.capturedAt==='string'&&Number.isFinite(Date.parse(c.capturedAt))
    &&Array.isArray(c.position)&&c.position.length===3&&c.position.every(v=>n(v,-100,100))&&c.position[2]>.1
    &&(c.markerWidthCm===null||n(c.markerWidthCm,1,200))&&n(c.fieldOfView,35,100)&&n(c.focalPixels,10,5000)
    &&Array.isArray(c.frame)&&c.frame.length===2&&c.frame.every(v=>Number.isInteger(v)&&n(v,100,2000))
    &&(c.lockMethod===undefined||['manual','steady'].includes(c.lockMethod))
    &&n(c.reprojectionError,0,3)&&n(c.screenAngle,-360,360)&&Number.isInteger(c.stableFrames)&&n(c.stableFrames,c.lockMethod==='manual'?1:10,1000)
    &&isRotation(c.screenFromSensor)&&isRotation(c.gripScreen)&&isRotation(c.cameraDevice)
    &&Array.isArray(c.sensorAtLock)&&c.sensorAtLock.length===3&&c.sensorAtLock.every(v=>n(v,-360,360));
}
export function positionLabel(c){
  const unit=c.markerWidthCm?'cm':'target widths',scale=c.markerWidthCm||1;
  const [x,y,z]=c.position.map(v=>v*scale),digits=c.markerWidthCm?0:1;
  return `Estimated start: ${z.toFixed(digits)} ${unit} from screen · ${Math.abs(x).toFixed(digits)} ${x<0?'left':'right'} · ${Math.abs(y).toFixed(digits)} ${y<0?'below':'above'} centre`;
}

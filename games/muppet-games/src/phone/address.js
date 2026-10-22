import { multiply, transpose, rotation, transform, screenOrientation, screenRelativePose } from './screen-pose.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// Turning left is positive screen yaw; the range uses right-positive aim.
export const aimFromYaw=yaw=>clamp(-yaw*.85,-35,35);
export const curveFromFace=face=>Math.abs(face)<=2?0:clamp(face/45,-1,1);
export const faceLabel=face=>Math.abs(face)<=2?'SQUARE':`${Math.round(Math.abs(face))}° ${face>0?'OPEN':'CLOSED'}`;

export function captureAddress(orientation,calibration){
  const heading=rotation('y',screenRelativePose(orientation,calibration).yaw);
  return {orientation:screenOrientation(orientation,calibration),heading,fromScreen:transpose(heading)};
}

export function clubfaceAt(orientation,calibration,address,previous=0){
  const change=multiply(screenOrientation(orientation,calibration),transpose(address.orientation));
  const m=multiply(multiply(address.fromScreen,change),address.heading);
  // Swing/twist decomposition around the locked direction's forward axis.
  // Pure backswing motion does not flip the face at the Euler ±90° boundary.
  const x=m[0]+m[4],y=m[3]-m[1];
  if(Math.hypot(x,y)<1e-6)return previous;
  return clamp(-Math.atan2(y,x)*180/Math.PI,-45,45);
}

export function isFaceAdjustment(orientation,calibration,address,rate){
  // Browser gyro axes are alpha=z, beta=x, gamma=y in the phone frame.
  const velocity=transform(address.fromScreen,transform(screenOrientation(orientation,calibration),[rate[1],rate[2],rate[0]]));
  return Math.abs(velocity[2])>Math.hypot(...velocity)*.85;
}

// A virtual shaft hangs below a fixed grip at address. This models rotation,
// not the unobservable translation of the player's hands or a real clubhead.
export function swingKinematics(orientation,calibration,address,rate,acceleration){
  const current=screenOrientation(orientation,calibration);
  const change=multiply(multiply(address.fromScreen,multiply(current,transpose(address.orientation))),address.heading);
  const shaft=transform(change,[0,-1,0]);
  const omega=transform(address.fromScreen,transform(current,[rate[1],rate[2],rate[0]]));
  const a=acceleration&&[acceleration.x,acceleration.y,acceleration.z];
  return {shaft,omega,acceleration:a?.every(Number.isFinite)?transform(address.fromScreen,transform(current,a)):null};
}

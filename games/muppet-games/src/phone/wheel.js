import { deviceMatrix, multiply, transpose } from './screen-pose.js';
export const wheelReference=orientation=>deviceMatrix(orientation);
export function wheelSteering(orientation,centre){
  if(!orientation||!centre)return 0;
  const m=multiply(transpose(centre),deviceMatrix(orientation));
  // Clockwise rotation of the screen is right steering, in portrait or landscape.
  const twist=-Math.atan2(m[3]-m[1],m[0]+m[4])*180/Math.PI;
  return Math.max(-1,Math.min(1,(Math.abs(twist)<3?0:Math.sign(twist)*(Math.abs(twist)-3))/42));
}

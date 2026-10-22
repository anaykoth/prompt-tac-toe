import { swingQuality } from './swing-quality.js';
// Simplified centred-contact launch model. Face/path is measured from the
// calibrated virtual shaft; quality is a game estimate, never real impact data.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),rad=Math.PI/180;
export function impactDelivery(club,definition,power,analysis=null,curve=0){
  const putting=club==='putter';
  const feedback=swingQuality(analysis,club);
  const face=(analysis?.face??curve*16)+feedback.faceError,path=(analysis?.path??0)+feedback.pathError,attack=analysis?.attack??0;
  const quality=feedback.contact;
  const faceWeight=putting?.93:['driver','wood'].includes(club)?.85:.75;
  const startAngle=face*faceWeight+path*(1-faceWeight);
  const dynamicLoft=clamp(definition.loft+attack*.35,putting?0:5,65);
  const spinLoft=clamp(dynamicLoft-attack,5,65);
  const spinAxis=putting?0:clamp(Math.atan2(Math.sin((face-path)*rad),Math.tan(spinLoft*rad))*180/Math.PI,-70,70);
  // A phone cannot measure putter contact. Keep pace tied to stroke speed;
  // inferred jerk/quality must not secretly shorten an otherwise equal putt.
  const efficiency=putting?1-feedback.speedPenalty*.35:.62+.38*quality;
  const speed=definition.speed*(putting?clamp(power,.02,1):.08+.92*Math.sqrt(clamp(power,0,1)))*efficiency;
  const launchAngle=putting?0:clamp(dynamicLoft*.85+attack*.15,3,60);
  const rpm=putting?0:definition.spin*Math.sqrt(clamp(power,.02,1))*Math.sin(spinLoft*rad)/Math.sin(definition.loft*rad)*(.75+.25*quality);
  const curveName=Math.abs(spinAxis)<2?'STRAIGHT':spinAxis>0?(spinAxis>12?'SLICE RIGHT':'FADE RIGHT'):(spinAxis< -12?'HOOK LEFT':'DRAW LEFT');
  const startName=Math.abs(startAngle)<2?'ON LINE':startAngle<0?'PULL LEFT':'PUSH RIGHT';
  return {feedback,face,path,faceToPath:face-path,attack,quality,efficiency,startAngle,launchAngle,spinAxis,rpm,speed,shape:putting?startName:curveName==='STRAIGHT'?startName:curveName};
}

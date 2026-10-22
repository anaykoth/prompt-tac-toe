const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
export const speedLimitFor=club=>club==='putter'?200:685;
// Game tuning limits, not safe/unsafe real-world swing speeds. Raw phone angular
// speed is not real clubhead speed, and contact is an inferred game outcome.
export function swingQuality(report,club=report?.club||'driver'){
  const r=report||{},speedLimit=speedLimitFor(club),peakSpeed=r.peakSpeed||0;
  const control=clamp(1-(1-(r.smoothness??1))*.38-clamp((r.planeError||0)/24)*.26-clamp((r.faceStability||0)/9)*.22-clamp(Math.abs(r.closureRate||0)/450)*.14);
  const speedRatio=peakSpeed/speedLimit,overSpeed=clamp((speedRatio-1)/.65);
  const speedPenalty=overSpeed*(.06+.24*(1-control));
  const contact=clamp((r.quality??1)-(1-control)*.18-speedPenalty,.2,1);
  const faceError=clamp((r.closureRate||0)*.006*(1-control+overSpeed*.3),-6,6);
  const pathError=clamp((Math.sign(r.path||0)||Math.sign(r.closureRate||0))*(r.planeError||0)*(1-control)*.12,-3,3);
  const contactX=clamp(((r.face||0)-(r.path||0))/40+faceError/12,-.9,.9),contactY=clamp((r.attack||0)/35,-.9,.9);
  return {control,contact,peakSpeed,speedLimit,speedRatio,overSpeed,speedPenalty,faceError,pathError,contactX,contactY};
}
export function swingAdvice(report,quality=swingQuality(report)){
  const r=report,q=quality;
  if(q.overSpeed>.15&&q.control<.75)return {title:'LESS SPEED. MORE CONTROL.',text:'Try a smaller backswing at about 75% of this effort. Keep the face quiet through the bottom.',focus:'speed'};
  if(q.control<.7)return {title:'SMOOTH THE CHANGE OF DIRECTION.',text:'Pause briefly at the top, then build speed evenly. Repeat until the return path stays in one plane.',focus:'control'};
  if(Math.abs(r.faceToPath)>4)return {title:r.faceToPath>0?'SQUARE THE FACE TO YOUR PATH.':'LET THE FACE STAY OPEN A LITTLE LONGER.',text:`The face was ${Math.abs(r.faceToPath).toFixed(1)}° ${r.faceToPath>0?'open':'closed'} to your path. Rehearse slowly with less wrist twist.`,focus:'face'};
  if(Math.abs(r.path)>5)return {title:'RETURN ALONG THE TARGET LINE.',text:`Your path crossed ${Math.abs(r.path).toFixed(1)}° ${r.path<0?'left':'right'}. Keep facing the locked guide and bring the club back through it.`,focus:'path'};
  if(q.overSpeed>.15)return {title:'YOU HAVE ENOUGH SPEED.',text:'Extra speed is past the game’s power range. Repeat with less effort and keep the same smooth return.',focus:'speed'};
  return {title:'REPEAT THIS SHAPE.',text:'The face and path are working together. Keep this control, then vary speed in small steps to learn distance.',focus:'repeat'};
}

import assert from 'node:assert/strict';
import { createDetector, dictionary, estimateMarker, StableMarker } from '../src/phone/marker.js';
import { IDENTITY, rotation, multiply, transpose, transform, deviceMatrix, screenRelativePose, rotationDistance, validateCalibration } from '../src/phone/screen-pose.js';
import { SwingRecording, poseAt, validateTake } from '../src/phone/recording.js';

const width=640,height=480,focal=width/(2*Math.tan(Math.PI/6));
const square=[[-.5,.5,0],[.5,.5,0],[.5,-.5,0],[-.5,-.5,0]];
function project(device,position){return square.map(p=>{const v=transform(transpose(device),p.map((x,i)=>x-position[i]));return {x:width/2+focal*v[0]/-v[2],y:height/2-focal*v[1]/-v[2]};});}
function syntheticFrame(device,position,id){
  const data=new Uint8ClampedArray(width*height*4);data.fill(255);const bits=dictionary.codeList[id];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const direction=transform(device,[(x-width/2)/focal,(height/2-y)/focal,-1]);
    const t=-position[2]/direction[2],px=position[0]+t*direction[0],py=position[1]+t*direction[1];
    if(Math.abs(px)>.5||Math.abs(py)>.5||t<=0)continue;
    const cx=Math.min(7,Math.floor((px+.5)*8)),cy=Math.min(7,Math.floor((.5-py)*8));
    const white=cx>0&&cx<7&&cy>0&&cy<7&&bits[(cy-1)*6+cx-1]==='1';
    if(!white){const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=0;}
  }
  return {width,height,data};
}
const detector=createDetector();
for(const [device,position] of [[IDENTITY,[0,0,3]],[rotation('z',35),[0,0,3]],[multiply(rotation('y',12),rotation('x',-8)),[.5,.2,3]],[rotation('y',-10),[-.4,-.2,3]]]){
  const pose=estimateMarker(project(device,position),width,height);
  assert.ok(pose,'projected corners solve');assert.ok(rotationDistance(pose.device,device)<.7,'camera→screen axes and signs');
  assert.ok(Math.hypot(...pose.position.map((v,i)=>v-position[i]))<.05,'position has correct scale, side, height, and positive depth');
  const detections=detector.detect(syntheticFrame(device,position,42));
  const marker=detections.find(m=>m.id===42);assert.ok(marker,'detect the generated target through perspective and roll');
  const measured=estimateMarker(marker.corners,width,height);assert.ok(measured);assert.ok(rotationDistance(measured.device,device)<3,'rasterized camera target keeps its orientation');
  assert.ok(Math.hypot(...measured.position.map((v,i)=>v-position[i]))<.16);
}
assert.equal(detector.detect({width,height,data:new Uint8ClampedArray(width*height*4).fill(255)}).length,0);
assert.equal(estimateMarker([{x:0,y:0},{x:30,y:0},{x:30,y:30},{x:0,y:30}],width,height),null,'clipped/tiny targets cannot lock');
const landscape=estimateMarker(project(rotation('z',-90),[0,0,3]),width,height,{screenAngle:90});
assert.ok(rotationDistance(landscape.device,IDENTITY)<.01,'screen rotation is removed from the physical device pose');

const still=estimateMarker(project(IDENTITY,[0,0,3]),width,height),stable=new StableMarker();
for(let t=0;t<765;t+=85)assert.ok(stable.sample(still,t)<1,'fewer than ten readings cannot capture');
assert.equal(stable.sample(still,765),1);
assert.equal(stable.sample(null,950),1,'brief blur retains completed progress');
assert.equal(stable.sample(null,1700),0,'a prolonged loss resets uncaptured progress');
stable.reset();let capturedAt=null;
for(let i=0;i<24;i++){
  const pose=i%4===3?null:{...still,device:rotation('z',i%2?4:-4),position:[i%2?.09:-.09,.04,3]};
  const progress=stable.sample(pose,i*85);
  if(i===3)assert.ok(progress>0,'a missed frame around 20% must not erase progress');
  if(progress===1){capturedAt=i*85;break;}
}
assert.ok(capturedAt!==null&&capturedAt<2000,'normal hand wobble plus repeated brief dropouts still captures');
stable.reset();stable.sample(still,0);stable.sample(still,100);const held=stable.sample(still,200);
assert.equal(stable.sample(still,200),held);assert.equal(stable.count,3,'same timestamp does not add evidence');
const relocated={...still,position:[1,0,3],device:rotation('y',35)};
assert.equal(stable.sample(relocated,300),held,'one pose-estimation outlier does not wipe progress');assert.equal(stable.accepted,false);
stable.sample(relocated,400);assert.equal(stable.sample(relocated,500),0,'sustained large movement starts over');assert.equal(stable.count,1);
assert.equal(stable.sample(null,1500),0,'stale partial evidence expires');
const smaller=estimateMarker(project(IDENTITY,[0,0,10]),width,height);assert.ok(smaller,'a fully visible 55px target is usable without moving excessively close');

const sensor={alpha:137,beta:74,gamma:16},cameraDevice=multiply(rotation('y',10),rotation('z',8));
export const calibration={version:1,source:'screen-marker',reference:'viewport-center',markerId:42,capturedAt:new Date().toISOString(),position:[.3,.1,3],markerWidthCm:15,fieldOfView:60,focalPixels:focal,frame:[width,height],reprojectionError:.3,screenAngle:0,stableFrames:14,cameraDevice,screenFromSensor:multiply(cameraDevice,transpose(deviceMatrix(sensor))),gripScreen:cameraDevice,sensorAtLock:[137,74,16]};
assert.ok(validateCalibration(calibration));
const neutral=screenRelativePose(sensor,calibration);assert.ok(Object.values(neutral).every(v=>Math.abs(v)<1e-6));
const aligned={...calibration,screenFromSensor:IDENTITY,gripScreen:IDENTITY};
assert.ok(Math.abs(screenRelativePose({alpha:20,beta:0,gamma:0},aligned).roll-20)<1e-6,'screen roll uses the screen normal');
assert.ok(Math.abs(screenRelativePose({alpha:0,beta:15,gamma:0},aligned).pitch-15)<1e-6);
assert.equal(validateCalibration({...calibration,screenFromSensor:[1,0,0,0,1,0,0,0,-1]}),false,'reflections cannot be sensor transforms');
assert.equal(validateCalibration({...calibration,position:[0,0,-3]}),false);
const recording=new SwingRecording(0,{neutral:sensor,calibration});recording.sample({rotationRate:{alpha:1,beta:2,gamma:3}},sensor,0);
recording.sample({rotationRate:{alpha:1,beta:2,gamma:3}},{...sensor,alpha:139},20);const take=recording.finish(25);assert.ok(validateTake(take));
assert.deepEqual(poseAt(take,20),{...screenRelativePose({...sensor,alpha:139},calibration),armed:false},'lab replay uses the same screen transform as live input');
assert.equal(validateTake({...take,calibration:{...calibration,fieldOfView:0}}),false);
console.log('✓ camera: real marker detection, perspective, rotation, position scale/signs, landscape, stability, invalid geometry, screen-relative IMU mapping, saved calibration/replay');

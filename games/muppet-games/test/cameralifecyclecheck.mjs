import { CameraAlignment } from '../src/phone/camera.js';
import assert from 'node:assert/strict';
import { validateCalibration } from '../src/phone/screen-pose.js';

// No hardware or permission prompts: exercise delayed media promises and teardown.
const elements=new Map();
const element=id=>{
  if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,value:id==='camera-fov'?'60':'',textContent:'',play:async()=>{},getContext:()=>({})});
  return elements.get(id);
};
globalThis.document={getElementById:element,createElement:()=>({getContext:()=>({})})};
let resolveCamera,stopped=0,locked=null;
const track={stop:()=>stopped++,addEventListener:()=>{}};
const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{getUserMedia:()=>new Promise(r=>resolveCamera=r)}},configurable:true});
const packets=[],camera=new CameraAlignment({link:{send:p=>packets.push(p)},sensor:()=>null,onLock:c=>{locked=c;}});
const pending=camera.start();camera.stop();resolveCamera(stream);await pending;
assert.equal(stopped,1);assert.equal(camera.active,false);assert.equal(element('camera-video').srcObject,null);assert.equal(packets.at(-1).type,'camera.cancel');
navigator.mediaDevices.getUserMedia=async()=>{throw Object.assign(Error('denied'),{name:'NotAllowedError'});};
await camera.start();assert.match(element('sensor-status').textContent,/denied/);assert.equal(camera.active,false);
navigator.mediaDevices.getUserMedia=async()=>stream;
await camera.start();assert.equal(element('camera-video').srcObject,stream);camera.stop();assert.equal(stopped,2);assert.equal(element('camera-video').srcObject,null);
await camera.start();camera.receive({type:'camera.target',requestId:'current',markerId:3});
camera.receive({type:'camera.locked',requestId:'old',calibration:{id:'old'}});assert.equal(locked,null);assert.equal(camera.active,true);
camera.receive({type:'camera.locked',requestId:'current',calibration:{id:'current'}});assert.equal(locked.id,'current');assert.equal(camera.active,false);assert.equal(stopped,3);
await camera.start();camera.receive({type:'presence',host:false});assert.equal(camera.active,false);assert.equal(stopped,4);
console.log('✓ camera lifecycle: denied permission, cancel during permission request, late stream cleanup, stale acknowledgement, successful lock, disconnect, camera stop');

// Exercise the complete frame gate with hand tremor, sparse orientation updates,
// intermittent detection, and a delayed tap after successful capture.
const realPerformance=globalThis.performance;let clock=10000,frameIndex=0;
Object.defineProperty(globalThis,'performance',{value:{now:()=>clock},configurable:true});
globalThis.screen={orientation:{angle:0}};
const context={drawImage(){},getImageData(){return {};},clearRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){}};
element('camera-corners').getContext=()=>context;
Object.assign(element('camera-video'),{readyState:2,videoWidth:640,videoHeight:480,currentTime:0});
camera.ctx=context;
camera.sensor=()=>({orientation:{alpha:10,beta:20,gamma:5},time:clock-200,speed:20});
camera.detector={detect:()=>frameIndex%4===3?[]:[{id:3,corners:[{x:220,y:140},{x:420,y:140},{x:420,y:340},{x:220,y:340}]}]};
await camera.start();camera.receive({type:'camera.target',requestId:'forgiving',markerId:3});camera.receive({type:'camera.visible',requestId:'forgiving'});
for(frameIndex=0;frameIndex<20&&!camera.candidate;frameIndex++){
  clock+=85;element('camera-video').currentTime=frameIndex*.085;camera.frame();
  if(frameIndex===3){assert.ok(element('camera-progress').value>0);assert.equal(element('camera-lock-now').disabled,false);}
}
assert.ok(camera.candidate,'tremor and 200ms orientation age should not strand alignment at 20%');
const captured=camera.candidate;assert.equal(element('camera-lock').disabled,false);
clock+=3000;camera.sensor=()=>null;camera.frame();
assert.equal(camera.candidate,captured,'the captured pair survives movement while reaching to tap');
camera.lock();const packet=packets.at(-1);assert.equal(packet.type,'camera.lock');assert.ok(validateCalibration(packet.calibration));
assert.deepEqual(packet.calibration.sensorAtLock,[10,20,5],'the captured IMU pose is paired with the captured camera frame');
camera.stop();
await camera.start();camera.receive({type:'camera.target',requestId:'new',markerId:3});camera.receive({type:'camera.visible',requestId:'new'});
camera.sensor=()=>({orientation:{alpha:0,beta:0,gamma:0},time:clock,speed:0});
frameIndex=0;element('camera-video').currentTime=1;
for(let i=0;i<14;i++){clock+=85;camera.frame();}
assert.equal(camera.candidate,null,'a frozen camera frame cannot count ten times');
camera.stop();
await camera.start();camera.receive({type:'camera.target',requestId:'manual',markerId:3});camera.receive({type:'camera.visible',requestId:'manual'});
camera.lock(true);assert.equal(camera.pending,false,'manual lock still needs one real optical reading');
camera.sensor=()=>({orientation:{alpha:4,beta:85,gamma:2},time:clock,speed:60});
frameIndex=0;clock+=85;element('camera-video').currentTime=2;camera.frame();
assert.equal(camera.candidate,null,'a single reading does not pretend to satisfy steady capture');
assert.equal(element('camera-lock-now').disabled,false,'manual lock is available without the progress bar or motion steadiness gate');
clock+=5000;camera.sensor=()=>null;camera.frame();camera.lock(true);
const manual=packets.at(-1);assert.equal(manual.type,'camera.lock');assert.equal(manual.calibration.lockMethod,'manual');assert.equal(manual.calibration.stableFrames,1);assert.ok(validateCalibration(manual.calibration));
assert.deepEqual(manual.calibration.sensorAtLock,[4,85,2],'manual lock uses the matching IMU sample, not the later lowered pose');
assert.equal(validateCalibration({...manual.calibration,lockMethod:'steady'}),false,'a one-frame manual capture cannot claim steady quality');
camera.stop();Object.defineProperty(globalThis,'performance',{value:realPerformance,configurable:true});
console.log('✓ forgiving alignment: repeated dropouts, small movements, delayed orientation, latched capture, delayed tap, fresh-frame requirement');
console.log('✓ manual alignment: one usable reading, no steadiness/progress requirement, matching optical/IMU pair, honest quality metadata');

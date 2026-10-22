import assert from 'node:assert/strict';
import fs from 'node:fs';
import { IDENTITY, multiply, rotation } from '../src/phone/screen-pose.js';

// Run the real controller, permissions flow and event handlers with a fake DOM,
// clock and transport. Sensor samples are from the user's real Lab recording.
let now=1000,nextTimer=1;
const uploads=[];globalThis.fetch=async(url,options={})=>{if(options.body)uploads.push(JSON.parse(options.body));return {ok:true,json:async()=>({records:[]})};};
const timers=new Map(),listeners=new Map(),elements=new Map(),sent=[];
globalThis.setInterval=(fn)=>{const id=nextTimer++;timers.set(id,fn);return id;};
globalThis.clearInterval=id=>timers.delete(id);
globalThis.setTimeout=()=>nextTimer++;
globalThis.clearTimeout=()=>{};
Object.defineProperty(globalThis,'performance',{value:{now:()=>now},configurable:true});
const element=id=>{
  if(!elements.has(id))elements.set(id,{
    value:id==='camera-fov'?'60':id==='lab-label'?'Test swing':id==='lab-hand'?'right':'',
    hidden:true,disabled:false,textContent:'',style:{},
    classList:{add(){},remove(){},toggle(){}},addEventListener(){},setPointerCapture(){},
    add(){},setAttribute(){},getContext:()=>({}),play:async()=>{},
  });
  return elements.get(id);
};
globalThis.Option=class {constructor(label,value){this.label=label;this.value=value;}};
globalThis.document={body:element('body'),getElementById:element,createElement:()=>element('canvas'),addEventListener:(kind,fn)=>listeners.set(kind,fn),hidden:false};
globalThis.location={protocol:'https:',host:'test.invalid',pathname:'/controller.html',hash:'#room=TEST&key=test'};
globalThis.history={replaceState(){}};
globalThis.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
globalThis.screen={orientation:{angle:0}};
globalThis.DeviceMotionEvent=class {};
globalThis.window={isSecureContext:true,DeviceMotionEvent,addEventListener:(kind,fn)=>listeners.set(kind,fn)};
const track={stop(){},addEventListener(){}};
Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[track],getVideoTracks:()=>[track]})}},configurable:true});
let socket;
globalThis.WebSocket=class {
  static OPEN=1;
  constructor(){socket=this;this.readyState=1;this.bufferedAmount=0;}
  send(packet){sent.push(JSON.parse(packet));}
  close(){}
};
const receive=packet=>socket.onmessage({data:JSON.stringify(packet)});
const {samples}=JSON.parse(fs.readFileSync(new URL('./fixtures/three-phone-swings.json',import.meta.url)));
const motion=(rate=[0,0,0],yaw=0,tilt=0)=>{
  const m=multiply(rotation('y',yaw),rotation('z',tilt));
  listeners.get('deviceorientation')({alpha:Math.atan2(-m[1],m[4])*180/Math.PI,beta:Math.asin(m[7])*180/Math.PI,gamma:Math.atan2(-m[6],m[8])*180/Math.PI});
  listeners.get('devicemotion')({rotationRate:{alpha:rate[0],beta:rate[1],gamma:rate[2]}});
};
const pointer={pointerId:1,preventDefault(){}};
const shots=()=>sent.filter(p=>p.type==='shot');
const aims=()=>sent.filter(p=>p.type==='action'&&p.action==='aim');
const playTake=(from=0,to=12000,origin=now,tilt=0)=>{
  for(const [t,rate]of samples)if(t>=from&&t<=to){now=origin+t;motion(rate,-20,tilt);}
};

await import('../src/phone/controller.js');
receive({type:'welcome',room:'TEST',token:'test-token',labCount:0});
receive({type:'presence',host:true});
await element('enable-motion').onclick();motion();
element('calibrate').onclick();await Promise.resolve();
receive({type:'camera.target',requestId:'test-camera',markerId:1});
receive({type:'camera.locked',requestId:'test-camera',calibration:{
  screenFromSensor:IDENTITY,gripScreen:IDENTITY,position:[0,0,3],markerWidthCm:null,
}});
receive({type:'grip.countdown',requestId:'test-rest',alignmentId:'test-camera'});
now+=2000;motion();for(const fn of [...timers.values()])fn();
receive({type:'grip.result',requestId:'test-rest',ok:true});
assert.equal(element('controls').hidden,false,'controller is calibrated through the real setup flow');

now+=150;motion([0,0,0],0,20);
assert.equal(aims().at(-1).value,0,'tilting before setting direction does not aim');
now+=150;motion([0,0,0],20);
assert.ok(Math.abs(aims().at(-1).value+17)<1e-6);assert.match(element('phone-aim').textContent,/LEFT/);
now+=150;motion([0,0,0],-20);
assert.ok(Math.abs(aims().at(-1).value-17)<1e-6);assert.match(element('phone-aim').textContent,/RIGHT/);
element('grip').onpointerdown(pointer);
assert.equal(element('phone-aim-mode').textContent,'DIRECTION SET');
assert.equal(element('phone-face').textContent,'SQUARE');
const aimCount=aims().length;
now+=60;motion([0,0,0],-45);assert.equal(sent.filter(p=>p.type==='motion').at(-1).yaw,-20,'held phone yaw cannot rotate the player');
now+=60;motion([0,0,0],-20);
now+=50;motion([0,0,0],-20,-15);assert.match(element('phone-face').textContent,/15° OPEN/);
now+=50;motion([0,0,0],-20,15);assert.match(element('phone-face').textContent,/15° CLOSED/);
// Brisk face-only adjustment and return do not become an accidental shot.
for(let i=0;i<36;i++){now+=20;motion([i<18?180:-180,0,0],-20,i<18?i*2:(36-i)*2);}
for(let i=0;i<6;i++){now+=20;motion([0,0,0],-20,0);}
assert.equal(shots().length,0);
for(let i=0;i<100;i++){now+=100;motion([0,0,0],-20,0);}
assert.equal(element('phone-aim-mode').textContent,'DIRECTION SET','take time setting the face before beginning the swing');
playTake();
assert.equal(shots().length,1,'a real recorded swing sends its shot while the pointer is still down');
assert.ok(shots()[0].power>.97);
assert.equal(shots()[0].curve,0,'a square face does not curve just because the aim was turned');
assert.equal(aims().length,aimCount,'aim stays frozen through the hold and follow-through');
assert.match(element('phone-instruction').textContent,/automatically/);
element('grip').onpointerup(pointer);
assert.equal(shots().length,1,'release never sends another shot');

for(const tilt of [-20,20]){
  now+=100;motion([0,0,0],-20,0);element('grip').onpointerdown(pointer);playTake(0,1800,now,tilt);
  assert.ok(Math.abs(shots().at(-1).curve+tilt/45)<1e-6,'face tilt controls the actual shot curve independently of heading');
  element('grip').onpointerup(pointer);
}
const successful=shots().length;assert.equal(successful,3);

now+=100;motion();const early=now;element('grip').onpointerdown(pointer);
playTake(0,1190,early);element('grip').onpointerup(pointer);playTake(1200,1800,early);
assert.equal(shots().length,successful,'releasing before the forward peak settles aborts the shot');

// Lab mode uses the same automatic recognition but never sends a game shot.
now+=100;motion();element('mode-lab').onclick();
element('grip').onpointerdown(pointer);playTake(0,1800);
assert.match(element('phone-instruction').textContent,/detected while held/);
assert.equal(shots().length,successful,'Lab recognition does not launch a ball');
element('grip').onpointerup(pointer);
element('mode-play').onclick();
receive({type:'state',state:{club:'putter',aim:0,shots:3,busy:false,finished:false,mode:'course',toPin:8.4,lie:'green',message:'Putt gently'}});
assert.equal(element('phone-distance').textContent,'8.4 m');assert.equal(element('phone-lie').textContent,'GREEN');
now+=100;motion();element('grip').onpointerdown(pointer);
for(let i=0;i<60;i++){now+=10;motion([0,i<20?22:i<40?-65:0,0]);}
assert.equal(shots().length,successful+1,'selected putter recognizes a small held back-and-through stroke');
assert.ok(shots().at(-1).power>.2&&shots().at(-1).power<.4);element('grip').onpointerup(pointer);
receive({type:'state',state:{club:'driver',aim:0,shots:0,busy:false,finished:false,mode:'course',toPin:315,lie:'tee',message:'Drive'}});
now+=100;motion();const interrupted=now;element('grip').onpointerdown(pointer);
playTake(0,1190,interrupted);listeners.get('pagehide')();playTake(1200,1800,interrupted);
assert.equal(shots().length,successful+1,'leaving the page disarms an in-progress automatic shot');

receive({type:'state',state:{club:'driver',aim:0,shots:0,busy:false,finished:false,mode:'course',toPin:315,lie:'tee',message:'Another turn',yourTurn:false,activePlayerId:'other'}});
assert.equal(element('grip').disabled,true);assert.equal(element('club').disabled,true);assert.equal(element('phone-next').hidden,true);assert.match(element('phone-turn').textContent,/playing/);
await Promise.resolve();await Promise.resolve();await Promise.resolve();
assert.ok(uploads.some(e=>e.kind==='attempt'&&e.data.endReason==='recognized'&&e.id===shots()[0].id),'raw capture and fired shot share their correlation id');
receive({type:'state',state:{club:'putter',aim:0,shots:3,busy:false,finished:false,mode:'course',toPin:8.4,lie:'green',message:'Putt'}});

// Fine aim survives the next orientation update and the direction lock.
now+=150;motion();element('aim-right').onclick();
assert.equal(aims().at(-1).value,.5);assert.match(element('phone-aim').textContent,/0.5° RIGHT/);
now+=150;motion();element('grip').onpointerdown(pointer);assert.equal(aims().at(-1).value,.5);
element('grip').onpointerup(pointer);
assert.equal(shots().at(-1).testSwing,false,'normal grip always sends scored play');
receive({type:'state',state:{club:'putter',aim:.5,shots:3,busy:false,finished:false,mode:'course',toPin:8.4,lie:'green',message:'Test a putt',testSwing:true,drill:'short',puttRead:'40% pace'}});
assert.equal(element('phone-putt-read').textContent,'40% pace');
now+=150;motion();element('test-grip').onpointerdown(pointer);
for(let i=0;i<60;i++){now+=10;motion([0,i<20?22:i<40?-65:0,0]);}
element('test-grip').onpointerup(pointer);assert.equal(shots().at(-1).testSwing,true,'second grip sends a test shot without a toggle round-trip');
receive({type:'state',state:{club:'putter',aim:.5,shots:3,busy:true,finished:true,mode:'course',toPin:8.4,lie:'green',message:'Test finished',testSwing:true}});
assert.equal(element('phone-next').textContent,'TRY AGAIN ↻');
assert.equal(element('test-grip').disabled,false);assert.equal(element('grip').disabled,false,'both buttons ready immediately after a test finishes');
now+=150;motion();element('grip').onpointerdown(pointer);
for(let i=0;i<60;i++){now+=10;motion([0,i<20?22:i<40?-65:0,0]);}
assert.equal(shots().at(-1).testSwing,false,'normal grip scores even when the last result was a test');element('grip').onpointerup(pointer);
element('phone-course').value='pine';element('phone-course').onchange();assert.deepEqual(sent.at(-1),{type:'action',action:'course',value:'pine'});
receive({type:'state',state:{club:'driver',aim:0,shots:1,busy:true,finished:true,mode:'course',toPin:100,lie:'fairway',message:'Drive',cartMode:true,cartDistance:100,cartSpeed:0}});
now+=100;motion();element('wheel-centre').onclick();assert.equal(element('wheel-drive').disabled,false);element('wheel-drive').onpointerdown(pointer);
now+=60;listeners.get('deviceorientation')({alpha:-25,beta:0,gamma:0});listeners.get('devicemotion')({rotationRate:{alpha:0,beta:0,gamma:0}});
const driving=sent.filter(p=>p.type==='drive').at(-1);assert.equal(driving.throttle,1);assert.ok(driving.steering>0,'clockwise wheel steers right');assert.equal(element('grip').disabled,true,'no swings while driving');
const secondThumb={...pointer,pointerId:2};element('wheel-drift').onpointerdown(secondThumb);
assert.equal(sent.at(-1).drift,true);assert.equal(sent.at(-1).throttle,1,'second thumb drifts while Drive stays held');
element('wheel-drift').onpointerup(secondThumb);assert.equal(sent.at(-1).drift,false);assert.equal(sent.at(-1).throttle,1,'releasing Drift keeps the accelerator held');
element('wheel-boost').onpointerdown(secondThumb);assert.equal(sent.at(-1).boost,true);element('wheel-boost').onpointercancel(secondThumb);assert.equal(sent.at(-1).boost,false);
element('wheel-boost').onpointerdown(secondThumb);
element('wheel-drive').onpointerup(pointer);assert.equal(sent.filter(p=>p.type==='drive').at(-1).brake,true);
assert.equal(sent.at(-1).boost,false,'releasing Drive also cancels boost');
element('wheel-drive').onpointerdown(pointer);now+=800;for(const fn of [...timers.values()])fn();assert.equal(sent.filter(p=>p.type==='drive').at(-1).throttle,0,'stale orientation releases the accelerator');
console.log('phonecontrollercheck: heading lock, independent live face/shot curve, face-only adjustment, automatic hits, cancellation, and Lab isolation passed');

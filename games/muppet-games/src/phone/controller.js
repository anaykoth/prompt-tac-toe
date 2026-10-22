import { wheelReference, wheelSteering } from './wheel.js';
import { COURSES, PUTTING_DRILLS } from '../golf/course.js';
import { ShotJournal } from './shot-journal.js';
import { ShotCapture } from './shot-capture.js';
import { feedbackFields, readFeedback, fillFeedback } from './shot-feedback.js';
import { PhoneLink } from './client.js';
import { SwingGesture } from './motion.js';
import { aimFromYaw, captureAddress, clubfaceAt, isFaceAdjustment, faceLabel, swingKinematics } from './address.js';
import { PhoneSwingLab } from './lab-controller.js';
import { CameraAlignment, positionLabel } from './camera.js';
import { screenOrientation, screenRelativePose } from './screen-pose.js';
import { RestingGrip } from './resting-grip.js';

const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.hash.slice(1)),room=params.get('room'),key=params.get('key');
const swing=new SwingGesture();
let wheelCentre=null,wheelPedal=0,wheelPointer=null,wheelBrake=true,lastDrive=0;
const wheelExtras={drift:null,boost:null};
function clearWheelExtras(){wheelExtras.drift=wheelExtras.boost=null;}
let addressYaw=0;
let aimOffset=0,gripTesting=false,gripElement=null;
const gripUI=part=>$(gripTesting?'test-grip-'+part:'grip-'+part);
const canRetry=()=>!!(state?.busy&&state?.finished&&state?.testSwing);
for(const course of Object.values(COURSES))$('phone-course').add(new Option(`${course.name} · par ${course.par}`,course.id));
const effectiveAim=yaw=>Math.max(-35,Math.min(35,aimFromYaw(yaw)+aimOffset));
for(const [key,drill] of Object.entries(PUTTING_DRILLS))$('phone-putting-drill').add(new Option(drill.label,key));
let playerId=null,players=[];
let state=null,hostOnline=false,enabled=false,calibrated=false,latest=null,neutral=null,lastSensor=0,lastSend=0,lastAim=0,aim=0,gripPointer=null,wakeLock=null,lastError='';
let calibration=null,orientationAt=0,sensorSpeed=0,address=null,face=0;
let token;try{token=localStorage.getItem(`felt-fairway:phone:${room}`);}catch{}
const link=new PhoneLink('controller',receive);
let lastAttemptId=null;
const journal=new ShotJournal(link,'phone',()=>{if($('phone-tracking-status'))$('phone-tracking-status').textContent=journal.status;if($('phone-export-pending'))$('phone-export-pending').hidden=!journal.pending.length;});
const capture=new ShotCapture(journal);
if($('phone-export-pending'))$('phone-export-pending').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(journal.export(),null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='phone-shot-data.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);};
if($('phone-shot-feedback'))$('phone-shot-feedback').innerHTML=feedbackFields('phone-shot');
if($('phone-shot-save'))$('phone-shot-save').onclick=()=>{if(lastAttemptId)journal.enqueue({version:1,kind:'feedback',id:lastAttemptId,data:readFeedback('phone-shot')});};
function closeAttempt(reason,shot=null){
  const id=capture.finish(reason,performance.now(),shot);if(!id)return null;lastAttemptId=id;
  if($('phone-shot-review')){$('phone-shot-review').hidden=false;$('phone-shot-summary').textContent=shot?`Last swing · ${Math.round(shot.power*100)}% · ${shot.analysis?.grade||'ungraded'}`:`No ball hit · ${reason.replaceAll('-',' ')}`;fillFeedback('phone-shot');}
  return id;
}

const lab=new PhoneSwingLab({link,ready:()=>link.connected&&hostOnline&&calibrated&&!rest.requestId&&performance.now()-lastSensor<700&&performance.now()-orientationAt<700,neutral:()=>neutral,calibration:()=>calibration,onMode:()=>cancel()});
const rest=new RestingGrip({link,ready:()=>!!calibration&&enabled&&hostOnline&&link.connected&&!camera.active&&!lab.recording&&!lab.countdown&&performance.now()-lastSensor<700&&performance.now()-orientationAt<700,capture:()=>calibrate(),onStatus:(message)=>{
  $('sensor-status').textContent=message;$('phone-instruction').textContent=message;updateReady();
}});
const camera=new CameraAlignment({link,sensor:()=>orientationAvailable&&performance.now()-lastSensor<350?{orientation:latest,time:orientationAt,speed:sensorSpeed}:null,onLock:(c,id)=>{
  rest.align(id);
  calibration=c;$('alignment-summary').hidden=false;$('alignment-summary').textContent=positionLabel(c);
  $('set-grip').hidden=false;$('setup-help').textContent='Screen locked. Lower the phone like a club at rest. Click Set resting position on the computer, or tap below. You get two seconds to settle.';
  $('sensor-status').textContent='Camera off. The screen reference is saved; sensors now track your rotation.';updateReady();
},onCancel:()=>updateReady()});
if(room&&(token||key))link.connect({room,key,token});else{$('phone-status').textContent='SCAN THE QR ON YOUR COMPUTER';$('setup-help').textContent='Open Felt Fairway on your computer and scan its QR code to connect this phone.';}

function ready(){return !state?.cartMode&&(state?.yourTurn!==false||lab.mode)&&link.connected&&hostOnline&&calibrated&&!rest.requestId&&performance.now()-lastSensor<700&&performance.now()-orientationAt<700&&(!state?.busy||canRetry()||lab.mode);}
function updateReady(){
  const wheelReady=!!wheelCentre&&enabled&&hostOnline&&state?.yourTurn!==false&&performance.now()-lastSensor<700&&performance.now()-orientationAt<700;
  $('wheel-drive').disabled=$('wheel-reverse').disabled=$('wheel-drift').disabled=$('wheel-boost').disabled=!wheelReady;$('wheel-centre').disabled=!enabled||performance.now()-orientationAt>700;
  $('grip').disabled=$('test-grip').disabled=!ready();
  $('aim-left').disabled=$('aim-right').disabled=!ready()||gripPointer!==null||lab.mode;$('enable-motion').disabled=!link.connected||!hostOnline||enabled;
  $('calibrate').disabled=!enabled||!hostOnline||!link.connected||camera.active;
  $('set-grip').disabled=!calibration||!orientationAvailable||performance.now()-orientationAt>700||performance.now()-lastSensor>700||!hostOnline||camera.active||!!rest.requestId;
  $('recenter').disabled=!!lab.recording||!!lab.countdown||!!rest.requestId;
}
function renderAddress(){
  $('phone-aim-mode').textContent=address?'DIRECTION SET':'TURN TO AIM';
  $('phone-aim').textContent=Math.abs(aim)<(state?.club==='putter'?.1:1)?'CENTRE':`${Math.abs(aim).toFixed(state?.club==='putter'?1:0)}° ${aim<0?'LEFT':'RIGHT'}`;$('aim-needle').style.left=`${50+aim/70*100}%`;
  $('phone-face').textContent=address?faceLabel(face):'HOLD SWING TO SET';$('face-needle').style.left=`${50+face/90*100}%`;
}
function cancel(reason='cancelled'){closeAttempt(typeof reason==='string'?reason:'cancelled');if(gripPointer!==null&&swing.active)lab.event('cancel');swing.cancel();gripPointer=null;address=null;face=0;renderAddress();$('grip').classList.remove('held');$('test-grip').classList.remove('held');gripElement=null;$('test-grip-top').textContent='HOLD TO';$('test-grip-title').textContent='TEST SWING';$('test-grip-bottom').textContent='Same stroke. Ball & score saved.';$('grip-top').textContent='HOLD TO';$('grip-title').textContent=state?.busy&&!canRetry()&&!lab.mode?'WAIT':state?.club==='putter'?'PUTT':'SWING';$('phone-power').style.width='0%';$('phone-power-label').textContent='0%';link.send({type:'action',action:'cancel'});}
function receive(p){
  lab.receive(p);
  camera.receive(p);
  if(p.type==='grip.countdown')cancel();
  rest.receive(p);
  if(p.type==='welcome'){
    journal.welcome();
    try{localStorage.setItem(`felt-fairway:phone:${p.room}`,p.token);}catch{}
    playerId=p.playerId; if($('player-name'))$('player-name').value=p.name||'Player';
    // The one-use pairing key is no longer needed in the address bar.
    history.replaceState(null,'',`${location.pathname}#room=${encodeURIComponent(p.room)}`);
    $('phone-status').textContent='CONNECTED · WAITING FOR COMPUTER';if(p.state)gameState(p.state);lastError='';
  }else if(p.type==='presence'){
    if(p.players){players=p.players;renderTurn();}
    hostOnline=p.host;$('phone-dot').classList.toggle('online',hostOnline);$('phone-status').textContent=hostOnline?'CONNECTED TO FELT FAIRWAY':'COMPUTER DISCONNECTED';
    if(!hostOnline){wheelPedal=0;wheelBrake=true;clearWheelExtras();cancel();clearAlignment();$('controls').hidden=true;$('setup').hidden=false;$('setup-help').textContent='Keep the range open on your computer. Align with its screen when it reconnects.';}
    updateReady();
  }else if(p.type==='state')gameState(p.state);
  else if(p.type==='pong')$('latency').textContent=`${p.latency} ms`;
  else if(p.type==='error'){
    lastError=p.message;$('phone-status').textContent=p.message;$('setup-help').textContent=p.message;
    if(!link.connected){try{localStorage.removeItem(`felt-fairway:phone:${room}`);}catch{}}
  }else if(p.type==='disconnected'){
    hostOnline=false;wheelPedal=0;wheelBrake=true;clearWheelExtras();cancel('interrupted');clearAlignment();$('phone-dot').classList.remove('online');$('phone-status').textContent=lastError||p.message;
    $('controls').hidden=true;$('setup').hidden=false;$('setup-help').textContent=p.terminal?(lastError||p.message):'Reconnecting to the range. Your swing has been cancelled.';updateReady();
  }
}
function renderTurn(){
  if(!$('phone-turn'))return;
  const active=players.find(p=>p.id===state?.activePlayerId),me=players.find(p=>p.id===playerId);
  $('phone-turn').textContent=state?.yourTurn===false?`${active?.name||'Another player'} is playing · your turn follows`: `${me?.name||'You'} · YOUR TURN`;
  if(me&&document.activeElement!==$('player-name'))$('player-name').value=me.name;
}
if($('save-player-name'))$('save-player-name').onclick=()=>link.send({type:'player.name',name:$('player-name').value});
function gameState(s){
  document.body.classList.toggle('phone-driving',!!s.cartMode&&calibrated);
  if(s.yourTurn===false){wheelPedal=0;wheelPointer=null;wheelBrake=true;clearWheelExtras();}
  if(!!state?.cartMode!==!!s.cartMode){cancel();wheelPedal=0;wheelPointer=null;wheelBrake=true;wheelCentre=null;clearWheelExtras();}
  $('controls').classList.toggle('cart-active',!!s.cartMode);$('phone-cart').hidden=!s.cartMode;$('phone-cart-toggle').textContent=s.cartMode?'LEAVE CART ↙':'GET IN CART ↗';$('phone-cart-toggle').disabled=(s.busy&&!s.finished)||s.yourTurn===false;
  if(s.cartMode){$('phone-cart-status').textContent=wheelCentre?`${Math.round(s.cartSpeed||0)} km/h · ${Math.round(s.cartDistance||0)} m to your ball${s.cartArrived?' · hop out to play':''}`:'Raise the phone like a wheel, then tap Centre steering.';$('wheel-exit').textContent=s.cartArrived?'HOP OUT & PLAY ↗':'BACK TO GOLF ↗';}
  if(s.cartMode){$('wheel-handling').textContent=s.cartSpinning?'SPINOUT · EASE OFF':s.cartBoosting?'BOOSTING ↗':s.cartDrifting?'DRIFTING · COUNTERSTEER':'GRIP & RIP';$('wheel-boost-fill').style.width=(s.cartBoost??1)*100+'%';$('wheel-boost-label').textContent=`BOOST · ${Math.round((s.cartBoost??1)*100)}%`;}

  if(s.yourTurn===false&&gripPointer!==null)cancel('turn-changed');
  if(state&&(state.club!==s.club||state.mode!==s.mode||state.courseId!==s.courseId||state.drill!==s.drill)&&gripPointer!==null)cancel();
  if(state&&(state.mode!==s.mode||state.courseId!==s.courseId||state.drill!==s.drill||state.activePlayerId!==s.activePlayerId))aimOffset=0;
  state=s;renderTurn();$('phone-course').value=s.courseId||'bramble';$('phone-course').disabled=(s.busy&&!s.finished)||s.yourTurn===false;$('club').value=s.club;$('play-mode').value=s.mode||'course';$('phone-lie').textContent=(s.lie||'tee').toUpperCase();$('phone-shots').textContent=s.shots;
  $('phone-distance').textContent=Number.isFinite(s.toPin)?`${s.toPin<10?s.toPin.toFixed(1):Math.round(s.toPin)} m`:'—';$('phone-instruction').textContent=s.message;
  $('phone-next').hidden=!s.finished||s.yourTurn===false;
  $('phone-next').textContent=s.testSwing?'TRY AGAIN ↻':s.holed?(s.mode==='putting'?'PUTT AGAIN ↻':'PLAY AGAIN ↻'):'NEXT SHOT ↗';
  $('phone-test-help').textContent='Hold Test swing to rehearse. Hold Swing / Putt to play for score. Keep holding through the stroke.';
  $('phone-drill-wrap').hidden=s.mode!=='putting';$('phone-putting-drill').value=s.drill||'standard';$('phone-putting-drill').disabled=(s.busy&&!s.finished)||s.yourTurn===false;
  $('phone-putt-read').hidden=s.club!=='putter';$('phone-putt-read').textContent=s.puttRead||'Small back-and-through stroke. Keep holding.';
  $('phone-fine-aim').hidden=s.club!=='putter';
  if(s.cartMode){updateReady();return;}
  $('club').disabled=(s.busy&&!canRetry())||s.yourTurn===false;$('play-mode').disabled=(s.busy&&!s.finished)||s.yourTurn===false;
  if(s.yourTurn===false&&!lab.mode){cancel();$('grip-title').textContent='WAIT';$('grip-top').textContent='NEXT UP';$('grip-bottom').textContent='Your ball and score are saved.';}
  else if(s.busy&&!canRetry()&&!lab.mode){cancel();$('grip-title').textContent='WATCH';$('grip-top').textContent='EYES UP';$('grip-bottom').textContent='Your shot is on the computer.';}
  else if(gripPointer===null){$('grip-title').textContent=s.club==='putter'?'PUTT':'SWING';$('grip-top').textContent='HOLD TO';$('grip-bottom').textContent=s.club==='putter'?'Small back-and-through stroke. Keep holding.':'Keep holding. Swing through.';}
  updateReady();
}
async function keepAwake(){try{wakeLock=await navigator.wakeLock?.request('screen');}catch{/* Optional; foreground recovery cancels any grip. */}}
function orientation(event){
  if(![event.alpha,event.beta,event.gamma].every(Number.isFinite))return;
  latest={alpha:event.alpha,beta:event.beta,gamma:event.gamma};
  orientationAt=performance.now();
}
function motion(event){
  const now=performance.now();
  capture.sample(event,orientationAvailable&&now-orientationAt<300?latest:null,now);
  lab.sample(event,orientationAvailable&&now-orientationAt<300?latest:null,now);
  const r=event.rotationRate;
  if(!r||![r.alpha,r.beta,r.gamma].every(Number.isFinite))return;
  lastSensor=now;
  sensorSpeed=Math.hypot(r.alpha,r.beta,r.gamma);
  if(state?.cartMode){sendDrive(now);updateReady();return;}
  if(!calibrated){if(!camera.active&&!calibration&&$('sensor-status').textContent==='Waiting for your phone’s gyroscope…')$('sensor-status').textContent='Motion is working. Tap Align with screen to set the starting reference.';updateReady();return;}
  const pose=latest||neutral;
  if(now-orientationAt>700){cancel('orientation-stale');$('phone-instruction').textContent='Orientation paused. Keep this page open and realign if readings do not resume.';return;}
  const {pitch,roll,yaw}=screenRelativePose(pose,calibration);
  if(swing.active&&!ready())cancel();
  if(address)face=swing.fired?swing.faceAtPeak:clubfaceAt(pose,calibration,address,face);
  const rate=[r.alpha,r.beta,r.gamma];
  // Setting the face alone must not start a backswing. Once the swing starts,
  // retain its full gyro signal so face movement cannot create a fake speed dip.
  const adjusting=address&&swing.axis===null&&isFaceAdjustment(pose,calibration,address,rate);
  const kinematics=address?swingKinematics(pose,calibration,address,rate,event.acceleration):{};
  const shot=swing.sample(adjusting?[0,0,0]:rate,now,face,adjusting?{}:kinematics);
  if(shot){
    if(navigator.vibrate)navigator.vibrate(20);
    face=swing.faceAtPeak;
    lab.event('recognized',`${Math.round(shot.power*100)}% power · ${shot.analysis?.grade||'SWING'} · face ${shot.analysis?.face??face}°, path ${shot.analysis?.path??0}°`);
    if(!lab.mode){const id=closeAttempt('recognized',shot)||crypto.randomUUID();link.send({type:'shot',id,...shot,testSwing:gripTesting});}
    gripUI('title').textContent='HIT';gripUI('top').textContent='SWING READ';gripUI('bottom').textContent='Finish your swing. No release needed.';
    $('phone-instruction').textContent=lab.mode?'Swing detected while held. Raw motion is recorded; no ball was hit.':'Swing sent automatically. Watch the computer!';
  }
  if(gripPointer!==null&&!swing.active&&!swing.fired){cancel(swing.cancelReason==='timed-out'?'timed-out':'sensor-gap');$('phone-instruction').textContent='Swing interrupted or timed out. Hold Swing to set up again.';}
  if(gripPointer===null&&(!state?.busy||canRetry())&&state?.yourTurn!==false&&!lab.mode){
    aim=effectiveAim(yaw);
    if(now-lastAim>100&&Math.abs(aim-(state?.aim||0))>.4){link.send({type:'action',action:'aim',value:aim});lastAim=now;}
  }
  renderAddress();
  if(state?.yourTurn!==false&&now-lastSend>=33){link.send({type:'motion',pitch,roll,yaw:address?addressYaw:yaw,face,power:swing.power,armed:swing.active,shaft:kinematics.shaft});lastSend=now;}
  $('phone-power').style.width=`${swing.power*100}%`;$('phone-power-label').textContent=`${Math.round(swing.power*100)}%`;
  if(swing.active){gripUI('title').textContent=swing.phase==='back'?'SET':'THROUGH';gripUI('bottom').textContent=swing.phase==='back'?'Direction locked. Tilt the face, then swing.':'Keep holding. The swing hits automatically.';}
  updateReady();
}
let orientationAvailable=false;
function onOrientation(event){if([event.alpha,event.beta,event.gamma].every(Number.isFinite)){orientationAvailable=true;orientation(event);}}
$('enable-motion').onclick=async()=>{
  if(!window.isSecureContext){$('sensor-status').textContent='Motion needs HTTPS. Open the secure link from the computer’s QR code.';return;}
  if(!window.DeviceMotionEvent){$('sensor-status').textContent='This browser has no motion sensors. Open this link in Safari on iPhone or Chrome on Android.';return;}
  try{
    // Start both permission requests directly inside the tap's user activation.
    const motionPermission=typeof DeviceMotionEvent.requestPermission==='function'?DeviceMotionEvent.requestPermission():Promise.resolve('granted');
    const orientationPermission=typeof window.DeviceOrientationEvent?.requestPermission==='function'?DeviceOrientationEvent.requestPermission():Promise.resolve('granted');
    const [motionResult,orientationResult]=await Promise.all([motionPermission,orientationPermission.catch(()=> 'denied')]);
    if(motionResult!=='granted')throw Error('Motion permission was denied. Allow Motion & Orientation in this site’s browser settings, then try again.');
    if(orientationResult!=='granted')throw Error('Screen alignment also needs orientation. Allow Motion & Orientation in this site’s browser settings, then try again.');
    enabled=true;window.addEventListener('deviceorientation',onOrientation);window.addEventListener('devicemotion',motion);
    $('enable-motion').textContent='MOTION ENABLED ✓';$('sensor-status').textContent='Waiting for your phone’s gyroscope…';keepAwake();updateReady();
    setTimeout(()=>{if(!lastSensor)$('sensor-status').textContent='No gyroscope readings yet. Use a phone with motion sensors, keep this page open, and check its motion permission.';},4000);
  }catch(error){$('sensor-status').textContent=error.message;}
};
function calibrate(){
  if(!calibration||!enabled||performance.now()-lastSensor>700||performance.now()-orientationAt>700||!latest){$('sensor-status').textContent='Align the camera with your computer and wait for live motion readings first.';return null;}
  if(lab.recording||lab.countdown)return null;
  calibration={...calibration,gripScreen:screenOrientation(latest,calibration)};
  cancel();neutral={...latest};calibrated=true;aim=0;aimOffset=0;$('setup').hidden=true;$('controls').hidden=false;
  $('phone-aim').textContent='CENTRE';$('aim-needle').style.left='50%';link.send({type:'action',action:'aim',value:0});link.send({type:'action',action:'calibrated'});
  $('phone-instruction').textContent='Turn to aim. Hold Swing to set direction, then tilt the face and swing through.';updateReady();keepAwake();
  return calibration.gripScreen;
}
function clearAlignment(){rest.clear();calibrated=false;calibration=null;$('set-grip').hidden=true;$('alignment-summary').hidden=true;}
$('calibrate').onclick=()=>{cancel();clearAlignment();camera.start();};$('set-grip').onclick=()=>rest.request();$('recenter').onclick=()=>{cancel();rest.request();};
$('recalibrate').onclick=()=>{lab.finish('realignment');cancel();clearAlignment();$('controls').hidden=true;$('setup').hidden=false;$('setup-help').textContent='Point the rear camera at your computer to refresh the screen reference.';updateReady();};
function beginGrip(event,testing,button){
  if(!ready()||gripPointer!==null)return;
  event.preventDefault();gripTesting=testing;gripElement=button;gripPointer=event.pointerId;button.setPointerCapture(event.pointerId);
  const pose=latest||neutral,now=performance.now(),rotation=screenRelativePose(pose,calibration);
  aim=effectiveAim(rotation.yaw);addressYaw=rotation.yaw;address=captureAddress(pose,calibration);face=0;
  if(!lab.mode)link.send({type:'action',action:'aim',value:aim}); // Flush the exact heading at button-down.
  lab.event('grip-down',`Direction ${aim.toFixed(1)}°; face square`);
  if(!lab.mode)capture.begin(now,{testSwing:gripTesting,courseId:state?.courseId||'bramble',club:state?.club||'driver',mode:state?.mode||'course',aim,address:structuredClone(address),calibration:structuredClone(calibration)});
  swing.begin(now,state?.club||'driver');renderAddress();
  link.send({type:'motion',...rotation,face:0,power:0,armed:true});lastSend=now;
  button.classList.add('held');gripUI('top').textContent=testing?'TEST · DIRECTION SET':'DIRECTION SET';$('phone-instruction').textContent='Direction locked. Tilt to open or close the face, then swing while holding.';
};
function releaseGrip(event){
  if(event.pointerId!==gripPointer)return;
  event.preventDefault();lab.event('grip-up');const fired=swing.fired;
  if(!fired)lab.event('rejected','Grip released before an automatic hit');
  if(!fired)closeAttempt('released-early');
  swing.release();gripPointer=null;cancel();
  if(!fired)$('phone-instruction').textContent='No shot. Keep the circle held through your backswing and forward swing.';
};
for(const [id,testing] of [['grip',false],['test-grip',true]]){
  const button=$(id);button.addEventListener('contextmenu',e=>e.preventDefault());button.onpointerdown=e=>beginGrip(e,testing,button);button.onpointerup=releaseGrip;
  button.onpointercancel=()=>{if(gripElement===button)cancel();};button.onlostpointercapture=()=>{if(gripElement===button&&gripPointer!==null)cancel();};
}
function sendDrive(now=performance.now(),force=false){
  if(!state?.cartMode||state?.yourTurn===false||!hostOnline||!link.connected)return;
  if(!wheelCentre||now-lastSensor>700||now-orientationAt>700){wheelPedal=0;wheelBrake=true;clearWheelExtras();}
  if(!force&&now-lastDrive<50)return;
  const steering=wheelSteering(latest,wheelCentre);$('wheel-visual').style.transform=`rotate(${steering*45}deg)`;
  link.send({type:'drive',steering,throttle:wheelPedal,brake:wheelBrake,drift:wheelExtras.drift!==null,boost:wheelExtras.boost!==null});lastDrive=now;
}
function brakeCart(){wheelPedal=0;wheelPointer=null;wheelBrake=true;clearWheelExtras();sendDrive(performance.now(),true);}
$('wheel-centre').onclick=()=>{if(!latest)return;wheelCentre=wheelReference(latest);brakeCart();updateReady();};
for(const [id,pedal] of [['wheel-drive',1],['wheel-reverse',-1]]){const b=$(id);b.addEventListener('contextmenu',e=>e.preventDefault());b.onpointerdown=e=>{if(b.disabled||wheelPointer!==null||!state?.cartMode)return;e.preventDefault();b.setPointerCapture(e.pointerId);wheelPointer=e.pointerId;wheelPedal=pedal;wheelBrake=false;sendDrive(performance.now(),true);};b.onpointerup=e=>{if(wheelPointer===e.pointerId)brakeCart();};b.onpointercancel=brakeCart;b.onlostpointercapture=()=>{if(wheelPointer!==null)brakeCart();};}
$('wheel-brake').onpointerdown=brakeCart;$('wheel-brake').onclick=brakeCart;
for(const action of ['drift','boost']){
  const b=$('wheel-'+action);b.addEventListener('contextmenu',e=>e.preventDefault());
  b.onpointerdown=e=>{if(b.disabled||!state?.cartMode)return;e.preventDefault();b.setPointerCapture(e.pointerId);wheelExtras[action]=e.pointerId;sendDrive(performance.now(),true);};
  const release=e=>{if(e.pointerId===wheelExtras[action]){wheelExtras[action]=null;sendDrive(performance.now(),true);}};
  b.onpointerup=b.onpointercancel=b.onlostpointercapture=release;
}
$('wheel-exit').onclick=()=>{brakeCart();link.send({type:'action',action:'cart',value:'exit'});};
$('phone-cart-toggle').onclick=()=>{cancel();brakeCart();link.send({type:'action',action:'cart',value:state?.cartMode?'exit':'enter'});};
setInterval(()=>{if(state?.cartMode){sendDrive();updateReady();}},100);
$('phone-course').onchange=()=>{cancel();link.send({type:'action',action:'course',value:$('phone-course').value});};
$('phone-putting-drill').onchange=()=>{cancel();link.send({type:'action',action:'drill',value:$('phone-putting-drill').value});};
function fineAim(delta){
  if(!ready()||gripPointer!==null||lab.mode)return;
  const yaw=screenRelativePose(latest||neutral,calibration).yaw,current=effectiveAim(yaw);
  aim=Math.max(-35,Math.min(35,current+delta));aimOffset+=aim-current;
  link.send({type:'action',action:'aim',value:aim});renderAddress();
}
$('aim-left').onclick=()=>fineAim(-.5);$('aim-right').onclick=()=>fineAim(.5);
$('club').onchange=()=>link.send({type:'action',action:'club',value:$('club').value});
$('play-mode').onchange=()=>link.send({type:'action',action:'mode',value:$('play-mode').value});
$('phone-next').onclick=()=>link.send({type:'action',action:'next'});
document.addEventListener('visibilitychange',()=>{
  brakeCart();
  if(document.hidden)lab.finish('tab-hidden');
  cancel(document.hidden?'tab-hidden':'cancelled');
  if(document.hidden){camera.stop();clearAlignment();wakeLock?.release();}
  else{$('controls').hidden=true;$('setup').hidden=false;$('setup-help').textContent='Welcome back. Align the rear camera with your computer again.';keepAwake();}
  updateReady();
});
window.addEventListener('pagehide',()=>{brakeCart();closeAttempt('page-left');lab.finish('page-left');camera.stop();rest.clear();cancel();});
setInterval(()=>{if(calibrated&&performance.now()-lastSensor>700){cancel('sensor-gap');$('phone-instruction').textContent='Motion paused. Keep this page open and move the phone to resume.';}updateReady();},350);
updateReady();

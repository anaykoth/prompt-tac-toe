import { GolfCart } from './cart.js';
import { PuttingCoach, puttingRead } from './putting.js';
import { ShotHistory } from './shot-history.js';
import { GolfParty } from './party.js';
import { SwingReview } from './swing-review.js';
import { demoSwing } from '../phone/swing-analysis.js';
import QRCode from 'qrcode';
import { PhoneLink } from '../phone/client.js';
import { GolfScene } from './scene.js';
import { CLUBS, stepBall } from './model.js';
import { COURSES, selectCourse, HOLE, PUTTING_DRILLS, heightAt, surfaceAt } from './course.js';
import { SwingLab } from './lab.js';
import { ScreenAlignment } from './alignment.js';
import { faceLabel } from '../phone/address.js';

const $=id=>document.getElementById(id),party=new GolfParty();
let round=party.round;
const cart=new GolfCart();
const view=new GolfScene($('range')),review=new SwingReview(),coach=new PuttingCoach(view);
let puttingDrill='short';
const canRetry=()=>!!(round.finished&&round.ball?.testSwing);
for(const course of Object.values(COURSES))$('course-select').add(new Option(`${course.name} · par ${course.par}`,course.id));
for(const [key,drill] of Object.entries(PUTTING_DRILLS))$('putting-drill').add(new Option(drill.label,key));
let accumulator=0,last=performance.now(),hostRoom='',pairKey='',publicUrl='',controller=false,motionAt=0;
let message='Turn to aim. Hold Swing to set direction, tilt the face, then swing through.';
let credentials={};try{credentials=JSON.parse(sessionStorage.getItem('felt-fairway:host')||'{}');}catch{}
const link=new PhoneLink('host',receive);
const history=new ShotHistory(link,review);
const lab=new SwingLab(link,()=>{if(round.finished)next();});
const alignment=new ScreenAlignment(link,()=>lab.close());
const formatDistance=d=>d<10?d.toFixed(1):Math.round(d);
const state=()=>({cartMode:cart.active,cartDistance:cart.distance,cartSpeed:cart.groundSpeed*3.6,cartArrived:cart.arrived,cartBoost:cart.boostCharge,cartBoosting:cart.boosting,cartDrifting:cart.drifting,cartSpinning:cart.spinning,courseId:HOLE.id,testSwing:!!round.ball?.testSwing,drill:round.drill,puttRead:round.club==='putter'?puttingRead(coach.guide):'',activePlayerId:party.activeId,standings:[...party.players.values()].map(p=>({id:p.id,shots:p.round.shots,toPin:p.round.toPin,lie:p.round.lie,holed:p.round.holed})),club:round.club,aim:round.aim,target:110,shots:round.shots,score:0,busy:!!round.ball,finished:round.finished,lastDistance:round.lastDistance,message,mode:round.mode,toPin:round.toPin,lie:round.lie,holed:round.holed});
for(const [key,c]of Object.entries(CLUBS)){
  const b=document.createElement('button');b.dataset.club=key;b.innerHTML=`<b>${c.short}</b><span>${c.label}</span>`;b.title=`${c.label} · full swing about ${c.range}`;b.onclick=()=>chooseClub(key);$('club-buttons').append(b);
}
function publish(){render();link.send({type:'state',state:state()});}
function render(){
  $('cart-toggle').disabled=!!round.ball&&!round.finished;$('cart-toggle').textContent=cart.active?'LEAVE CART ↙':'GET IN CART ↗';$('cart-hud').hidden=!cart.active;document.body.classList.toggle('cart-active',cart.active);
  $('hole-meta').textContent=round.mode==='putting'?'PRACTICE / PUTTING':`01 / PAR ${HOLE.par} · ${HOLE.length} M`;
  $('course-title').textContent=HOLE.name;$('course-subtitle').textContent=HOLE.subtitle;$('course-select').value=HOLE.id;$('course-select').disabled=!!round.ball&&!round.finished;$('map-caption').textContent=`01 · ${HOLE.name.toUpperCase()} · ${HOLE.length} m`;
  $('distance').textContent=formatDistance(round.toPin);$('shots').textContent=round.shots;$('lie').textContent=round.lie.toUpperCase();
  const rise=heightAt(HOLE.cup.x,HOLE.cup.z)-heightAt(round.position.x,round.position.z);
  $('elevation').textContent=round.club==='putter'?(Math.abs(rise)<.005?'LEVEL PUTT':`${Math.round(Math.abs(rise)*100)} CM ${rise>0?'UPHILL':'DOWNHILL'} TO THE CUP`):Math.abs(rise)<.5?'LEVEL WITH THE PIN':`${rise>0?'↗':'↘'} ${Math.abs(rise).toFixed(1)} M ${rise>0?'UPHILL':'DOWNHILL'} TO THE PIN`;
  $('club-name').textContent=CLUBS[round.club].label.toUpperCase();$('club-range').textContent=round.club==='putter'?'ROLL · 0–20 M':'FULL SWING ≈ '+CLUBS[round.club].range.toUpperCase();
  $('aim-label').textContent=Math.abs(round.aim)<(round.club==='putter'?.1:1)?'AIMED AT THE PIN':`${Math.abs(round.aim).toFixed(round.club==='putter'?1:0)}° ${round.aim<0?'LEFT':'RIGHT'} OF PIN`;
  document.querySelectorAll('[data-club]').forEach(b=>{b.classList.toggle('selected',b.dataset.club===round.club);b.setAttribute('aria-pressed',b.dataset.club===round.club);b.disabled=!!round.ball&&!canRetry();});
  document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('selected',b.dataset.mode===round.mode);b.disabled=!!round.ball&&!round.finished;});
  $('next').hidden=!round.finished;$('next').textContent=round.holed?(round.mode==='putting'?'PUTT AGAIN ↻':'PLAY AGAIN ↻'):'NEXT SHOT ↗';
  $('practice-test').disabled=$('practice-shot').disabled=$('practice-club').disabled=$('practice-aim').disabled=!!round.ball&&!canRetry();
  $('restart-hole').disabled=!!round.ball&&!round.finished;
  $('practice-club').value=round.club;$('practice-aim').value=round.aim;
  $('overview').textContent=view.overview?'BACK TO BALL ↙':'FLYOVER ↗';$('overview').setAttribute('aria-pressed',view.overview);
  $('cup-view').textContent=$('putt-cup-view').textContent=view.cupView?'BACK TO BALL ↙':'CUP CLOSE-UP ↗';$('cup-scale').hidden=!view.cupView;
  $('test-swing').disabled=!!round.ball&&!round.finished||round.holed;$('shot-view').setAttribute('aria-pressed',view.shotView);$('shot-view').textContent=view.shotView?'BACK TO BALL ↙':'3D SHOT VIEW ↗';
  if(round.ball?.testSwing&&round.finished)$('next').textContent='TRY AGAIN ↻';
  coach.update(round);renderPlayers();drawMap();
}
function chooseClub(club){if(!Object.hasOwn(CLUBS,club))return;if(canRetry()){round.next();view.reset();}if(round.ball)return;round.club=club;message=readyMessage();$('commentary').textContent=message;publish();}
function readyMessage(){return (round.club==='putter'?'Hold Putt, make a small back-and-through stroke, and keep holding.':'Turn to aim. Hold Swing, set the face, then swing through.');}
async function pairing(){
  if(!pairKey){$('qr').hidden=true;$('qr-wait').hidden=false;$('qr-wait').textContent='Preparing the next player’s QR code…';$('controller-link').hidden=true;return;}
  const origin=publicUrl||(location.protocol==='https:'?location.origin:'');
  if(!origin){$('qr').hidden=true;$('qr-wait').hidden=false;$('qr-wait').textContent='Waiting for the secure phone link…';return;}
  const url=new URL('/controller.html',origin);url.hash=new URLSearchParams({room:hostRoom,key:pairKey}).toString();
  await QRCode.toCanvas($('qr'),url.href,{width:224,margin:3,errorCorrectionLevel:'M',color:{dark:'#173e34',light:'#ffffff'}});
  $('qr').hidden=false;$('qr-wait').hidden=true;$('controller-link').hidden=false;$('controller-link').href=url.href;
}
async function config(){try{const response=await fetch('/phone-config');if(!response.ok)return;const c=await response.json();if(c.publicUrl!==publicUrl){publicUrl=c.publicUrl;await pairing();}}catch{}}
config();setInterval(config,5000);
function receive(p){
  lab.receive(p);alignment.receive(p);history.receive(p);
  if(p.type==='welcome'){
    hostRoom=p.room;pairKey=p.pairKey;if(p.players){party.sync(p.players);round=party.round;}try{sessionStorage.setItem('felt-fairway:host',JSON.stringify({room:p.room,token:p.token}));}catch{}
    $('room-code').textContent=p.room;$('connection').textContent='READY FOR YOUR PHONE';pairing();publish();
  }else if(p.type==='pair.key'){pairKey=p.key;if(!p.joined)$('pairing').hidden=false;pairing();}
  else if(p.type==='presence'){
    const previous=party.activeId,count=party.players.size;
    if(p.players){party.sync(p.players);round=party.round;}
    controller=!!party.players.get(party.activeId)?.online;
    const online=[...party.players.values()].filter(p=>p.online).length;
    $('status-dot').classList.toggle('online',online>0);$('connection').textContent=online?`${online} PHONE${online===1?'':'S'} CONNECTED`:'WAITING FOR PHONES';
    if(count===0&&party.players.size){$('pairing').hidden=true;$('swing-label').textContent='ALIGN WITH SCREEN ON YOUR PHONE';}
    $('pair-message').textContent='Each player scans the current QR, enters a name, and aligns their own phone. Up to 8 players.';
    if(previous!==party.activeId){cart.reset(round.position);view.reset();alignment.clearRest();}
    if(!controller){cart.stop();view.setMotion({pitch:0,roll:0,yaw:0,armed:false});$('power-fill').style.width='0%';$('swing-label').textContent=party.players.size?'SELECT A CONNECTED PLAYER':'PAIR A PHONE OR TRY MOUSE CONTROLS';}
    publish();
  }else if(p.type==='motion'){
    if(p.playerId&&p.playerId!==party.activeId)return;
    if(p.armed&&!round.ball||p.armed&&canRetry())round.lockDirection();else if(!p.armed&&!round.ball)round.unlockDirection();
    view.setMotion(p);motionAt=performance.now();$('power-fill').style.width=`${p.power*100}%`;$('swing-label').textContent=p.armed?'FACING & GUIDE LOCKED · SWING THROUGH':'TURN TO AIM · HOLD TO SET';$('face-label').textContent=`FACE ${faceLabel(p.face??0)}`;
  }else if(p.type==='drive'){if(cart.active&&(!p.playerId||p.playerId===party.activeId))cart.setInput(p,performance.now()/1000);}
  else if(p.type==='shot'){if(!p.playerId||p.playerId===party.activeId)shoot(p.power,p.curve,p.analysis,{id:p.id,source:'phone',testSwing:!!p.testSwing});}
  else if(p.type==='action'){
    if(p.playerId&&p.playerId!==party.activeId)return;
    if(p.action==='cart'){if(p.value==='enter')enterCart();else exitCart();return;}
    if(cart.active&&p.action!=='cancel')return;
    if(p.action==='next'&&round.finished)next();
    if(p.action==='reset'&&(!round.ball||round.finished))start(round.mode);
    if(p.action==='mode'&&(!round.ball||round.finished))start(p.value);
    if(p.action==='course')chooseCourse(p.value);
    if(p.action==='drill'&&(!round.ball||round.finished)&&Object.hasOwn(PUTTING_DRILLS,p.value)){puttingDrill=p.value;start('putting');}
    if(p.action==='calibrated'){$('phase').textContent='YOUR PHONE. YOUR CLUB.';$('commentary').textContent=readyMessage();}
    if(p.action==='cancel'){if(!round.ball||canRetry())round.unlockDirection();$('power-fill').style.width='0%';$('face-label').textContent='FACE SQUARE';view.setMotion({pitch:0,roll:0,yaw:0,face:0,armed:false});}
    if(p.action==='aim'&&round.setAim(p.value))publish();
    if(p.action==='club')chooseClub(p.value);
  }else if(p.type==='error'){
    $('connection').textContent=p.message;
    if(!link.connected&&(hostRoom||credentials.room)){try{sessionStorage.removeItem('felt-fairway:host');}catch{}credentials={};hostRoom='';link.connect();}
  }else if(p.type==='disconnected'){$('connection').textContent=p.message;$('status-dot').classList.remove('online');controller=false;}
}
function shoot(power,curve=0,analysis=null,tracking={source:'demo'}){
  if(cart.active)return;
  if(canRetry())round.next();
  if(!round.shoot(power,curve,analysis,{testSwing:!!tracking.testSwing}))return;
  history.launch(round,{...tracking,playerId:party.activeId||'practice',playerName:party.players.get(party.activeId)?.name||'Practice',power,curve});
  if(analysis){review.show(analysis,round.ball.delivery);review.panel.hidden=true;if(analysis.source==='phone')$('swing-source').textContent=`${party.players.get(party.activeId)?.name||'YOUR PHONE'} / VIRTUAL CLUB`;}
  view.hit();message=round.club==='putter'?'Ball rolling. Watch the green.':'Ball in flight. Watch the fairway!';
  $('phase').textContent=round.club==='putter'?'A LITTLE TOUCH. A LITTLE HOPE.':'OVER THE HILLS AND AWAY.';
  $('commentary').textContent=`${round.ball.testSwing?'TEST SWING':`Stroke ${round.shots}`} · ${Math.round(power*100)}% · ${round.ball.delivery.shape}${analysis?` · ${analysis.grade}`:''}`;publish();
}
function start(mode){cart.exit();review.panel.hidden=true;party.reset(mode,puttingDrill);round=party.round;cart.reset(round.position);view.reset();view.overview=false;view.cupView=false;message=readyMessage();$('phase').textContent=mode==='putting'?'FIND YOUR TOUCH.':`WELCOME TO ${HOLE.name.toUpperCase()}.`;$('commentary').textContent=mode==='putting'?`${PUTTING_DRILLS[puttingDrill].label}. Gold shows a square-face pace guide. Try Test swing before playing.`:`Par ${HOLE.par} · ${HOLE.length} m. Find the fairway, then work your way up to the green.`;publish();}
function chooseCourse(id){if(round.ball&&!round.finished||!selectCourse(id))return;view.rebuildCourse();coach.key='';rebuildMap();start('course');}
function next(){
  review.panel.hidden=true;round.unlockDirection();party.next();round=party.round;view.reset();message=readyMessage();$('phase').textContent=round.shots?`STROKE ${round.shots+1} / ${round.lie.toUpperCase()}`:round.mode==='putting'?'ANOTHER PUTT. SAME QUIET HANDS.':'BACK ON THE FIRST TEE.';
  $('commentary').textContent=message;publish();
}
function finish(){
  round.finish();history.finish(round);review.finish(round.ball,{...round.result,total:round.lastDistance});if(round.ball.testSwing&&round.ball.analysis)review.panel.hidden=false;
  if(round.ball.testSwing){
    const result=round.result;$('phase').textContent=result.holed?'TEST PUTT · IN THE CUP.':'TEST SWING COMPLETE.';
    message=`${formatDistance(round.lastDistance)} m total · ${result.holed?'holed':formatDistance(result.toPin)+' m from cup'}. Ball and score saved. Hold Test swing to repeat, or Swing / Putt to play for score.`;
  }else if(round.holed){
    const relative=round.shots-HOLE.par,names={'-3':'ALBATROSS!','-2':'EAGLE!','-1':'BIRDIE!','0':'THAT’S A PAR.','1':'BOGEY.','2':'DOUBLE BOGEY.'};
    $('phase').textContent=round.mode==='putting'?'IN THE CUP. LOVELY TOUCH.':names[relative]||'HOLE COMPLETE.';
    message=`Holed in ${round.shots} ${round.shots===1?'stroke':'strokes'}${round.mode==='course'?` · par ${HOLE.par}`:''}. Play again whenever you’re ready.`;
  }else if(round.penalty){$('phase').textContent='OUT OF BOUNDS.';message='One penalty stroke. Your next shot returns to the previous lie.';}
  else{$('phase').textContent=round.lie==='green'?'WELCOME TO THE DANCE FLOOR.':round.lie==='bunker'?'A LITTLE BEACH TIME.':'PLAY IT WHERE IT LIES.';
    message=`${formatDistance(round.lastDistance)} m total · ${round.lie} · ${formatDistance(round.toPin)} m to the pin. Tap Next shot to continue.`;}
  $('commentary').textContent=message;publish();
}
function renderPlayers(){
  const roster=$('player-roster');
  const signature=JSON.stringify([party.activeId,!!round.ball&&!round.finished,[...party.players.values()].map(p=>[p.id,p.name,p.online,p.round.shots,p.round.toPin,p.round.holed])]);
  $('turn-name').textContent=party.players.get(party.activeId)?.name||'SOLO PRACTICE';
  if(roster.dataset.signature!==signature){
  roster.dataset.signature=signature;roster.replaceChildren();
  for(const p of party.players.values()){
    const row=document.createElement('div');row.className='player-row';
    const button=document.createElement('button');button.className='player-choice'+(p.id===party.activeId?' selected':'');
    const name=document.createElement('b');name.textContent=p.name;
    const detail=document.createElement('span');detail.textContent=`${p.round.shots} ${p.round.shots===1?'stroke':'strokes'} · ${p.round.holed?'HOLED':formatDistance(p.round.toPin)+' m'} · ${p.online?(p.id===party.activeId?'YOUR TURN':'READY'):'OFFLINE'}`;
    button.append(name,detail);button.disabled=!!round.ball&&!round.finished;button.onclick=()=>selectPlayer(p.id);
    const remove=document.createElement('button');remove.className='quiet remove-player';remove.textContent='×';remove.title=`Remove ${p.name}`;remove.setAttribute('aria-label',`Remove ${p.name}`);remove.disabled=button.disabled;remove.onclick=()=>link.send({type:'player.remove',playerId:p.id});
    row.append(button,remove);roster.append(row);
  }
  if(!party.players.size){const hint=document.createElement('p');hint.className='fine';hint.textContent='Add phones to play together. Each player has a ball and score.';roster.append(hint);}
  }
  if(party.players.size>1&&round.finished&&!round.ball?.testSwing)$('next').textContent=[...party.players.values()].every(p=>p.round.holed)?'ALL PLAYERS FINISHED ✓':'NEXT PLAYER / SHOT ↗';
  if(party.players.size>1&&[...party.players.values()].every(p=>p.round.holed))$('next').hidden=true;
}
function selectPlayer(id){
  cart.exit();
  if(!party.select(id))return;
  round=party.round;cart.reset(round.position);review.panel.hidden=true;view.reset();view.setMotion({pitch:0,roll:0,yaw:0,face:0,armed:false});$('power-fill').style.width='0%';alignment.clearRest();message=`${party.players.get(id).name}’s turn. ${readyMessage()}`;$('commentary').textContent=message;publish();
}
function enterCart(){
  if(round.ball&&!round.finished)return;
  if(canRetry())next();
  round.unlockDirection();review.panel.hidden=true;$('practice').hidden=true;$('pairing').hidden=true;cart.enter(round.position);view.overview=view.cupView=view.shotView=false;message='Drive to your ball. Centre the phone like a wheel, then hold Drive.';publish();
}
function exitCart(){
  cart.exit();cartKeys.clear();if(round.finished&&!round.holed)next();else{message=readyMessage();publish();}
}
const cartKeys=new Set(),cartKeysInput=()=>cart.setInput({steering:(cartKeys.has('right')?1:0)-(cartKeys.has('left')?1:0),throttle:(cartKeys.has('forward')?1:0)-(cartKeys.has('reverse')?1:0),brake:cartKeys.has('brake'),drift:cartKeys.has('drift'),boost:cartKeys.has('boost')},performance.now()/1000);
const keyControls={KeyW:'forward',ArrowUp:'forward',KeyS:'reverse',ArrowDown:'reverse',KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right',KeyB:'brake',Space:'drift',ShiftLeft:'boost',ShiftRight:'boost'};
window.addEventListener('keydown',e=>{if(!cart.active||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||!keyControls[e.code])return;e.preventDefault();cartKeys.add(keyControls[e.code]);cartKeysInput();});
window.addEventListener('keyup',e=>{if(!keyControls[e.code])return;cartKeys.delete(keyControls[e.code]);if(cart.active)cartKeysInput();});
window.addEventListener('blur',()=>{cartKeys.clear();cart.stop();});
for(const action of ['left','right','forward','reverse','brake','drift','boost']){const b=$('cart-'+action);b.onpointerdown=e=>{if(!cart.active)return;e.preventDefault();b.setPointerCapture(e.pointerId);cartKeys.add(action);cartKeysInput();};const release=()=>{cartKeys.delete(action);if(cart.active)cartKeysInput();};b.onpointerup=b.onpointercancel=b.onlostpointercapture=release;}
$('cart-toggle').onclick=()=>cart.active?exitCart():enterCart();$('cart-exit').onclick=exitCart;
$('swing-ready').onclick=()=>{if(canRetry())next();else review.panel.hidden=true;};
$('test-swing').onclick=()=>{$('practice').hidden=false;$('commentary').textContent='On your phone, hold the second button: Test swing. With a mouse, choose Test shot below. Your ball, score and turn stay saved.';};
$('course-select').onchange=()=>chooseCourse($('course-select').value);
$('putting-drill').onchange=()=>{puttingDrill=$('putting-drill').value;start('putting');};
$('putt-guide-toggle').onclick=()=>{coach.visible=!coach.visible;coach.update(round);};
$('putt-guide-copy').onclick=()=>{if((round.ball&&!canRetry())||!coach.guide?.available)return;if(canRetry()){round.next();view.reset();}round.unlockDirection();round.setAim(coach.guide.aim);$('practice-power').value=(coach.guide.power*100).toFixed(1);round.previewPower=coach.guide.power;$('practice-power-label').textContent=`${Math.round(coach.guide.power*100)}%`;$('practice-shape').value='straight';$('practice').hidden=false;publish();};
$('players-toggle').onclick=()=>{$('players-panel').hidden=!$('players-panel').hidden;};
$('add-player').onclick=()=>{$('pairing').hidden=false;pairing();};
const map=$('yardage-map'),mapContext=map.getContext('2d'),mapBase=document.createElement('canvas');mapBase.width=180;mapBase.height=270;
const mapPixels=mapBase.getContext('2d').createImageData(180,270),mapColors={tee:[179,202,126],green:[184,208,125],fringe:[126,167,96],fairway:[128,168,94],rough:[49,80,57],bunker:[227,204,155]};
function mapScale(){return (HOLE.length+60)/270;}
function rebuildMap(){
 for(let y=0;y<270;y++)for(let x=0;x<180;x++){const wx=(x-90)*1.05,wz=y*mapScale()-HOLE.length-30,c=mapColors[surfaceAt(wx,wz)],i=(y*180+x)*4;mapPixels.data.set([...c,255],i);}
 mapBase.getContext('2d').putImageData(mapPixels,0,0);
}
rebuildMap();
function drawMap(){
  const g=mapContext,toMap=p=>({x:p.x/1.05+90,y:(p.z+HOLE.length+30)/mapScale()});g.drawImage(mapBase,0,0);
  const pin=toMap(HOLE.cup),p=toMap(round.ball||round.position);g.strokeStyle='#ecd88d';g.lineWidth=1;g.setLineDash([3,4]);g.beginPath();g.moveTo(p.x,p.y);g.lineTo(pin.x,pin.y);g.stroke();g.setLineDash([]);
  g.fillStyle='#ffb384';g.beginPath();g.moveTo(pin.x,pin.y-12);g.lineTo(pin.x+9,pin.y-8);g.lineTo(pin.x,pin.y-5);g.fill();g.strokeStyle='#fff2d1';g.beginPath();g.moveTo(pin.x,pin.y-12);g.lineTo(pin.x,pin.y+1);g.stroke();
  g.fillStyle='#fff9dc';g.shadowColor='#fff7bd';g.shadowBlur=8;g.beginPath();g.arc(p.x,p.y,3,0,Math.PI*2);g.fill();g.shadowBlur=0;
  if(cart.active){const c=toMap(cart);g.save();g.translate(c.x,c.y);g.rotate(cart.heading);g.fillStyle='#ffb083';g.beginPath();g.moveTo(0,-7);g.lineTo(5,5);g.lineTo(0,2);g.lineTo(-5,5);g.closePath();g.fill();g.restore();}
}
$('new-pair').onclick=()=>link.send({type:'pair.reset'});
$('pair-toggle').onclick=()=>{$('pairing').hidden=!$('pairing').hidden;pairing();};
$('next').onclick=next;
$('practice-toggle').onclick=()=>{$('practice').hidden=!$('practice').hidden;};
$('practice-shot').onclick=()=>{const power=Number($('practice-power').value)/100;shoot(power,0,demoSwing(power,round.club,$('practice-shape').value));};
$('practice-test').onclick=()=>{const power=Number($('practice-power').value)/100;shoot(power,0,demoSwing(power,round.club,$('practice-shape').value),{source:'demo',testSwing:true});};
$('practice-power').oninput=()=>{$('practice-power-label').textContent=`${$('practice-power').value}%`;round.previewPower=Number($('practice-power').value)/100;};
$('practice-aim').oninput=()=>{if(round.setAim(Number($('practice-aim').value)))publish();};
$('practice-club').onchange=()=>chooseClub($('practice-club').value);
$('restart-hole').onclick=()=>start(round.mode);
$('overview').onclick=()=>{view.overview=!view.overview;view.cupView=false;view.shotView=false;render();};
$('putt-cup-view').onclick=$('cup-view').onclick=()=>{view.cupView=!view.cupView;view.overview=false;view.shotView=false;render();};
$('shot-view').onclick=()=>{view.shotView=!view.shotView;view.overview=false;view.cupView=false;render();};
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>start(b.dataset.mode));
let mapAt=0,cartStateAt=0;
function frame(now){
  const dt=Math.min(.1,(now-last)/1000);last=now;accumulator+=dt;
  while(accumulator>=1/120){if(round.ball&&!round.ball.stopped)stepBall(round.ball,1/120);accumulator-=1/120;}
  if(round.ball&&!round.finished)history.sample(round.ball);
  if(round.ball?.stopped&&!round.finished)finish();
  if(motionAt&&now-motionAt>700){if(!round.ball||canRetry())round.unlockDirection();$('power-fill').style.width='0%';view.setMotion({pitch:0,roll:0,yaw:0,armed:false});motionAt=0;}
  const replayPose=lab.tick(dt);if(replayPose)view.setMotion(replayPose);
  if(cart.active){
    if(cartKeys.size)cartKeysInput();cart.update(dt,now/1000);
    $('cart-speed').textContent=Math.round(cart.groundSpeed*3.6)+' km/h';$('cart-distance').textContent=Math.round(cart.distance)+' m to ball';
    $('cart-handling').textContent=cart.spinning?'SPINOUT!':cart.boosting?'BOOSTING ↗':cart.drifting?`DRIFT · ${Math.round(Math.abs(cart.slip)*180/Math.PI)}°`:cart.grade>.3&&cart.groundSpeed>1?'HILL CLIMB ↗':'GRIP & RIP';
    $('cart-handling').dataset.mode=cart.spinning?'spin':cart.boosting?'boost':cart.drifting?'drift':'grip';
    $('cart-boost-fill').style.width=cart.boostCharge*100+'%';$('cart-boost-label').textContent=`BOOST · ${Math.round(cart.boostCharge*100)}%`;
    $('cart-help').textContent=cart.arrived?'At your ball. Hop out, or release Drive to keep exploring.':cart.blocked?(cart.blockedReason==='edge'?'Edge of the driving area. Turn back toward the course.':'Tree or rock ahead. Reverse and steer around it.'):cart.spinning?'Too much sideways! Ease off, then point the nose down the fairway.':cart.drifting?'Steer into the slide to catch it. Release Drift to grip up.':cart.grade>.3?'Keep Drive held. Boost gives extra climbing power.':'Hold Drive. Turn + Drift to slide. Boost on the straights.';
    $('cart-exit').textContent=cart.arrived?'HOP OUT & PLAY ↗':'BACK TO GOLF ↗';
    if(now-cartStateAt>250){link.send({type:'state',state:state()});cartStateAt=now;}
  }
  review.tick(dt);view.frame(dt,round,cart);if((round.ball||cart.active)&&now-mapAt>100){drawMap();if(round.club==='putter'&&round.ball)coach.draw(round,round.ball.start);mapAt=now;}
  requestAnimationFrame(frame);
}
link.connect(credentials);render();requestAnimationFrame(frame);

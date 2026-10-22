import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createPhoneServer } from '../server/phone.js';
import { SwingGesture, angleDelta } from '../src/phone/motion.js';
import { launch, stepBall, scoreShot } from '../src/golf/model.js';
import { SwingRecording } from '../src/phone/recording.js';
import { demoSwing } from '../src/phone/swing-analysis.js';
import { IDENTITY } from '../src/phone/screen-pose.js';

assert.equal(angleDelta(1,359),2,'orientation wraps through north');
assert.equal(angleDelta(-179,179),2,'orientation wraps through negative angles');
function gesture(axis=0,sign=1){
  const g=new SwingGesture();g.begin(0);
  for(let time=10;time<=200;time+=10){const r=[0,0,0];r[axis]=sign*130;g.sample(r,time,0);}
  for(let time=210;time<=450;time+=10){const r=[0,0,0];r[axis]=-sign*350;g.sample(r,time,12);}
  return g;
}
for(const axis of[0,1,2])for(const sign of[-1,1]){
  const g=gesture(axis,sign);let shot=null;
  for(let time=460;time<=520;time+=10)shot=g.sample([0,0,0],time,12)||shot;
  assert.ok(shot?.power>.4&&shot.power<.6,'any grip axis supports an automatic swing');assert.ok(shot.curve>0);assert.equal(g.release(),null,'release does not fire a second shot');
}
const idle=new SwingGesture();idle.begin(0);for(let t=10;t<=400;t+=10)idle.sample([2,1,3],t);assert.equal(idle.release(450),null,'small handling movements do not hit');
const backOnly=new SwingGesture();backOnly.begin(0);for(let t=10;t<=300;t+=10)backOnly.sample([200,0,0],t);assert.equal(backOnly.release(350),null,'backswing alone does not hit');
const cancelled=gesture();cancelled.cancel();assert.equal(cancelled.sample([0,0,0],500),undefined,'background and disconnect cancellation cannot hit');
const released=gesture();assert.equal(released.release(),null,'lifting before the automatic hit cancels');assert.equal(released.sample([0,0,0],500),undefined);
const gap=gesture();gap.sample([300,0,0],1000);assert.equal(gap.active,false,'sensor interruptions cancel');
console.log('✓ motion: all grip axes, angle wrapping, gentle handling, single delivery, stale/cancelled swings');

function flight(power,curve=0){const ball=launch({power,curve,aim:0,club:'driver'});for(let i=0;i<3000&&!ball.stopped;i++)stepBall(ball,1/120);assert.ok(ball.stopped);return ball;}
const weak=flight(.2),strong=flight(1);assert.ok(-strong.z>-weak.z+50);assert.ok(strong.y>=.15);assert.ok(strong.carry>0);
assert.ok(flight(.6,-1).x<0);assert.ok(flight(.6,1).x>0);
assert.equal(scoreShot({x:0,z:-110,carry:100},110).points,100);assert.equal(scoreShot({x:9,z:-110,carry:100},110).points,50);assert.equal(scoreShot({x:18,z:-110,carry:100},110).points,25);assert.equal(scoreShot({x:40,z:-110,carry:100},110).points,0);
console.log(`✓ golf: power, curvature, landing, stop, ring scoring (full driver ${Math.round(-strong.z)} m)`);

const recordingDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'felt-swing-test-'));
const server=createPhoneServer({port:0,recordingDirectory});const address=await server.listen();const root=`http://127.0.0.1:${address.port}`,endpoint=`ws://127.0.0.1:${address.port}/phone-ws`;
const clients=[];
async function client(){
  const ws=new WebSocket(endpoint),messages=[],waiters=new Set();clients.push(ws);
  ws.on('message',data=>{const p=JSON.parse(data);messages.push(p);for(const w of waiters)if(w.test(p)){clearTimeout(w.timeout);waiters.delete(w);w.resolve(p);}});
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  return {ws,messages,send:p=>ws.send(JSON.stringify(p)),wait(test){return new Promise((resolve,reject)=>{const w={test,resolve,timeout:setTimeout(()=>{waiters.delete(w);reject(Error(`Timed out: ${test}`));},2000)};waiters.add(w);});},async act(p,test){const waiting=this.wait(test);this.send(p);return waiting;}};
}
const type=t=>p=>p.type===t;
try{
  for(const pathname of['/server/data/ledger.json','/pub.html','/src/phone/controller.js','/assets/../server/data/ledger.json'])assert.equal((await fetch(root+pathname)).status,404,'only the golf bundle is served');
  server.setPublicUrl('https://example.com');assert.equal((await(await fetch(root+'/phone-config')).json()).publicUrl,'https://example.com');
  const host=await client();const h=await host.act({type:'host'},type('welcome'));assert.equal(h.role,'host');assert.equal(h.pairKey.length,48);
  const attacker=await client();await attacker.act({type:'join',room:h.room,key:'wrong'},type('error'));
  const phone=await client();const c=await phone.act({type:'join',room:h.room,key:h.pairKey},type('welcome'));
  assert.equal(c.role,'controller');assert.notEqual(c.token,h.token);assert.equal(c.pairKey,undefined);assert.equal(host.ws.readyState,WebSocket.OPEN,'phone must not kick out the display');
  const hostTarget=host.wait(type('camera.target'));
  const target=await phone.act({type:'camera.request'},type('camera.target'));assert.equal((await hostTarget).requestId,target.requestId);
  const calibration={version:1,source:'screen-marker',reference:'viewport-center',markerId:target.markerId,capturedAt:new Date().toISOString(),position:[.3,.1,3],markerWidthCm:15,fieldOfView:60,focalPixels:554,frame:[640,480],reprojectionError:.3,screenAngle:0,stableFrames:14,cameraDevice:IDENTITY,screenFromSensor:IDENTITY,gripScreen:IDENTITY,sensorAtLock:[0,0,0]};
  const lock={type:'camera.lock',requestId:target.requestId,calibration};
  await phone.act(lock,type('error'));
  const visible=phone.wait(type('camera.visible'));host.send({type:'camera.visible',requestId:target.requestId});await visible;
  await phone.act({...lock,calibration:{...calibration,markerId:(target.markerId+1)%250}},type('error'));
  await phone.act({...lock,calibration:{...calibration,position:[0,0,-1]}},type('error'));
  await phone.act({...lock,calibration:{...calibration,stableFrames:1}},type('error'));
  lock.calibration={...calibration,stableFrames:1,lockMethod:'manual'};
  const locked=host.wait(type('camera.locked'));assert.deepEqual((await phone.act(lock,type('camera.locked'))).calibration,lock.calibration);await locked;
  await phone.act(lock,type('error'));
  const phoneCountdown=phone.wait(type('grip.countdown'));const countdown=await host.act({type:'grip.request'},type('grip.countdown'));
  assert.equal((await phoneCountdown).requestId,countdown.requestId);assert.equal(countdown.alignmentId,target.requestId);
  assert.equal((await host.act({type:'grip.request'},type('grip.countdown'))).requestId,countdown.requestId,'double clicks share the countdown');
  await host.act({type:'grip.result',requestId:countdown.requestId,ok:true,gripScreen:IDENTITY},type('error'));
  await phone.act({type:'grip.result',requestId:'stale',ok:true,gripScreen:IDENTITY},type('error'));
  await phone.act({type:'grip.result',requestId:countdown.requestId,ok:true,gripScreen:[0]},type('error'));
  const restSaved=host.wait(type('grip.result'));await phone.act({type:'grip.result',requestId:countdown.requestId,ok:true,gripScreen:IDENTITY},type('grip.result'));assert.equal((await restSaved).ok,true);
  const phoneReset=await phone.act({type:'grip.request'},type('grip.countdown'));const cancelRest=phone.wait(type('grip.result'));host.send({type:'grip.cancel'});assert.equal((await cancelRest).ok,false);
  await phone.act({type:'grip.result',requestId:phoneReset.requestId,ok:true,gripScreen:IDENTITY},type('error'));
  await phone.act({type:'grip.cancel',invalidate:true},type('grip.unavailable'));
  await host.act({type:'grip.request'},type('error'));
  await host.act({type:'camera.request'},type('error'));
  await phone.act({type:'camera.visible',requestId:target.requestId},type('error'));
  const cancelled=host.wait(type('camera.cancelled'));phone.send({type:'camera.cancel'});await cancelled;
  const recorder=new SwingRecording(0,{label:'Synthetic test swing',calibration});recorder.sample({rotationRate:{alpha:0,beta:200,gamma:0}},null,10);const take=recorder.finish(20);
  const takesUrl=`${root}/phone-takes?room=${h.room}`;
  assert.equal((await fetch(takesUrl)).status,401);
  const headers={'Content-Type':'application/json',Authorization:`Bearer ${c.token}`};
  const saved=host.wait(type('lab.saved'));
  const upload=await fetch(takesUrl,{method:'POST',headers,body:JSON.stringify(take)});assert.equal(upload.status,200);const record=await saved;
  assert.equal(fs.existsSync(path.join(recordingDirectory,record.filename)),true,'recording reaches disk');
  const savedBundle=await(await fetch(takesUrl,{headers:{Authorization:`Bearer ${h.token}`}})).json();assert.equal(savedBundle.takes[0].samples[0].rate[1],200);
  assert.deepEqual(savedBundle.takes[0].calibration,calibration,'camera reference reaches disk and the review bundle');
  take.notes='I meant a gentle swing';assert.equal((await fetch(takesUrl,{method:'POST',headers,body:JSON.stringify(take)})).status,200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(recordingDirectory,record.filename))).takes[0].notes,take.notes);
  assert.equal(fs.readdirSync(recordingDirectory).length,1,'updating notes does not duplicate a take');
  assert.equal((await fetch(takesUrl,{method:'POST',headers,body:JSON.stringify({...take,id:'../escape'})})).status,400);
  assert.equal((await fetch(takesUrl,{method:'POST',headers:{...headers,Origin:'not a URL'},body:JSON.stringify(take)})).status,403);
  const labStatus=host.wait(type('lab.status'));phone.send({type:'lab.status',status:'recording',elapsed:1000,label:'Test'});assert.equal((await labStatus).elapsed,1000);
  await attacker.act({type:'join',room:h.room,key:h.pairKey},type('error'));
  const motion=host.wait(type('motion'));phone.send({type:'motion',pitch:10,roll:3,yaw:0,face:18,power:.4,armed:true});const preview=await motion;assert.equal(preview.pitch,10);assert.equal(preview.face,18,'live clubface reaches the desktop');
  await phone.act({type:'motion',pitch:10,roll:3,yaw:0,face:90,power:.4},type('error'));
  await phone.act({type:'motion',pitch:'10',roll:3,yaw:0,power:.4},type('error'));
  await phone.act({type:'state',state:{}},type('error'));
  await phone.act({type:'pair.reset'},type('error'));
  const shot=host.wait(type('shot'));phone.send({type:'shot',id:'one',power:.6,curve:-.3});assert.equal((await shot).power,.6);
  phone.send({type:'shot',id:'one',power:.6,curve:-.3});
  await phone.act({type:'ping',sent:1},type('pong'));
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(host.messages.filter(type('shot')).length,1,'duplicate shot id is suppressed');
  for(const value of[-3,2,null,'0.5'])await phone.act({type:'shot',id:'bad',power:value,curve:0},type('error'));
  for (const value of ['wood','sand','putter']) {
    const action=host.wait(type('action'));phone.send({type:'action',action:'club',value});assert.equal((await action).value,value);
  }
  await phone.act({type:'action',action:'club',value:'constructor'},type('error'));
  const mode=host.wait(type('action'));phone.send({type:'action',action:'mode',value:'putting'});assert.equal((await mode).value,'putting');
  await phone.act({type:'action',action:'mode',value:'unknown'},type('error'));
  for(const [action,value] of [['test',true],['test',false],['drill','reverse'],['course','saltwind'],['course','pine'],['cart','enter'],['cart','exit']]){
    const relayed=host.wait(type('action'));phone.send({type:'action',action,value});assert.equal((await relayed).value,value);
  }
  await phone.act({type:'action',action:'test',value:'true'},type('error'));
  await phone.act({type:'action',action:'drill',value:'constructor'},type('error'));

  await phone.act({type:'action',action:'course',value:'constructor'},type('error'));
  await phone.act({type:'shot',id:'bad-test',power:.5,curve:0,testSwing:'true'},type('error'));
  const trial=host.wait(type('shot'));phone.send({type:'shot',id:'test-button',power:.4,curve:0,testSwing:true});assert.equal((await trial).testSwing,true);
  const courseState={club:'putter',aim:0,target:110,shots:3,score:0,busy:false,finished:false,lastDistance:55,message:'On the green',mode:'course',toPin:8.4,lie:'green',holed:false};
  const courseMessage=phone.wait(type('state'));host.send({type:'state',state:courseState});assert.deepEqual((await courseMessage).state,{...courseState,courseId:'bramble',testSwing:false,drill:'standard',puttRead:'',activePlayerId:c.playerId,yourTurn:true});
  await host.act({type:'state',state:{...courseState,toPin:-1}},type('error'));
  const testState=phone.wait(type('state'));host.send({type:'state',state:{...courseState,testSwing:true,drill:'reverse',puttRead:'57% pace'}});
  const receivedTest=(await testState).state;assert.equal(receivedTest.testSwing,true);assert.equal(receivedTest.drill,'reverse');assert.equal(receivedTest.puttRead,'57% pace');

  const state={club:'iron',aim:4,target:110,shots:1,score:50,busy:false,finished:false,lastDistance:104,message:'Next ball'};
  const cartMessage=phone.wait(type('state'));host.send({type:'state',state:{...courseState,cartMode:true,cartDistance:100,cartSpeed:12,cartArrived:false}});assert.equal((await cartMessage).state.cartMode,true);
  const drive=host.wait(type('drive'));phone.send({type:'drive',steering:.4,throttle:1,brake:false});assert.equal((await drive).steering,.4);
  const arcade=host.wait(type('drive'));phone.send({type:'drive',steering:-.7,throttle:1,brake:false,drift:true,boost:false});assert.equal((await arcade).drift,true);
  const boost=host.wait(type('drive'));phone.send({type:'drive',steering:0,throttle:1,brake:false,drift:false,boost:true});assert.equal((await boost).boost,true);
  await phone.act({type:'drive',steering:0,throttle:1,brake:false,drift:'yes'},type('error'));
  await phone.act({type:'drive',steering:0,throttle:1,brake:false,boost:10},type('error'));
  const arcadeState=phone.wait(type('state'));host.send({type:'state',state:{...courseState,cartMode:true,cartDistance:100,cartSpeed:84,cartBoost:.4,cartBoosting:true,cartDrifting:false,cartSpinning:false}});assert.equal((await arcadeState).state.cartBoost,.4);
  await phone.act({type:'drive',steering:2,throttle:1,brake:false},type('error'));
  await phone.act({type:'shot',id:'driving-shot',power:.5,curve:0},type('error'));
  const stateMessage=phone.wait(type('state'));host.send({type:'state',state});assert.deepEqual((await stateMessage).state,{...state,courseId:'bramble',testSwing:false,drill:'standard',puttRead:'',activePlayerId:c.playerId,yourTurn:true});
  await host.act({type:'shot',id:'forbidden',power:.5,curve:0},type('error'));
  const analysis=demoSwing(.7,'iron','slice'),analysed=host.wait(type('shot'));phone.send({type:'shot',id:'analysis',power:.7,curve:0,analysis});assert.deepEqual((await analysed).analysis,analysis);
  await phone.act({type:'shot',id:'bad-analysis',power:.7,curve:0,analysis:{...analysis,path:NaN}},type('error'));
  const fresh=host.messages.filter(type('pair.key')).at(-1).key;
  const second=await client(),c2=await second.act({type:'join',room:h.room,key:fresh,name:'Guest'},type('welcome'));
  assert.notEqual(c2.playerId,c.playerId);assert.equal(c2.state.yourTurn,false);assert.equal(phone.ws.readyState,WebSocket.OPEN,'joining does not replace an existing phone');
  const renamed=await second.act({type:'player.name',name:'  Alex  '},p=>p.type==='presence'&&p.players.some(player=>player.id===c2.playerId&&player.name==='Alex'));assert.equal(renamed.players.find(p=>p.id===c2.playerId).name,'Alex');
  await second.act({type:'drive',steering:0,throttle:1,brake:false},type('error'));
  await second.act({type:'shot',id:'out-of-turn',power:.5,curve:0},type('error'));
  await second.act({type:'action',action:'test',value:true},type('error'));
  await second.act({type:'action',action:'drill',value:'tap'},type('error'));
  const beforeMotion=host.messages.filter(type('motion')).length;second.send({type:'motion',pitch:0,roll:0,yaw:30,power:0});await second.act({type:'ping'},type('pong'));assert.equal(host.messages.filter(type('motion')).length,beforeMotion,'inactive phone cannot steer');
  // Calibration remains available off-turn and is routed to the named phone.
  const target2=await second.act({type:'camera.request'},type('camera.target'));assert.equal(target2.playerId,c2.playerId);
  await phone.act({type:'camera.request'},type('error'));
  const visible2=second.wait(type('camera.visible'));host.send({type:'camera.visible',playerId:c2.playerId,requestId:target2.requestId});await visible2;
  await second.act({type:'camera.lock',requestId:target2.requestId,calibration:{...lock.calibration,markerId:target2.markerId}},type('camera.locked'));
  const count2=await host.act({type:'grip.request',playerId:c2.playerId},type('grip.countdown'));assert.equal(count2.playerId,c2.playerId);
  await phone.act({type:'grip.result',requestId:count2.requestId,ok:true,gripScreen:IDENTITY},type('error'));
  await second.act({type:'grip.result',requestId:count2.requestId,ok:true,gripScreen:IDENTITY},type('grip.result'));
  const turn=second.wait(type('state')),waiting=phone.wait(type('state'));host.send({type:'state',state:{...state,courseId:'bramble',testSwing:false,drill:'standard',puttRead:'',activePlayerId:c2.playerId,standings:[{id:c.playerId,shots:4,toPin:17,lie:'green',holed:false},{id:c2.playerId,shots:1,toPin:190,lie:'fairway',holed:false}]}});assert.equal((await turn).state.yourTurn,true);const ownScore=(await waiting).state;assert.equal(ownScore.yourTurn,false);assert.equal(ownScore.shots,4);assert.equal(ownScore.toPin,17,'waiting phone keeps its own ball readout');
  await phone.act({type:'action',action:'club',value:'driver'},type('error'));
  const secondShot=host.wait(type('shot'));second.send({type:'shot',id:'one',power:.5,curve:0});assert.equal((await secondShot).playerId,c2.playerId,'shot deduplication is per player');
  const secondLost=host.wait(p=>p.type==='presence'&&p.players.some(p=>p.id===c2.playerId&&!p.online));second.ws.close();await secondLost;
  const rejoined=await client(),c2r=await rejoined.act({type:'join',room:h.room,token:c2.token},type('welcome'));assert.equal(c2r.playerId,c2.playerId);assert.equal(c2r.name,'Alex');
  const removed=await host.act({type:'player.remove',playerId:c2.playerId},p=>p.type==='presence'&&p.players.length===1);assert.equal(removed.players.length,1);
  await attacker.act({type:'join',room:h.room,token:c2.token},type('error'));
  const restored=phone.wait(type('state'));host.send({type:'state',state:{...state,courseId:'bramble',testSwing:false,drill:'standard',puttRead:'',activePlayerId:c.playerId}});await restored;
  const presence=host.wait(p=>p.type==='presence'&&!p.controller);phone.ws.close();await presence;
  const resumed=await client();const r=await resumed.act({type:'join',room:h.room,token:c.token},type('welcome'));assert.deepEqual(r.state,{...state,courseId:'bramble',testSwing:false,drill:'standard',puttRead:'',activePlayerId:c.playerId,yourTurn:true});
  const hostLost=resumed.wait(p=>p.type==='presence'&&!p.host);host.ws.close();await hostLost;
  await resumed.act({type:'shot',id:'offline',power:.5,curve:0},type('error'));
  const host2=await client();await host2.act({type:'host',room:h.room,token:h.token},type('welcome'));
  const newKey=await host2.act({type:'pair.reset'},type('pair.key'));assert.notEqual(newKey.key,h.pairKey);
  assert.equal(resumed.ws.readyState,WebSocket.OPEN,'refreshing the join QR preserves current players');
  await host2.act({type:'player.remove',playerId:c.playerId},p=>p.type==='presence'&&p.players.length===0);
  await attacker.act({type:'join',room:h.room,token:c.token},type('error'));
  assert.equal((await fetch(takesUrl,{headers:{Authorization:`Bearer ${c.token}`}})).status,401,'revoked phone cannot read recordings');
  const phone2=await client();const lastPhone=await phone2.act({type:'join',room:h.room,key:newKey.key},type('welcome'));
  // Capacity and distinct private credentials hold for a full eight-player lobby.
  const tokens=new Set([lastPhone.token]);
  for(let count=2;count<=8;count++){
    const invite=await host2.act({type:'pair.reset'},type('pair.key')),extra=await client();
    const joined=host2.wait(p=>p.type==='presence'&&p.players.length===count);
    const nextPhone=await extra.act({type:'join',room:h.room,key:invite.key},type('welcome'));tokens.add(nextPhone.token);await joined;
  }
  assert.equal(tokens.size,8);
  const fullInvite=await host2.act({type:'pair.reset'},type('pair.key'));assert.match((await attacker.act({type:'join',room:h.room,key:fullInvite.key},type('error'))).message,/Eight players/);

  await assert.rejects(new Promise((resolve,reject)=>{const bad=new WebSocket(endpoint,{origin:'https://wrong.example'});bad.once('open',()=>{bad.close();resolve();});bad.once('error',reject);}));
  console.log('✓ pairing: multiple named phones, turn isolation, private calibration, resume, removal, separate roles, one-use QR, private tokens, validation, duplicate suppression, reconnect, revocation, origin checks');
}finally{for(const ws of clients)ws.terminate();await server.close();fs.rmSync(recordingDirectory,{recursive:true,force:true});}

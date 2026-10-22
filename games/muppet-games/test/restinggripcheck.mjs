import assert from 'node:assert/strict';
import { RestingGrip } from '../src/phone/resting-grip.js';
import { screenOrientation, screenRelativePose, rotation } from '../src/phone/screen-pose.js';

let now=0,ready=true,orientation={alpha:0,beta:80,gamma:0},captures=0;
const sent=[],statuses=[],screenReference=rotation('z',25),position=[.1,.2,3];
let calibration={screenFromSensor:screenReference,gripScreen:rotation('x',80),position};
const rest=new RestingGrip({link:{send:p=>sent.push(p)},ready:()=>ready,now:()=>now,onStatus:(message,pending)=>statuses.push({message,pending}),capture:()=>{
  captures++;calibration={...calibration,gripScreen:screenOrientation(orientation,calibration)};return calibration.gripScreen;
}});
rest.request();assert.equal(sent.length,0,'rest capture requires screen alignment');
rest.align('screen-1');rest.request();assert.equal(sent.at(-1).type,'grip.request');
rest.receive({type:'grip.countdown',requestId:'capture-1',alignmentId:'screen-1'});
assert.equal(captures,0);assert.match(statuses.at(-1).message,/2/);
now=1500;orientation={alpha:12,beta:-35,gamma:8};rest.tick();assert.equal(captures,0,'lowering happens before the capture');
rest.receive({type:'grip.countdown',requestId:'capture-1',alignmentId:'screen-1'});assert.equal(rest.deadline,2000,'duplicate requests cannot restart the countdown');
now=2000;rest.tick();assert.equal(captures,1);assert.equal(sent.at(-1).ok,true);
assert.ok(Object.values(screenRelativePose(orientation,calibration)).every(v=>Math.abs(v)<1e-6),'the lowered phone becomes the neutral pose');
assert.equal(calibration.screenFromSensor,screenReference,'camera-to-screen reference is preserved');assert.equal(calibration.position,position);
rest.receive({type:'grip.result',requestId:'old',ok:true});assert.equal(rest.requestId,'capture-1');
rest.receive({type:'grip.result',requestId:'capture-1',ok:true});assert.equal(rest.requestId,null);
rest.receive({type:'grip.countdown',requestId:'wrong-screen',alignmentId:'screen-2'});assert.equal(sent.at(-1).ok,false);
rest.receive({type:'grip.countdown',requestId:'stale',alignmentId:'screen-1'});ready=false;now=4000;rest.tick();assert.equal(sent.at(-1).ok,false);assert.equal(captures,1,'stale sensors never set a resting pose');rest.stop();
ready=true;rest.receive({type:'grip.countdown',requestId:'cancelled',alignmentId:'screen-1'});rest.clear();now=7000;rest.tick();assert.equal(captures,1);assert.deepEqual(sent.at(-1),{type:'grip.cancel',invalidate:true});
rest.align('screen-3');rest.receive({type:'grip.countdown',requestId:'disconnect',alignmentId:'screen-3'});rest.receive({type:'disconnected'});now=10000;rest.tick();assert.equal(captures,1);assert.equal(rest.alignmentId,null);
console.log('✓ resting grip: shared two-second countdown, capture after lowering, preserved optical reference, duplicate/stale requests, stale sensors, background/disconnect cancellation');

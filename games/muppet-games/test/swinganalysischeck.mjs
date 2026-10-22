import assert from 'node:assert/strict';
import { analyseSwing, demoSwing, validateSwingAnalysis } from '../src/phone/swing-analysis.js';
import { impactDelivery } from '../src/golf/impact.js';
import { CLUBS, launch, stepBall } from '../src/golf/model.js';
const smooth=demoSwing(.8),slice=demoSwing(.8,'driver','slice'),hook=demoSwing(.8,'driver','hook'),jerky=demoSwing(.8,'driver','jerky');
for(const report of [smooth,slice,hook,jerky]){assert.ok(validateSwingAnalysis(report));assert.ok(report.trace.length<=64);assert.equal(report.impactMethod,'address-return');assert.equal(report.linearJerk,null);}
assert.ok(smooth.score>.95);assert.ok(jerky.score<smooth.score-.3);assert.ok(jerky.smoothness<smooth.smoothness-.3);assert.equal(jerky.grade,'MISHIT');
assert.equal(slice.path,-hook.path);assert.equal(slice.face,-hook.face);
const delivery=s=>impactDelivery('driver',CLUBS.driver,.8,s);
assert.equal(delivery(slice).spinAxis,-delivery(hook).spinAxis);assert.ok(delivery(slice).spinAxis>20);assert.ok(delivery(hook).spinAxis< -20);
assert.ok(delivery(jerky).speed<delivery(smooth).speed);assert.equal(delivery(smooth).startAngle,0);
const flight=s=>{const b=launch({power:.8,analysis:s});while(!b.stopped)stepBall(b,1/120);return b;};
assert.ok(flight(slice).x>20);assert.ok(flight(hook).x< -20);assert.deepEqual(flight(slice),flight(slice),'no random spread');
const putt=impactDelivery('putter',CLUBS.putter,.5,slice);assert.equal(putt.spinAxis,0);assert.equal(putt.rpm,0);assert.ok(putt.startAngle>0);
function signal(hz){
 const samples=[];for(let t=0;t<=1250;t+=1000/hz){const down=t>=750,phase=down?(t-750)/450:t/750,speed=Math.sin(Math.min(1,phase)*Math.PI)*500*(down?1:-.3),angle=down?-.15:0;
 samples.push({t,rate:[0,speed,0],omega:[Math.cos(angle)*speed,0,Math.sin(angle)*speed],shaft:[0,-1,0],face:t/1000,acceleration:[Math.sin(t/1000),0,0]});}
 return analyseSwing(samples,{motionAt:0,forwardAt:750,peakAt:1072});
}
const reports=[30,60,120].map(signal);for(const r of reports){assert.ok(validateSwingAnalysis(r));assert.ok(Math.abs(r.path+8.594)<.1);assert.ok(r.linearJerk!==null);assert.ok(Math.abs(r.face-r.impactMs/1000)<.002,'face is sampled at interpolated impact, not peak speed');}
assert.ok(Math.max(...reports.map(r=>r.impactMs))-Math.min(...reports.map(r=>r.impactMs))<40,'sampling frequency has bounded influence on return timing');
for(const bad of [{...smooth,path:Infinity},{...smooth,quality:2},{...smooth,trace:Array(65).fill(smooth.trace[0])},{...smooth,trace:[[1,0,0,0,0,0],[0,0,0,0,0,0]]}])assert.equal(validateSwingAnalysis(bad),false);
console.log('swinganalysischeck: timed impact, sample rates, jerk grading, mirrored face/path, deterministic curved flight, putts and bounded reports passed');

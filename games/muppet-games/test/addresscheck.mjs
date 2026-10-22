import assert from 'node:assert/strict';
import fs from 'node:fs';
import { aimFromYaw, captureAddress, clubfaceAt, curveFromFace, isFaceAdjustment } from '../src/phone/address.js';
import { IDENTITY, multiply, transpose, rotation, transform } from '../src/phone/screen-pose.js';
import { SwingGesture } from '../src/phone/motion.js';
import { launch } from '../src/golf/model.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} should equal ${b}`);
const orientation=m=>({alpha:Math.atan2(-m[1],m[4])*180/Math.PI,beta:Math.asin(Math.max(-1,Math.min(1,m[7])))*180/Math.PI,gamma:Math.atan2(-m[6],m[8])*180/Math.PI});
const calibration={screenFromSensor:IDENTITY,gripScreen:IDENTITY};
for(const heading of [-30,0,30]){
  const h=rotation('y',heading),address=captureAddress(orientation(h),calibration);
  near(aimFromYaw(heading),-heading*.85);
  for(const tilt of [-30,0,30])for(const pitch of [-130,-60,0,60,130]){
    const pose=multiply(multiply(h,rotation('x',pitch)),rotation('z',tilt));
    near(clubfaceAt(orientation(pose),calibration,address),-tilt);
  }
  for(const tilt of [-30,30]){
    const pose=multiply(h,rotation('z',tilt)),o=orientation(pose);
    const body=transform(transpose(pose),transform(h,[0,0,180]));
    assert.equal(isFaceAdjustment(o,calibration,address,[body[2],body[0],body[1]]),true);
  }
}
// Each press defines square, including a comfortably tilted initial grip.
const pretilted=multiply(rotation('y',25),rotation('z',20));
near(clubfaceAt(orientation(pretilted),calibration,captureAddress(orientation(pretilted),calibration)),0);
assert.equal(curveFromFace(1),0);assert.ok(curveFromFace(-20)<0);assert.ok(curveFromFace(20)>0);
assert.ok(launch({power:.5,aim:aimFromYaw(20)}).vx<0);
assert.ok(launch({power:.5,aim:aimFromYaw(-20)}).vx>0);

// Keep the real swings recognizable after ignoring face-only setup movements.
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/three-phone-swings.json',import.meta.url)));
const take={calibration:fixture.calibration,samples:fixture.samples.map(([t,rate,orientation])=>({t,rate,orientation}))};
const raw=s=>({alpha:s.orientation[0],beta:s.orientation[1],gamma:s.orientation[2]});
for(const [start,end,power]of [[0,1750,.98],[3500,5600,1],[7000,8650,.55]]){
  const first=take.samples.find(s=>s.t>=start),address=captureAddress(raw(first),take.calibration),g=new SwingGesture();g.begin(start);const shots=[];
  for(const s of take.samples)if(s.t>=start&&s.t<=end){
    const o=raw(s),face=clubfaceAt(o,take.calibration,address);
    const adjusting=g.axis===null&&isFaceAdjustment(o,take.calibration,address,s.rate);
    const shot=g.sample(adjusting?[0,0,0]:s.rate,s.t,face);if(shot)shots.push(shot);
  }
  assert.equal(shots.length,1);assert.ok(Math.abs(shots[0].power-power)<.01);
}
console.log('addresscheck: yaw aiming, independent face tilt, large backswings, square-at-press, face-only setup, and three real swings passed');

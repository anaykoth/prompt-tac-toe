import { curveFromFace } from './address.js';
import { analyseSwing } from './swing-analysis.js';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const angleDelta = (a, b) => ((a - b + 540) % 360) - 180;

/** Gyroscope gesture, sampled locally so network jitter cannot change power.
 * Requires a held grip, a deliberate backswing, then a forward return.
 * A forward speed peak followed by deceleration commits once while held.
 * Releasing only disarms; it never commits a pending shot.
 */
export class SwingGesture {
  constructor() { this.cancel(); }
  begin(time, club = 'driver') { this.cancel(); this.club = club; this.putting = club === 'putter'; this.active = true; this.start = this.last = time; }
  sample(rate, time, face = 0, kinematics = {}) {
    if (!this.active || !Array.isArray(rate) || rate.length !== 3 || !rate.every(Number.isFinite) || !Number.isFinite(time) || !Number.isFinite(face)) return;
    const dt = (time - this.last) / 1000;
    this.last = time;
    const timedOut = this.swingAt !== null && time - this.swingAt > 8000;
    if (dt <= 0 || dt > .2 || timedOut) { if (dt > .2 || timedOut) this.cancel(timedOut?'timed-out':'sensor-gap'); return; }
    this.samples.push({t:time,rate:[...rate],face,...kinematics});
    if(this.samples.length>650)this.samples.shift();
    if(this.putting){
      // Reject isolated gyro spikes before measuring a small putting stroke.
      // Raw samples remain in the swing report and shot journal.
      this.puttRates.push([...rate]);this.puttRates.shift();
      rate=[0,1,2].map(i=>this.puttRates.map(r=>r[i]).sort((a,b)=>a-b)[1]);
    }
    if (this.axis === null) {
      const minimum = this.putting ? 6 : 25;
      if (Math.max(...rate.map(Math.abs)) < minimum) return;
      // A tap or preparatory wobble can briefly lead on the wrong axis. Wait
      // for half the required backswing (6°), over at least 50 ms of motion.
      // Signed travel lets an initial twitch cancel out as the swing begins.
      this.axisTime += dt;
      rate.forEach((v, i) => { if (Math.abs(v) >= minimum) this.travel[i] += v * dt; });
      const max = Math.max(...this.travel.map(Math.abs));
      if (max < (this.putting ? 1 : 6) || this.axisTime < .05) return;
      this.axis = this.travel.findIndex(v => Math.abs(v) === max);
      this.sign = Math.sign(this.travel[this.axis]); this.back = max; this.swingAt = time; this.motionAt = time - this.axisTime * 1000;
      return; // The selection sample is already included in back.
    }
    const speed = rate[this.axis] * this.sign;
    if (this.phase === 'back') {
      this.back += Math.max(0, speed) * dt;
      if (this.back >= (this.putting ? 2 : 12) && speed < -(this.putting ? 8 : 35)) { this.phase = 'forward'; this.forwardAt=time; }
    }
    if (this.phase === 'forward') {
      this.forward += Math.max(0, -speed) * dt;
      if (-speed > this.peak) { this.peak = -speed; this.peakAt = time; this.faceAtPeak = face; this.curve = curveFromFace(face); }
      // Wait through brief sensor dips so a noisy downswing is still one shot.
      const slowing = -speed <= this.peak * .75;
      this.slowAt = slowing ? (this.slowAt ?? time) : null;
      if (this.forward >= (this.putting ? 2 : 10) && this.peak >= (this.putting ? 14 : 65) && this.slowAt !== null && time - this.slowAt >= 40 && time - this.peakAt >= 60) {
        const shot = { power: this.power, curve: this.curve };
        shot.analysis = analyseSwing(this.samples,{club:this.club,axis:this.axis,sign:this.sign,motionAt:this.motionAt,forwardAt:this.forwardAt,peakAt:this.peakAt,power:this.power});
        this.active = false; this.fired = true; this.phase = 'hit';
        return shot;
      }
    }
  }
  get power() { return this.peak > 0 ? clamp(this.putting ? (this.peak - 10) / 190 : (this.peak - 35) / 650, .02, 1) : 0; }
  release() { this.cancel(); return null; }
  cancel(reason='cancelled') { this.cancelReason=reason;this.active = false; this.fired = false; this.slowAt = this.swingAt = this.motionAt = this.forwardAt = null; this.samples=[]; this.puttRates=[[0,0,0],[0,0,0],[0,0,0]]; this.axis = null; this.travel = [0, 0, 0]; this.axisTime = 0; this.sign = 1; this.phase = 'back'; this.back = this.forward = this.peak = this.peakAt = 0; this.curve = this.faceAtPeak = 0; }
}

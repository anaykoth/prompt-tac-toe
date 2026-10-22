const vector=(v,keys)=>keys.map(k=>Number.isFinite(v?.[k])?v[k]:null);
/** Only records while the player deliberately holds Swing; no camera frames. */
export class ShotCapture {
  constructor(journal){this.journal=journal;this.current=null;}
  begin(time,context){
    this.finish('cancelled',time);
    this.current={id:crypto.randomUUID(),start:time,context:structuredClone(context),recordedAt:new Date().toISOString(),samples:[],dropped:0};
    return this.current.id;
  }
  sample(event,orientation,time){
    const a=this.current;if(!a)return;
    a.samples.push({t:time-a.start,rate:vector(event.rotationRate,['alpha','beta','gamma']),acceleration:vector(event.acceleration,['x','y','z']),orientation:vector(orientation,['alpha','beta','gamma'])});
    while(a.samples.length>900||a.samples.length>1&&a.samples.at(-1).t-a.samples[0].t>12000){a.samples.shift();a.dropped++;}
  }
  finish(endReason,time,shot=null){
    const a=this.current;if(!a)return null;this.current=null;
    const offset=a.samples[0]?.t||0,samples=a.samples.map(s=>({...s,t:Math.round((s.t-offset)*1000)/1000}));
    this.journal.enqueue({version:1,kind:'attempt',id:a.id,data:{...a.context,recordedAt:a.recordedAt,endReason,heldMs:Math.max(0,time-a.start),offsetMs:offset,dropped:a.dropped,samples,power:shot?.power??null,curve:shot?.curve??null,analysis:shot?.analysis??null}});
    return a.id;
  }
}

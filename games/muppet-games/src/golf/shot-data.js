import { COURSES } from './course.js';
import { validateSwingAnalysis } from '../phone/swing-analysis.js';
import { validateCalibration, isRotation } from '../phone/screen-pose.js';
export const SHOT_MODEL='virtual-club-2026-10-16-coach-obstacles-v4';
export const FEEDBACK=['unrated','matched','too-strong','too-weak','wrong-direction','false-hit','missed-hit'];
export const ATTEMPT_ENDS=['timed-out','recognized','released-early','cancelled','sensor-gap','orientation-stale','interrupted','tab-hidden','page-left','turn-changed'];
const n=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
const id=s=>typeof s==='string'&&/^[\w-]{1,64}$/.test(s);
const date=s=>typeof s==='string'&&s.length<=40&&Number.isFinite(Date.parse(s));
const vec=(v,limit=1e5)=>Array.isArray(v)&&v.length===3&&v.every(x=>x===null||n(x,-limit,limit));
const clubs=['driver','wood','iron','wedge','sand','putter'],lies=['tee','fairway','rough','bunker','fringe','green','holed'];
export function validateShotEvent(e){
  if(!e||e.version!==1||!id(e.id)||!['attempt','launch','result','feedback'].includes(e.kind)||!e.data||typeof e.data!=='object')return false;
  const d=e.data;
  if(d.collisions!==undefined&&(!Array.isArray(d.collisions)||d.collisions.length>24||!d.collisions.every(c=>c&&typeof c.id==='string'&&c.id.length<80&&['trunk','canopy','rock'].includes(c.type)&&n(c.time,0,45)&&n(c.speedBefore,0,200)&&n(c.speedAfter,0,200)&&['x','y','z'].every(k=>n(c[k],-2000,2000)))))return false;
  if(d.courseId!==undefined&&!Object.hasOwn(COURSES,d.courseId))return false;
  if(d.testSwing!==undefined&&typeof d.testSwing!=='boolean')return false;
  if(e.kind==='feedback')return FEEDBACK.includes(d.verdict)&&['unknown','gentle','normal','hard'].includes(d.strength)&&['unknown','straight','left','right'].includes(d.shape)&&typeof d.notes==='string'&&d.notes.length<=1000;
  if(e.kind==='result')return date(d.endedAt)&&['carry','total','toPin','flightTime','maxHeight'].every(k=>n(d[k],0,2000))&&n(d.lateral,-2000,2000)&&n(d.forward,-2000,2000)&&lies.includes(d.lie)&&typeof d.holed==='boolean'&&typeof d.penalty==='boolean'&&Array.isArray(d.trajectory)&&d.trajectory.length<=450&&d.trajectory.every((p,i)=>Array.isArray(p)&&p.length===5&&n(p[0],0,45)&&(!i||p[0]>=d.trajectory[i-1][0])&&p.slice(1,4).every(x=>n(x,-2000,2000))&&[0,1].includes(p[4]));
  if(!date(d.recordedAt)||!clubs.includes(d.club)||!['course','putting'].includes(d.mode)||!n(d.aim,-35,35))return false;
  if(d.analysis!==null&&!validateSwingAnalysis(d.analysis))return false;
  if(e.kind==='attempt'){
    if(!ATTEMPT_ENDS.includes(d.endReason)||!(d.power===null||n(d.power,.02,1))||!(d.curve===null||n(d.curve,-1,1))||!n(d.heldMs,0,3600000)||!n(d.offsetMs,0,3600000))return false;
    if(d.address!==undefined&&(!d.address||!['orientation','heading','fromScreen'].every(k=>isRotation(d.address[k]))))return false;
    if(d.calibration!==null&&!validateCalibration(d.calibration))return false;
    if(!Array.isArray(d.samples)||d.samples.length>900)return false;
    return d.samples.every((s,i)=>n(s.t,0,12000)&&(!i||s.t>=d.samples[i-1].t)&&vec(s.rate)&&vec(s.acceleration)&&vec(s.orientation))&&n(d.dropped,0,1e7);
  }
  if(!['phone','demo'].includes(d.source)||!id(d.playerId)||typeof d.playerName!=='string'||d.playerName.length>24||!n(d.power,.02,1)||!n(d.curve,-1,1)||!n(d.stroke,1,10000)||!n(d.heading,-10,10)||!n(d.toPin,0,2000)||!lies.includes(d.lie)||!n(d.position?.x,-2000,2000)||!n(d.position?.z,-2000,2000))return false;
  const delivery=d.delivery;
  return delivery&&['face','path','faceToPath','attack','quality','efficiency','startAngle','launchAngle','spinAxis','rpm','speed'].every(k=>n(delivery[k],-1e5,1e5))&&typeof delivery.shape==='string'&&delivery.shape.length<=40&&vec(d.velocity)&&n(d.rpm,0,100000);
}
export function signalMetrics(samples=[]){
  const gaps=samples.slice(1).map((s,i)=>s.t-samples[i].t).filter(x=>x>0).sort((a,b)=>a-b);
  return {samples:samples.length,hz:gaps.length?1000/gaps[Math.floor(gaps.length/2)]:0,maxGap:gaps.at(-1)||0,missingAcceleration:samples.filter(s=>!s.acceleration.every(Number.isFinite)).length,missingOrientation:samples.filter(s=>!s.orientation.every(Number.isFinite)).length};
}
export function shotFlags(record){
  const a=record.launch?.analysis||record.attempt?.analysis,m=record.signal,flags=[];
  if((record.launch?.power??record.attempt?.power)>=.999)flags.push('Power reached maximum');
  if(a?.impactMethod==='speed-peak')flags.push('Impact used speed-peak fallback');
  if(a&&Math.abs(a.attack)>=24.99)flags.push('Attack angle reached model limit');
  if(a&&Math.abs(a.path)>=34.99)flags.push('Return path reached model limit');
  if(a&&a.confidence<.65)flags.push('Low model confidence');
  if(m?.maxGap>70)flags.push(`Sensor gap: ${Math.round(m.maxGap)} ms`);
  if(m?.samples&&m.missingAcceleration===m.samples)flags.push('Linear acceleration unavailable');
  if(m?.missingOrientation)flags.push('Orientation samples missing');
  if(record.attempt?.dropped)flags.push('Early samples trimmed from long hold');
  if(record.attempt?.endReason!=='recognized'&&record.attempt)flags.push(`No shot: ${record.attempt.endReason}`);
  if(record.launch&&!record.result)flags.push('Ball result pending or interrupted');
  if(record.attempt?.endReason==='recognized'&&!record.launch)flags.push('Recognized swing has no confirmed launch');
  return flags;
}
export function summarizeShots(records,{source='phone',playerId='',club=''}={}){
  const selected=records.filter(r=>(source==='all'||r.source===source)&&(!playerId||r.playerId===playerId)&&(!club||(r.launch?.club||r.attempt?.club)===club));
  const launched=selected.filter(r=>r.launch),complete=selected.filter(r=>r.result),rated=selected.filter(r=>r.feedback&&r.feedback.verdict!=='unrated'),analysed=selected.filter(r=>r.launch?.analysis||r.attempt?.analysis);
  const count=fn=>selected.filter(fn).length,a=r=>r.launch?.analysis||r.attempt?.analysis;
  const feedback=Object.fromEntries(FEEDBACK.slice(1).map(v=>[v,rated.filter(r=>r.feedback.verdict===v).length]));
  const result={total:selected.length,launched:launched.length,complete:complete.length,unlaunched:count(r=>r.attempt&&!r.launch),analysed:analysed.length,fallback:count(r=>a(r)?.impactMethod==='speed-peak'),angleLimited:count(r=>a(r)&&(Math.abs(a(r).attack)>=24.99||Math.abs(a(r).path)>=34.99)),sensorGaps:count(r=>r.signal?.maxGap>70),rated:rated.length,feedback};
  const groups=new Map();
  for(const r of selected){const club=r.launch?.club||r.attempt?.club,key=`${r.playerId}/${club}/${r.model}`,group=groups.get(key)||{playerId:r.playerId,player:r.playerName,club,model:r.model,attempts:0,completed:0,rated:0,matched:0,strengths:{}};group.attempts++;if(r.result)group.completed++;if(r.feedback?.verdict&&r.feedback.verdict!=='unrated'){group.rated++;if(r.feedback.verdict==='matched')group.matched++;}const power=r.launch?.power??r.attempt?.power,strength=r.feedback?.strength;if(Number.isFinite(power)&&strength&&strength!=='unknown'){const bucket=group.strengths[strength]||{count:0,power:0};bucket.count++;bucket.power+=power;group.strengths[strength]=bucket;}groups.set(key,group);}
  result.groups=[...groups.values()].map(g=>({...g,strengths:Object.fromEntries(Object.entries(g.strengths).map(([key,v])=>[key,{count:v.count,meanPower:v.power/v.count}]))}));
  result.findings=[];
  if(!selected.length)result.findings.push(source==='phone'?'No phone attempts recorded yet. Simulated shots are excluded from this view.':'No attempts match this filter.');
  if(result.fallback)result.findings.push(`${result.fallback}/${result.analysed} analysed swings used the impact fallback. Validate timing before tuning flight.`);
  if(result.angleLimited)result.findings.push(`${result.angleLimited} swing estimates reached an angle limit. The inferred club delivery needs checking.`);
  if(result.sensorGaps)result.findings.push(`${result.sensorGaps} attempts contain gaps over 70 ms. Check sensor continuity separately from swing technique.`);
  if(rated.length)result.findings.push(`${feedback.matched}/${rated.length} rated attempts felt right. ${feedback['too-strong']} too strong, ${feedback['too-weak']} too weak, ${feedback['wrong-direction']} wrong direction, ${feedback['false-hit']} unwanted hits, ${feedback['missed-hit']} missed swings.`);
  else if(selected.length)result.findings.push('No player feedback yet. Grades and simulated outcomes cannot establish whether a swing was read correctly.');
  if(selected.length<10)result.findings.push('Small sample: compare several similar swings with the same club before changing sensitivity.');
  for(const g of result.groups){const gentle=g.strengths.gentle,hard=g.strengths.hard;if(gentle?.count>=3&&hard?.count>=3)result.findings.push(`${g.player} / ${g.club}: intended gentle swings average ${Math.round(gentle.meanPower*100)}% power; hard swings ${Math.round(hard.meanPower*100)}%. ${gentle.meanPower>=hard.meanPower?'Strength ordering needs investigation.':'Strength ordering matches the labels.'}`);}
  return result;
}

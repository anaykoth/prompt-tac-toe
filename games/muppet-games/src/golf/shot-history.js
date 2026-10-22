import { HOLE } from './course.js';
import { distanceToPin, surfaceAt, outOfBounds } from './course.js';
import { ShotJournal } from '../phone/shot-journal.js';
import { feedbackFields, readFeedback, fillFeedback, verdictLabel } from '../phone/shot-feedback.js';
import { shotFlags, summarizeShots } from './shot-data.js';
const $=id=>document.getElementById(id),number=x=>Number.isFinite(x)?x.toFixed(1):'—';
export class ShotHistory {
  constructor(link,review){
    this.link=link;this.review=review;this.selected=null;this.active=null;
    this.journal=new ShotJournal(link,'host',()=>this.render());
    $('history-feedback').innerHTML=feedbackFields('history-shot');
    $('history-toggle').onclick=()=>{ $('shot-history').hidden=false;this.journal.refresh();this.render(); };
    $('history-close').onclick=()=>{$('shot-history').hidden=true;};
    for(const id of ['history-source','history-player','history-club','history-use'])$(id).onchange=()=>{this.selected=null;this.render();};
    $('history-retry').onclick=()=>this.journal.flush();
    $('history-export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(this.journal.export(),null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='felt-fairway-shots.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);};
    $('history-shot-save').onclick=()=>{if(this.selected)this.journal.enqueue({version:1,kind:'feedback',id:this.selected.id,playerId:this.selected.playerId,data:readFeedback('history-shot')});};
    $('history-replay').onclick=()=>{const r=this.selected;if(r?.launch?.analysis){$('shot-history').hidden=true;this.review.show(r.launch.analysis,r.launch.delivery,r.result);}};
    this.render();
  }
  receive(p){if(p.type==='welcome'){this.selected=null;this.journal.welcome();}if(p.type==='shot.saved')this.journal.refresh();}
  launch(round,{id=crypto.randomUUID(),playerId='practice',playerName='Practice',source='demo',power,curve}){
    const b=round.ball;if(!b)return;
    this.active={id,playerId,heading:round.heading+round.aim*Math.PI/180,position:{...b.start},trajectory:[],maxHeight:0,lastSample:-1};
    this.journal.enqueue({version:1,kind:'launch',id,data:{recordedAt:new Date().toISOString(),source,playerId,playerName,testSwing:!!b.testSwing,courseId:HOLE.id,mode:round.mode,club:round.club,stroke:round.shots+(b.testSwing?1:0),aim:round.aim,heading:round.heading,position:{...b.start},lie:round.lie,toPin:round.toPin,power,curve,analysis:b.analysis||null,delivery:structuredClone(b.delivery),velocity:[b.vx,b.vy,b.vz],rpm:b.rpm}});
    this.active.startHeight=b.y;this.sample(b);
  }
  sample(ball){
    const a=this.active;if(!a||!ball)return;a.maxHeight=Math.max(a.maxHeight,ball.y-a.startHeight);
    if(ball.age-a.lastSample<.1&&!ball.stopped||a.trajectory.length>=450)return;
    a.lastSample=ball.age;a.trajectory.push([ball.age,ball.x,ball.y,ball.z,ball.rolling?1:0].map(x=>Math.round(x*1000)/1000));
  }
  finish(round){
    const a=this.active,b=round.ball;if(!a||!b)return;this.sample(b);this.active=null;
    const dx=b.x-a.position.x,dz=b.z-a.position.z;
    this.journal.enqueue({version:1,kind:'result',id:a.id,playerId:a.playerId,data:{collisions:b.collisions||[],endedAt:new Date().toISOString(),carry:b.carry||0,total:round.lastDistance,toPin:b.holed?0:distanceToPin(b),flightTime:b.age,maxHeight:a.maxHeight,lateral:dx*Math.cos(a.heading)+dz*Math.sin(a.heading),forward:dx*Math.sin(a.heading)-dz*Math.cos(a.heading),lie:b.holed?'holed':surfaceAt(b.x,b.z),holed:b.holed,penalty:outOfBounds(b),trajectory:a.trajectory}});
  }
  filtered(){return this.journal.records.filter(r=>($('history-use').value==='all'||$('history-use').value===((r.launch?.testSwing??r.attempt?.testSwing)?'test':'play'))&&($('history-source').value==='all'||r.source===$('history-source').value)&&(!$('history-player').value||r.playerId===$('history-player').value)&&(!$('history-club').value||(r.launch?.club||r.attempt?.club)===$('history-club').value));}
  render(){
    $('history-save-status').textContent=this.journal.status;$('history-count').textContent=this.journal.records.length;
    const playerSelect=$('history-player'),previous=playerSelect.value,names=new Map(this.journal.records.map(r=>[r.playerId,r.playerName]));
    const signature=JSON.stringify([...names]);if(playerSelect.dataset.signature!==signature){playerSelect.dataset.signature=signature;playerSelect.replaceChildren(new Option('All players',''),...[...names].map(([id,name])=>new Option(name,id)));playerSelect.value=previous;}
    const records=this.filtered(),summary=summarizeShots(records,{source:$('history-source').value});
    $('history-summary').textContent=`${summary.total} ${summary.total===1?'attempt':'attempts'} · ${summary.complete} finished ${summary.complete===1?'shot':'shots'} · ${summary.rated} rated · ${summary.fallback} impact fallbacks`;
    $('history-findings').replaceChildren();for(const finding of summary.findings){const p=document.createElement('p');p.textContent=finding;$('history-findings').append(p);}
    $('history-list').replaceChildren();
    for(const r of [...records].reverse()){
      const b=document.createElement('button');b.className='history-row'+(this.selected?.id===r.id&&this.selected?.playerId===r.playerId?' selected':'');
      const title=document.createElement('b');title.textContent=`${(r.launch?.testSwing??r.attempt?.testSwing)?'TEST · ':''}${r.playerName} · ${(r.launch?.club||r.attempt?.club||'swing').toUpperCase()} · ${new Date(r.createdAt).toLocaleTimeString()}`;
      const small=document.createElement('span'),power=r.launch?.power??r.attempt?.power;
      small.textContent=`${power===null||power===undefined?'No hit':Math.round(power*100)+'%'} · ${r.result?number(r.result.total)+' m':r.launch?'Ball result pending':r.attempt?.endReason||'Pending'} · ${verdictLabel[r.feedback?.verdict||'unrated']}`;
      b.append(title,small);b.onclick=()=>{this.selected=r;fillFeedback('history-shot',r.feedback);this.render();};$('history-list').append(b);
    }
    if(!records.length){const p=document.createElement('p');p.className='fine';p.textContent=$('history-source').value==='phone'?'Take a phone swing to start. Simulated mouse shots have their own filter.':'No attempts in this view.';$('history-list').append(p);}
    if(this.selected){this.selected=records.find(r=>r.id===this.selected.id&&r.playerId===this.selected.playerId)||null;}
    $('history-detail').hidden=!this.selected;
    if(this.selected){
      const r=this.selected,a=r.launch?.analysis||r.attempt?.analysis;
      $('history-selected').textContent=`${r.playerName} / ${(r.launch?.club||r.attempt?.club).toUpperCase()}`;
      $('history-metrics').textContent=[r.result?`Carry ${number(r.result.carry)} m · total ${number(r.result.total)} m · ${number(Math.abs(r.result.lateral))} m ${r.result.lateral<0?'left':'right'} of aim · ${r.result.lie}${r.result.penalty?' · OB penalty':''}${r.result.holed?' · HOLED':''}`:'No completed ball result.',a?`Face ${number(a.face)}° · return path ${number(a.path)}° · attack ${number(a.attack)}° · ${a.tempo.toFixed(2)}:1 tempo · ${a.grade} ${Math.round(a.score*100)}/100`:'No delivery analysis.',r.signal?`${r.signal.samples} sensor samples · ${Math.round(r.signal.hz)} Hz · longest gap ${Math.round(r.signal.maxGap)} ms`:'No phone sensor capture.'].join('\n');
      $('history-flags').textContent=shotFlags(r).join(' · ')||'No automated signal flags. Player feedback is still needed to judge accuracy.';
      $('history-replay').disabled=!r.launch?.analysis;
    }
    this.draw(records);
  }
  draw(records){
    const c=$('history-plot'),g=c.getContext('2d'),w=c.width,h=c.height;g.fillStyle='#102d27';g.fillRect(0,0,w,h);
    const done=records.filter(r=>r.result),maxForward=Math.max(10,...done.map(r=>Math.abs(r.result.forward))),maxSide=Math.max(3,...done.map(r=>Math.abs(r.result.lateral)));
    g.strokeStyle='#85aa8a55';g.setLineDash([4,5]);g.beginPath();g.moveTo(w/2,25);g.lineTo(w/2,h-30);g.stroke();g.setLineDash([]);
    g.fillStyle='#abc5b4';g.font='12px sans-serif';g.fillText('LANDINGS RELATIVE TO EACH SHOT’S AIM',14,18);g.fillText('LEFT',14,h-10);g.fillText('RIGHT',w-50,h-10);
    for(const r of done){const x=w/2+r.result.lateral/maxSide*(w/2-25),y=h-35-Math.max(0,r.result.forward)/maxForward*(h-65);g.fillStyle=r.feedback?.verdict==='matched'?'#9ed7aa':r.feedback&&r.feedback.verdict!=='unrated'?'#ffad7a':'#ead089';g.beginPath();g.arc(x,y,5,0,Math.PI*2);g.fill();}
    if(!done.length)g.fillText('Completed shots will appear here.',w/2-90,h/2);
  }
}

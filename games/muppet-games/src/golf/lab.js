import { validateTake, recordingMetrics, recordingBundle, poseAt } from '../phone/recording.js';
import { positionLabel } from '../phone/screen-pose.js';
const $=id=>document.getElementById(id);
export class SwingLab {
  constructor(link,onOpen){
    this.link=link;this.onOpen=onOpen;this.takes=[];this.selected=null;this.playing=false;this.playhead=0;this.lastFetch=0;this.capturing=false;
    try{const stored=JSON.parse(localStorage.getItem('felt-swing-lab:takes')||'[]');this.takes=stored.filter(validateTake).slice(-12);}catch{}
    $('lab-toggle').onclick=()=>this.open();$('lab-close').onclick=()=>this.close();
    $('lab-replay').onclick=()=>{if(!this.selected)return;if(this.playhead>=this.selected.duration)this.playhead=0;this.playing=!this.playing;$('swing-lab').classList.toggle('playing',this.playing);$('lab-replay').textContent=this.playing?'Ⅱ PAUSE':'▶ REPLAY CLUB';};
    $('lab-scrub').oninput=()=>{this.playing=false;this.playhead=this.selected.duration*Number($('lab-scrub').value)/1000;this.draw();};
    $('desktop-save-note').onclick=()=>this.saveNote();
    $('lab-export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(recordingBundle(this.takes),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`swing-lab-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);};
    this.renderList();if(this.takes.length)this.select(this.takes.at(-1));
  }
  open(){this.onOpen();$('swing-lab').hidden=false;document.body.classList.add('lab-open');this.refresh();}
  close(){this.playing=false;$('swing-lab').hidden=true;$('swing-lab').classList.remove('playing');document.body.classList.remove('lab-open');}
  async receive(p){
    if(p.type==='welcome')this.refresh();
    if(p.type==='lab.saved'){$('lab-files').textContent=`Saved on this computer: recordings/swing-lab/${p.filename}`;await this.refresh(p.id);if(!$('swing-lab').hidden)$('lab-live').textContent='Take saved. Replay it, add a note, or record another on your phone.';}
    if(p.type==='lab.status'){
      this.capturing=['countdown','recording'].includes(p.status);if(this.capturing){this.playing=false;$('swing-lab').classList.remove('playing');}
      if(['countdown','recording'].includes(p.status)&&$('swing-lab').hidden)this.open();
      $('lab-live').textContent=p.status==='countdown'?`Get ready · ${p.label}`:p.status==='recording'?`● RECORDING ${p.label} · ${(p.elapsed/1000).toFixed(1)} / 12 s`:p.status==='uploading'?'Saving the full sensor recording…':`${p.label==='Ready for review'?'Ready for review. Tell Codex “the swings are recorded”.':'Ready for another swing on your phone.'}`;
    }
  }
  async refresh(selectId){
    const c=this.link.credentials;if(!this.link.connected||!c.token)return;
    const ticket=++this.lastFetch;
    try{
      const response=await fetch(`/phone-takes?room=${encodeURIComponent(c.room)}`,{headers:{Authorization:`Bearer ${c.token}`}});if(!response.ok)throw Error('Recordings are temporarily unavailable.');
      const data=await response.json();if(ticket!==this.lastFetch)return;
      const incoming=data.takes.filter(validateTake);
      const byId=new Map(this.takes.map(t=>[t.id,t]));for(const take of incoming)byId.set(take.id,take);
      this.takes=[...byId.values()].slice(-12);this.persist();this.renderList();
      if(selectId)this.select(this.takes.find(t=>t.id===selectId));else if(!this.selected&&this.takes.length)this.select(this.takes.at(-1));
    }catch(error){$('lab-files').textContent=error.message;}
  }
  persist(){try{localStorage.setItem('felt-swing-lab:takes',JSON.stringify(this.takes));}catch{$('lab-files').textContent='Browser storage is full. Completed takes are still saved in recordings/swing-lab on this computer.';}}
  renderList(){
    $('lab-count').textContent=this.takes.length;$('lab-export').disabled=!this.takes.length;$('lab-takes').replaceChildren();
    for(const [i,t]of this.takes.entries()){
      const b=document.createElement('button');b.className='lab-take'+(this.selected?.id===t.id?' selected':'');b.textContent=`${String(i+1).padStart(2,'0')} / ${t.label}`;
      const small=document.createElement('small');small.textContent=`${(t.duration/1000).toFixed(1)} s · ${t.samples.length} samples · ${t.endReason}`;b.append(small);b.onclick=()=>this.select(t);$('lab-takes').append(b);
    }
  }
  select(take){
    if(!take)return;this.selected=take;this.playhead=0;this.playing=false;this.metrics=recordingMetrics(take);$('swing-lab').classList.remove('playing');$('lab-replay').textContent='▶ REPLAY CLUB';
    $('lab-empty').hidden=true;$('lab-detail').hidden=false;$('desktop-lab-notes').value=take.notes;
    $('lab-duration').textContent=`${(take.duration/1000).toFixed(2)} s`;$('lab-peak').textContent=`${Math.round(this.metrics.peak)} °/s`;$('lab-hz').textContent=`${Math.round(this.metrics.hz)} Hz`;$('lab-gap').textContent=`${Math.round(this.metrics.maxGap)} ms`;
    $('lab-pose-note').textContent=poseAt(take,0)?'Replay shows phone rotation, not a reconstructed path of your hands.':'Orientation was unavailable. Raw rotation rates are still recorded; the 3D club replay is unavailable for this take.';
    if(take.calibration)$('lab-pose-note').textContent=`Camera aligned · ${positionLabel(take.calibration)}. Screen-relative rotation replay; initial position stays fixed. Depth/tilt use an assumed ${take.calibration.fieldOfView}° camera field of view.`;
    $('lab-events').replaceChildren();
    for(const e of take.events){const b=document.createElement('button');b.className='quiet';b.textContent=`${(e.t/1000).toFixed(2)} s · ${e.kind}${e.value?' · '+e.value:''}`;b.onclick=()=>{this.playhead=e.t;this.playing=false;this.draw();};$('lab-events').append(b);}
    this.renderList();this.draw();
  }
  async saveNote(){
    if(!this.selected)return;this.selected.notes=$('desktop-lab-notes').value;this.persist();const c=this.link.credentials;
    $('desktop-save-note').disabled=true;
    try{const response=await fetch(`/phone-takes?room=${encodeURIComponent(c.room)}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${c.token}`},body:JSON.stringify(this.selected)});if(!response.ok)throw Error('Could not save the note to disk. Download the recordings to keep it.');$('lab-files').textContent='Note saved in the recording file on this computer.';}
    catch(error){$('lab-files').textContent=error.message;}
    finally{$('desktop-save-note').disabled=false;}
  }
  tick(dt){
    if($('swing-lab').hidden||!this.selected||this.capturing)return null;
    if(this.playing){this.playhead=Math.min(this.selected.duration,this.playhead+dt*1000*Number($('lab-speed').value));if(this.playhead>=this.selected.duration){this.playing=false;$('lab-replay').textContent='▶ REPLAY CLUB';$('swing-lab').classList.remove('playing');}this.draw();}
    return poseAt(this.selected,this.playhead);
  }
  draw(){
    if(!this.selected)return;const c=$('lab-graph'),g=c.getContext('2d'),w=c.width,h=c.height,t=this.selected,max=Math.max(100,this.metrics.peak),duration=t.duration||1;
    g.fillStyle='#12372e';g.fillRect(0,0,w,h);g.strokeStyle='#c8d9bd25';g.lineWidth=1;
    for(let i=0;i<=4;i++){const y=15+(h-30)*i/4;g.beginPath();g.moveTo(0,y);g.lineTo(w,y);g.stroke();}
    ['#f1d376','#ff9a6c','#9cdbbc'].forEach((color,k)=>{g.strokeStyle=color;g.lineWidth=2;g.beginPath();let started=false;for(const s of t.samples){if(s.rate[k]===null){started=false;continue;}const x=s.t/duration*w,y=h/2-s.rate[k]/max*(h/2-15);if(started)g.lineTo(x,y);else{g.moveTo(x,y);started=true;}}g.stroke();});
    for(const e of t.events){g.strokeStyle=e.kind==='recognized'?'#f8f2d9':'#b5c9bc55';g.beginPath();g.moveTo(e.t/duration*w,0);g.lineTo(e.t/duration*w,h);g.stroke();}
    g.strokeStyle='#fff';g.lineWidth=2;g.beginPath();g.moveTo(this.playhead/duration*w,0);g.lineTo(this.playhead/duration*w,h);g.stroke();
    $('lab-scrub').value=this.playhead/duration*1000;$('lab-time').textContent=`${(this.playhead/1000).toFixed(2)} s`;
  }
}

import { SwingRecording, MAX_DURATION, MAX_SAMPLES, MAX_TAKES, recordingBundle } from './recording.js';
const $=id=>document.getElementById(id);
export class PhoneSwingLab {
  constructor({link,ready,neutral,calibration=()=>null,onMode}){
    this.calibration=calibration;
    this.link=link;this.ready=ready;this.neutral=neutral;this.onMode=onMode;this.mode=false;this.count=0;this.recording=null;this.countdown=0;this.lastTake=null;this.saving=false;this.lastStatus=0;
    $('mode-play').onclick=()=>this.setMode(false);$('mode-lab').onclick=()=>this.setMode(true);
    $('lab-record').onclick=()=>this.start();$('lab-stop').onclick=()=>this.finish('finished');
    $('lab-save-notes').onclick=()=>{if(this.lastTake){this.lastTake.notes=$('lab-notes').value;this.save(this.lastTake);}};
    $('lab-retry').onclick=()=>{if(this.lastTake)this.save(this.lastTake);};
    $('lab-download').onclick=()=>{if(!this.lastTake)return;const url=URL.createObjectURL(new Blob([JSON.stringify(recordingBundle([this.lastTake]),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`swing-${this.lastTake.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);};
    $('lab-done').onclick=async()=>{if(this.recording||this.countdown)this.finish('finished');else if(this.lastTake&&this.lastTake.notes!==$('lab-notes').value){this.lastTake.notes=$('lab-notes').value;await this.save(this.lastTake);}if(!this.saving&&$('lab-retry').hidden){$('lab-help').textContent='Your takes are ready on the computer. Tell Codex “the swings are recorded”.';this.status('idle',0,'Ready for review');}};
    setInterval(()=>this.tick(),100);
  }
  setMode(mode){if(this.recording||this.countdown)this.finish('mode-change');this.mode=mode;this.onMode(mode);$('phone-lab').hidden=!mode;$('mode-lab').classList.toggle('selected',mode);$('mode-play').classList.toggle('selected',!mode);$('phone-instruction').textContent=mode?'Lab mode: record natural movement. The grip is optional and no ball is hit.':'Turn to aim. Hold Swing to set direction, then tilt the face and swing through.';}
  receive(p){
    if(p.type==='welcome'){
      this.count=p.labCount||0;
      $('lab-save-status').textContent=`${this.count} / ${MAX_TAKES} takes saved on the computer.`;
      try{const pending=JSON.parse(localStorage.getItem(`swing-lab:pending:${p.room}`)||'null');if(pending){this.lastTake=pending;$('lab-note-panel').hidden=false;$('lab-notes').value=pending.notes;$('lab-retry').hidden=false;$('lab-save-status').textContent='An unsent take is still on this phone. Tap Retry saving take.';}}catch{}
    }
    if(p.type==='lab.saved'){this.count=p.count;$('lab-save-status').textContent=`${this.count} / ${MAX_TAKES} takes saved on the computer.`;}
    if(p.type==='disconnected'||p.type==='presence'&&!p.host)this.finish('disconnected');
  }
  status(status,elapsed=0,label=$('lab-label').value){this.link.send({type:'lab.status',status,elapsed,label});}
  start(){
    if(!this.ready()||this.count>=MAX_TAKES||this.saving||this.recording||this.countdown)return;
    if(this.lastTake&&!$('lab-retry').hidden){$('lab-help').textContent='Save or download the previous take before recording another.';return;}
    this.onMode(true);this.countdown=performance.now()+2000;$('lab-record').hidden=true;$('lab-stop').hidden=false;$('lab-note-panel').hidden=true;$('lab-label').disabled=$('lab-hand').disabled=true;this.status('countdown');
  }
  tick(){
    const now=performance.now();
    $('lab-record').disabled=!this.ready()||this.count>=MAX_TAKES||this.saving;
    if(this.countdown){
      if(!this.ready()){this.finish('motion-paused');return;}
      const left=Math.ceil((this.countdown-now)/1000);$('lab-clock').textContent=left>0?`${left}…`:'GO';$('lab-help').textContent='Get comfortable. Recording starts after the count-in.';
      if(now>=this.countdown){this.countdown=0;this.recording=new SwingRecording(now,{label:$('lab-label').value.trim()||`Swing ${this.count+1}`,hand:$('lab-hand').value,neutral:this.neutral(),screenAngle:screen.orientation?.angle||0,calibration:this.calibration()});$('lab-help').textContent='Recording everything. Swing naturally, then tap Stop & save.';this.status('recording');}
    }
    if(this.recording){const elapsed=Math.min(MAX_DURATION,now-this.recording.origin);$('lab-clock').textContent=`${(elapsed/1000).toFixed(1)} / 12 s`;if(now-this.lastStatus>500){this.status('recording',elapsed);this.lastStatus=now;}if(elapsed>=MAX_DURATION)this.finish('time-limit');}
  }
  sample(event,orientation,now){if(this.recording){this.recording.sample(event,orientation,now);if(this.recording.take.samples.length>=MAX_SAMPLES)this.finish('sample-limit');}}
  event(kind,value=null){this.recording?.event(kind,performance.now(),value);}
  finish(reason='finished'){
    if(!this.recording&&!this.countdown)return;
    this.countdown=0;$('lab-record').hidden=false;$('lab-stop').hidden=true;$('lab-label').disabled=$('lab-hand').disabled=false;
    if(!this.recording){$('lab-help').textContent='Count-in cancelled. Ready when you are.';this.status('idle');return;}
    const take=this.recording.finish(performance.now(),reason);this.recording=null;
    if(!take.samples.length){$('lab-help').textContent='No sensor samples were received. Enable motion and try again.';this.status('idle');return;}
    this.lastTake=take;$('lab-notes').value='';$('lab-note-panel').hidden=false;$('lab-help').textContent='Take captured. Add what you meant, or record another swing.';
    this.save(take);
  }
  async save(take){
    if(this.saving)return;this.saving=true;$('lab-save-notes').disabled=true;
    const c=this.link.credentials;
    try{localStorage.setItem(`swing-lab:pending:${c.room}`,JSON.stringify(take));}catch{$('lab-save-status').textContent='Phone storage unavailable. Keep this page open until the computer confirms saving.';}
    $('lab-retry').hidden=true;this.status('uploading');
    try{
      if(!this.link.connected)throw Error('Disconnected');
      const response=await fetch(`/phone-takes?room=${encodeURIComponent(c.room)}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${c.token}`},body:JSON.stringify(take),signal:AbortSignal.timeout(15000)});
      const result=await response.json();if(!response.ok)throw Error(result.error||'Save failed');
      this.count=result.count;try{localStorage.removeItem(`swing-lab:pending:${c.room}`);}catch{}
      $('lab-save-status').textContent=`${this.count} / ${MAX_TAKES} takes saved on the computer. Raw motion and notes are in the recording file.`;this.status('idle');
    }catch(error){$('lab-save-status').textContent=`Take kept on this phone. ${error.message}. Retry saving or download this take.`;$('lab-retry').hidden=false;}
    finally{this.saving=false;$('lab-save-notes').disabled=false;}
  }
}

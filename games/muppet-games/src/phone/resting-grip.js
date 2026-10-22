/** Both screens request the same phone-side countdown. Only the phone samples
 * the resting pose, at the end, so network/click latency doesn't choose it. */
export class RestingGrip {
  constructor({link,ready,capture,onStatus,now=()=>performance.now()}){
    Object.assign(this,{link,ready,capture,onStatus,now});this.alignmentId=null;this.requestId=null;this.timer=null;
  }
  align(id){this.stop();this.alignmentId=id;}
  request(){if(this.alignmentId&&!this.requestId)this.link.send({type:'grip.request'});}
  receive(p){
    if(p.type==='grip.countdown'){
      if(this.requestId===p.requestId)return;
      if(p.alignmentId!==this.alignmentId||!this.ready()){
        const message='Keep the phone controller open with live motion readings, then try again.';
        this.link.send({type:'grip.result',requestId:p.requestId,ok:false,message});this.onStatus(message,false);return;
      }
      this.stop();this.requestId=p.requestId;this.deadline=this.now()+2000;
      this.tick();this.timer=setInterval(()=>this.tick(),100);
    }
    if(p.type==='grip.result'&&p.requestId===this.requestId){this.stop();this.onStatus(p.ok?'Resting position set. Ready to swing.':p.message,false);}
    if(p.type==='grip.unavailable'||p.type==='disconnected'||p.type==='presence'&&!p.host){this.stop();this.alignmentId=null;}
  }
  tick(){
    if(!this.requestId)return;
    const left=Math.ceil((this.deadline-this.now())/1000);
    if(left>0){this.onStatus(`Lower the phone into its resting position. Capturing in ${left}…`,true);return;}
    clearInterval(this.timer);this.timer=null;
    const gripScreen=this.ready()?this.capture():null;
    this.link.send({type:'grip.result',requestId:this.requestId,ok:!!gripScreen,...(gripScreen?{gripScreen}:{message:'Motion paused. Keep the phone page open and try setting the resting position again.'})});
    this.onStatus(gripScreen?'Resting position captured. Confirming with the computer…':'Motion paused. Try setting the resting position again.',true);
    this.timer=setTimeout(()=>{if(this.requestId){this.stop();this.onStatus('No confirmation yet. Tap Set resting position to retry.',false);}},5000);
  }
  stop(){clearInterval(this.timer);clearTimeout(this.timer);this.timer=null;this.requestId=null;}
  clear(){this.stop();this.alignmentId=null;this.link.send({type:'grip.cancel',invalidate:true});}
}

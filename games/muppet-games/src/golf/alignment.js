import { markerSVG } from '../phone/marker.js';
import { positionLabel } from '../phone/screen-pose.js';
const $=id=>document.getElementById(id);
export class ScreenAlignment {
  constructor(link,onStart=()=>{}){
    this.link=link;this.onStart=onStart;this.request=null;
    $('alignment-close').onclick=()=>this.cancel();
    $('rest-capture').onclick=()=>{if(this.aligned&&!this.restRequest){$('rest-capture').disabled=true;$('rest-status').textContent='Starting the two-second countdown on your phone…';this.link.send({type:'grip.request',playerId:this.playerId});}};
    $('rest-toggle').onclick=()=>{if(this.aligned)this.showRest();};
    $('rest-cancel').onclick=()=>{this.link.send({type:'grip.cancel',playerId:this.playerId});this.restRequest=null;$('resting-setup').hidden=true;};
    window.addEventListener('resize',()=>{if(this.request)this.cancel();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&this.request)this.cancel();});
  }
  cancel(){if(this.request)this.link.send({type:'camera.cancel',playerId:this.playerId});this.hide();}
  hide(){this.request=null;$('screen-alignment').hidden=true;}
  showRest(){this.onStart();$('resting-setup').hidden=false;$('rest-capture').disabled=!!this.restRequest;$('rest-status').textContent=this.restRequest?'Countdown running on the phone. Hold your club at rest…':'Lower the phone into the position where your club rests before a swing. Click below, then hold that pose through the two-second countdown.';}
  clearRest(){this.aligned=false;this.restRequest=null;$('resting-setup').hidden=true;$('rest-toggle').hidden=true;}
  receive(p){
    const paired=p.players?(this.playerId?p.players.some(player=>player.id===this.playerId&&player.online):p.players.some(player=>player.online)):p.controller;
    if(p.playerId&&this.playerId&&p.playerId!==this.playerId&&!['camera.target','grip.countdown'].includes(p.type))return;
    if(p.type==='camera.target'){
      this.playerId=p.playerId;
      if(document.hidden){this.link.send({type:'camera.cancel',playerId:this.playerId});return;}
      this.clearRest();
      this.onStart();this.request=p;$('screen-reference').hidden=true;$('screen-marker').innerHTML=markerSVG(p.markerId);$('alignment-room').textContent=this.link.credentials.room;
      $('screen-alignment').hidden=false;$('alignment-status').textContent='Point your phone’s rear camera at the square. Small hand movements are fine.';
      requestAnimationFrame(()=>{if(this.request===p)this.link.send({type:'camera.visible',requestId:p.requestId,playerId:p.playerId});});
    }
    if(p.type==='camera.locked'){
      this.playerId=p.playerId;
      this.hide();$('screen-reference').hidden=false;$('screen-reference').textContent=`SCREEN ALIGNED · ${positionLabel(p.calibration)}. Initial position held; motion tracks rotation.`;
      this.aligned=true;this.restRequest=null;$('rest-toggle').hidden=false;this.showRest();
      $('phase').textContent='SCREEN LOCKED. LOWER YOUR CLUB.';$('commentary').textContent='Set your resting position with the button on this screen. The camera alignment stays saved.';
    }
    if(p.type==='grip.countdown'){this.playerId=p.playerId;this.restRequest=p.requestId;$('resting-setup').hidden=false;$('rest-capture').disabled=true;$('rest-status').textContent='Two-second countdown running on the phone. Hold your club in its resting position…';}
    if(p.type==='grip.result'&&p.requestId===this.restRequest){
      this.restRequest=null;$('rest-capture').disabled=false;$('rest-status').textContent=p.message;
      if(p.ok){$('resting-setup').hidden=true;$('phase').textContent='RESTING POSITION SET. READY TO SWING.';$('commentary').textContent='Your lowered phone is the club’s resting pose. Camera alignment is preserved.';}
    }
    if(p.type==='error'&&!$('resting-setup').hidden){this.restRequest=null;$('rest-capture').disabled=false;$('rest-status').textContent=p.message;}
    if(p.type==='grip.unavailable'||p.type==='disconnected'||p.type==='presence'&&(!paired||!p.host)){this.clearRest();$('screen-reference').hidden=true;}
    if(p.type==='camera.cancelled'||p.type==='disconnected'||p.type==='presence'&&!paired)this.hide();
    if(p.type==='disconnected'||p.type==='presence'&&!paired)$('screen-reference').hidden=true;
  }
}

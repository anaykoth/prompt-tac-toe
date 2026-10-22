import { createDetector, estimateMarker, StableMarker } from './marker.js';
import { deviceMatrix, multiply, transpose, positionLabel } from './screen-pose.js';
const $=id=>document.getElementById(id);
const angle=()=>screen.orientation?.angle??window.orientation??0;

export class CameraAlignment {
  constructor({link,sensor,onLock,onCancel}){
    Object.assign(this,{link,sensor,onLock,onCancel});this.active=false;this.generation=0;this.stable=new StableMarker();
    this.detector=createDetector();this.canvas=document.createElement('canvas');this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});
    $('camera-cancel').onclick=()=>this.stop();
    $('camera-lock').onclick=()=>this.lock();
    $('camera-lock-now').onclick=()=>this.lock(true);
    for(const id of ['marker-width','camera-fov'])$(id).oninput=()=>this.status('Settings changed. Point at the square to capture alignment again.',true);
  }
  async start(){
    if(this.active)return;
    if(!navigator.mediaDevices?.getUserMedia){$('sensor-status').textContent='Camera access needs the secure phone link and a browser with camera support.';return;}
    this.active=true;const generation=++this.generation;this.target=null;this.visible=false;this.stable.reset();this.candidate=null;this.manualCandidate=null;this.captureMethod=null;this.lastVideoTime=null;
    $('camera-progress').value=0;
    $('camera-panel').hidden=false;$('calibrate').disabled=true;$('camera-lock').disabled=true;$('camera-lock-now').disabled=true;$('camera-status').textContent='Point at the square once. Lock now becomes available after the first usable reading.';
    this.link.send({type:'camera.request'});
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{exact:'environment'},width:{ideal:720},height:{ideal:960},frameRate:{ideal:24,max:30}}});
      if(!this.active||generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;const video=$('camera-video');video.srcObject=stream;await video.play();
      if(!this.active||generation!==this.generation)return;
      this.timer=setInterval(()=>this.frame(),85);
      this.stream.getVideoTracks()[0].addEventListener('ended',()=>{if(this.active)this.fail('Camera stopped. Tap Align with screen to try again.');});
    }catch(error){if(generation!==this.generation)return;this.fail(error.name==='NotAllowedError'?'Camera access was denied. Allow Camera in this site’s settings, then tap Align with screen.':error.name==='OverconstrainedError'?'No rear camera is available. Open this link on your phone.':`Could not open the camera. ${error.message}`);}
  }
  receive(p){
    if(p.type==='camera.target'&&this.active){this.target=p;this.visible=false;this.status('Finding the current screen target…',true);}
    if(p.type==='camera.visible'&&p.requestId===this.target?.requestId)this.visible=true;
    if(p.type==='camera.locked'&&this.active&&p.requestId===this.target?.requestId){const c=p.calibration;this.stop(false);this.onLock(c,p.requestId);}
    if(p.type==='camera.cancelled'&&this.active)this.fail('Alignment was interrupted. Keep the computer range visible and try again.');
    if(p.type==='disconnected'||p.type==='presence'&&!p.host)this.stop(false);
  }
  frame(){
    const video=$('camera-video'),now=performance.now();if(video.readyState<2||!this.target||this.pending||this.candidate)return;
    const sensor=this.sensor();
    if(!this.visible){this.status('Waiting for the alignment target on your computer.',true);return;}
    if(!sensor||now-sensor.time>350){this.status('Waiting for live orientation. Enable both motion and orientation permissions.');return;}
    if(video.currentTime===this.lastVideoTime){this.status('Waiting for the next camera frame…');return;}
    this.lastVideoTime=video.currentTime;
    const width=Math.round(video.videoWidth*Math.min(1,640/Math.max(video.videoWidth,video.videoHeight))),height=Math.round(video.videoHeight*Math.min(1,640/Math.max(video.videoWidth,video.videoHeight)));
    if(!width||!height)return;
    this.canvas.width=width;this.canvas.height=height;this.ctx.drawImage(video,0,0,width,height);
    const overlay=$('camera-corners');overlay.width=width;overlay.height=height;const g=overlay.getContext('2d');g.clearRect(0,0,width,height);
    try{
      const markers=this.detector.detect(this.ctx.getImageData(0,0,width,height));
      const marker=markers.find(m=>m.id===this.target.markerId);
      if(!marker){this.status(markers.length?'Point at the square on your paired computer.':'Keep the whole black square in view. Small movements are fine.');return;}
      g.strokeStyle='#b9fa9d';g.lineWidth=3;g.beginPath();marker.corners.forEach((p,i)=>i?g.lineTo(p.x,p.y):g.moveTo(p.x,p.y));g.closePath();g.stroke();
      const fieldOfView=Number($('camera-fov').value);
      if(!Number.isFinite(fieldOfView)||fieldOfView<35||fieldOfView>100){this.status('Enter a camera field of view between 35° and 100°.',true);return;}
      const pose=estimateMarker(marker.corners,width,height,{fieldOfView,screenAngle:angle()});
      if(!pose){this.status('Move closer and face the screen more directly. Keep all four corners visible.');return;}
      // A manual lock needs one optical/IMU pair, never the steadiness threshold.
      this.manualCandidate={pose,sensor:{...sensor.orientation},time:now,frames:1};
      $('camera-lock-now').disabled=false;
      if(sensor.speed>45){this.status('A usable reading is ready. Tap Lock now, or slow down for the optional steady capture.');return;}
      const progress=this.stable.sample(pose,now);
      $('camera-progress').value=progress;
      this.candidate=progress===1&&this.stable.accepted?{pose,sensor:{...sensor.orientation},time:now,frames:Math.min(1000,this.stable.count)}:null;
      $('camera-lock').disabled=!this.candidate;
      $('camera-status').textContent=this.candidate?'Steady capture ready. Choose either lock button, then lower your phone.':`Lock now is ready. Optional steady capture: ${Math.round(progress*100)}%.`;
    }catch{this.status('Could not read that frame. Keep the square fully visible.');}
  }
  status(message,reset=false){
    if(reset){this.stable.reset();this.candidate=null;this.manualCandidate=null;this.captureMethod=null;}
    else if(this.candidate)return; // The camera pose and IMU reading were captured together.
    const progress=reset?0:this.stable.sample(null,performance.now());
    $('camera-lock').disabled=true;$('camera-progress').value=progress;
    $('camera-lock-now').disabled=!this.manualCandidate;
    $('camera-status').textContent=this.manualCandidate?`Lock now can use the last captured reading. ${message}`:progress>0?`${Math.round(progress*100)}% kept · ${message}`:message;
  }
  lock(manual=false){
    // Lock the captured optical/IMU pair, not the phone's later pose while tapping.
    manual=manual||this.captureMethod==='manual';
    const candidate=manual?this.manualCandidate:this.candidate;if(!candidate||!this.active||this.pending)return;
    const width=$('marker-width').value.trim(),markerWidthCm=width?Number(width):null;
    if(width&&(!Number.isFinite(markerWidthCm)||markerWidthCm<1||markerWidthCm>200)){$('camera-status').textContent='Enter a black-square width between 1 and 200 cm, or leave it empty.';return;}
    const {pose,sensor}=candidate;
    this.candidate=candidate;this.captureMethod=manual?'manual':'steady';
    const calibration={version:1,source:'screen-marker',reference:'viewport-center',lockMethod:this.captureMethod,markerId:this.target.markerId,capturedAt:new Date(Date.now()-(performance.now()-candidate.time)).toISOString(),position:pose.position,markerWidthCm,fieldOfView:pose.fieldOfView,focalPixels:pose.focalPixels,frame:pose.frame,reprojectionError:pose.reprojectionError,screenAngle:pose.screenAngle,stableFrames:candidate.frames,cameraDevice:pose.device,screenFromSensor:multiply(pose.device,transpose(deviceMatrix(sensor))),gripScreen:pose.device,sensorAtLock:[sensor.alpha,sensor.beta,sensor.gamma]};
    this.pending=true;$('camera-lock').disabled=true;$('camera-lock-now').disabled=true;$('camera-status').textContent='Saving alignment on your computer…';
    this.link.send({type:'camera.lock',requestId:this.target.requestId,calibration});
    this.lockTimeout=setTimeout(()=>{if(this.pending){this.pending=false;$('camera-lock').disabled=false;$('camera-lock-now').disabled=false;$('camera-status').textContent='Alignment is still captured. Tap a lock button to retry sending it.';}},4000);
  }
  fail(message){this.stop();$('sensor-status').textContent=message;}
  stop(notify=true){
    const wasActive=this.active;this.active=false;this.generation++;this.pending=false;clearInterval(this.timer);clearTimeout(this.lockTimeout);
    this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;$('camera-video').srcObject=null;$('camera-panel').hidden=true;this.stable.reset();this.candidate=null;this.manualCandidate=null;this.captureMethod=null;
    if(wasActive&&notify)this.link.send({type:'camera.cancel'});if(wasActive)this.onCancel?.();
  }
}
export { positionLabel };

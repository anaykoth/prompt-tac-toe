import * as THREE from 'three';
import { Renderer } from '../core/render.js';
import { Audio } from '../core/audio.js';
import { Puppet, defaultSpec } from '../world/puppet.js';
import { Crowd } from '../world/crowd.js';
import { buildBarRoom, barSeats } from '../pool/barroom.js';
import { HOCKEY, constrainTarget } from './physics.js';

const S = .82, TOP = .92, UP = new THREE.Vector3(0, 1, 0);
const PALETTE = [0xff8b42, 0x63e6c7];
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const standard = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: .55, ...opts });
function mesh(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function box(parent, size, mat, x, y, z) { return mesh(parent, new THREE.BoxGeometry(...size), mat, x, y, z); }
function cylinder(parent, r, h, mat, x, y, z) { return mesh(parent, new THREE.CylinderGeometry(r, r, h, 32), mat, x, y, z); }
function segment(object, from, to) {
  object.position.copy(from).add(to).multiplyScalar(.5);
  const length = from.distanceTo(to);
  object.scale.set(1, length, 1);
  object.quaternion.setFromUnitVectors(UP, to.clone().sub(from).normalize());
}
function surfaceTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 1740;
  const c = canvas.getContext('2d'); c.fillStyle = '#d9e9db'; c.fillRect(0, 0, 1024, 1740);
  c.fillStyle = '#487b7440';
  for (let y = 14; y < 1740; y += 19) for (let x = 14; x < 1024; x += 19) { c.beginPath(); c.arc(x,y,1.4,0,7); c.fill(); }
  c.strokeStyle = '#286c6ad9'; c.lineWidth = 7;
  c.beginPath(); c.moveTo(0,870); c.lineTo(1024,870); c.stroke();
  for (const y of [0,870,1740]) { c.beginPath(); c.arc(512,y,y===870?180:260,0,7); c.stroke(); }
  c.fillStyle = '#3d7f7435'; c.textAlign = 'center'; c.font = '900 75px Arial'; c.fillText('AIR HOCKEY',512,660);
  c.font = '600 20px Arial'; c.fillText('THE FUZZ & FEATHER',512,710);
  // Scuffs and water rings are on the table, rather than an overlay on vision.
  c.strokeStyle='#66735b14'; c.lineWidth=2;
  for(let i=0;i<55;i++){const x=(i*137)%1024,y=(i*293)%1740;c.beginPath();c.moveTo(x,y);c.lineTo(x+13+(i%4)*20,y+35);c.stroke();}
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace=THREE.SRGBColorSpace; tex.anisotropy=8; return tex;
}
function signTexture(label, sub = '') {
  const canvas = document.createElement('canvas'); canvas.width=1024; canvas.height=256;
  const c=canvas.getContext('2d'); c.fillStyle='#182421'; c.fillRect(0,0,1024,256);
  c.strokeStyle='#d6b266'; c.lineWidth=5; c.strokeRect(12,12,1000,232);
  c.textAlign='center'; c.fillStyle='#ffe8ad'; c.shadowBlur=15;c.shadowColor='#e6a752';
  c.font='900 86px Arial';c.fillText(label,512,132);c.font='500 25px Arial';c.fillText(sub,512,196);
  const tex = new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;return tex;
}

/** An actual seat at the same pub as Pool. The simulation remains in x/y;
 * the physical table uses x/z, so both human ends share one world. */
export class HockeyScene {
  constructor(canvas) {
    this.canvas=canvas; this.scene=new THREE.Scene();
    this.camera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,.025,50);
    this.renderer=new Renderer(canvas,this.scene,this.camera);
    this.renderer.setStyle('alley');
    this.renderer.bloom.strength=.2;this.renderer.bloom.radius=.38;this.renderer.bloom.threshold=2.1;
    this.renderer.renderer.toneMappingExposure=.92;
    this.audio=new Audio(); this.audio.enabled=true; this.drunk=.32;
    this.ray=new THREE.Raycaster(); this.plane=new THREE.Plane(UP,-TOP); this.hit=new THREE.Vector3();
    this.room=buildBarRoom(); this.scene.add(this.room.group);
    this.room.fixture.position.y=2.55;
    this.room.lights.hemi.intensity=.55;
    this.room.lights.ambient.intensity=.2;
    this.room.lights.tableSpots.forEach(l=>{l.distance=6;l.angle=1.1;});
    this.frontFill=new THREE.PointLight(0xffe0b2,1.45,7,2);this.frontFill.position.set(0,2.2,2.1);this.scene.add(this.frontFill);
    this.backFill=new THREE.PointLight(0x68dacf,1.8,6,2);this.backFill.position.set(0,1.8,-2.5);this.scene.add(this.backFill);
    this._table();this._people();
    this.bump=0;this.goalFlash=0;this.seat=0;this.lastScore='';
    this.camera.position.set(0,2.02,2.32);this.camera.lookAt(0,.76,-.1);this.camera.updateMatrixWorld();
    this.audioReady=false;
  }
  _table() {
    const g=this.table=new THREE.Group();this.scene.add(g);
    const wood=standard(0x3e2520,{roughness:.8}),black=standard(0x192a27,{roughness:.45}),brass=standard(0x8b7350,{metalness:.65,roughness:.38});
    const w=HOCKEY.halfWidth*S,l=HOCKEY.halfLength*S;
    box(g,[2*w+.25,.46,2*l+.22],wood,0,TOP-.29,0);
    for(const x of[-w+.15,w-.15])for(const z of[-l+.22,l-.22])box(g,[.16,.52,.16],black,x,.25,z);
    box(g,[2*w+.19,.075,2*l+.16],brass,0,TOP-.045,0);
    const bed=mesh(g,new THREE.PlaneGeometry(w*2,l*2),standard(0x87afa0,{map:surfaceTexture(),roughness:.8,metalness:.025}),0,TOP,0);bed.rotation.x=-Math.PI/2;
    for(const x of[-w-.045,w+.045]){
      box(g,[.09,.11,2*l+.15],black,x,TOP+.02,0);
      box(g,[.016,.012,2*l],standard(0xb5e0c6,{emissive:0x64c9b3,emissiveIntensity:.65}),x,TOP+.078,0);
    }
    this.goalLights=[];
    for(const seat of[0,1]){
      const side=seat===0?1:-1,z=side*(l+.045),gap=HOCKEY.goalHalfWidth*S;
      for(const x of[-1,1])box(g,[w-gap,.115,.11],black,x*(gap+(w-gap)/2),TOP+.02,z);
      box(g,[gap*2,.025,.18],standard(0x0c1716),0,TOP-.04,z+side*.03);
      box(g,[gap*2,.014,.018],standard(PALETTE[seat],{emissive:PALETTE[seat],emissiveIntensity:1.5}),0,TOP+.012,z);
      const light=new THREE.PointLight(PALETTE[seat],.8,1.7,2);light.position.set(0,TOP+.15,z);g.add(light);this.goalLights.push(light);
      // Seven brass markers sit on each player's end of the cabinet.
      for(let i=0;i<7;i++){
        const pip=mesh(g,new THREE.SphereGeometry(.018,8,6),standard(0x5b5037,{emissive:PALETTE[seat],emissiveIntensity:0}),-.3+i*.1,TOP+.085,z+side*.09);
        pip.userData.seat=seat;pip.userData.point=i;this.goalPips??=[];this.goalPips.push(pip);
      }
    }
    this.mallets=PALETTE.map(color=>{
      const m=new THREE.Group();g.add(m);const paint=standard(color,{roughness:.28,metalness:.12});
      cylinder(m,HOCKEY.malletRadius*S,.035,standard(0x17231e),0,.018,0);
      cylinder(m,HOCKEY.malletRadius*S*.97,.035,paint,0,.042,0);
      cylinder(m,.055,.07,paint,0,.085,0);
      mesh(m,new THREE.SphereGeometry(.056,16,12),paint,0,.122,0).scale.y=.5;
      return m;
    });
    this.puck=new THREE.Group();g.add(this.puck);
    cylinder(this.puck,HOCKEY.puckRadius*S,.026,standard(0x16272c,{roughness:.3,metalness:.3}),0,.015,0);
    cylinder(this.puck,HOCKEY.puckRadius*S*.55,.002,standard(0xf4d768,{emissive:0xf6ae2d,emissiveIntensity:.5}),0,.03,0);
    const sign=mesh(this.scene,new THREE.PlaneGeometry(2.1,.525),new THREE.MeshBasicMaterial({map:signTexture('AIR HOCKEY','GOOD HANDS. BAD COMPANY.')}),0,2.38,-2.7);
    sign.castShadow=false;
    // Someone has already left a pint on the side, safely beyond the playfield.
    const beer=standard(0xd29827,{transparent:true,opacity:.85,roughness:.2});
    cylinder(g,.064,.18,beer,-w-.19,TOP+.09,.8);
    cylinder(g,.064,.018,standard(0xece2bf),-w-.19,TOP+.19,.8);
  }
  _arm(material) {
    const g=new THREE.Group();this.scene.add(g);
    const upper=mesh(g,new THREE.CylinderGeometry(.07,.084,1,12),material);
    const lower=mesh(g,new THREE.CylinderGeometry(.058,.07,1,12),material);
    const palm=mesh(g,new THREE.SphereGeometry(.083,16,12),material);palm.scale.set(1,.58,1.1);
    const fingers=[];
    for(let i=0;i<3;i++)fingers.push(mesh(g,new THREE.CapsuleGeometry(.024,.065,3,7),material));
    const thumb=mesh(g,new THREE.SphereGeometry(.036,10,8),material);thumb.scale.set(1,.65,1.3);
    return {g,upper,lower,palm,fingers,thumb};
  }
  _poseArm(arm, shoulder, elbow, hand, forward) {
    segment(arm.upper,shoulder,elbow);segment(arm.lower,elbow,hand);
    arm.palm.position.copy(hand);
    arm.fingers.forEach((finger,i)=>{finger.position.copy(hand).add(v((i-1)*.039,-.015,forward*.065));finger.rotation.x=Math.PI/2+.35*forward;});
    arm.thumb.position.copy(hand).add(v(.077,-.025,0));
  }
  _people() {
    let spec=defaultSpec();try{spec={...spec,...JSON.parse(localStorage.getItem('splinter-alley.puppet')||'{}')}}catch{}
    this.player=new Puppet(spec);this.player.group.position.set(0,.14,1.86);this.player.group.rotation.y=Math.PI;
    this.player.headPivot.visible=false;this.player.arms.forEach(a=>a.shoulder.visible=false);this.scene.add(this.player.group);
    this.ownArms=[this._arm(this.player.mats[0]),this._arm(this.player.mats[0])];
    this.opponent=new Puppet({...defaultSpec('DOT'),fur:'#d975b7',hair:'#ffcb4c',nose:'#eaa22f',hairStyle:'shaggy',accessory:'scarf',accent:'#29bac2',build:'round',height:1.75});
    this.opponent.group.position.set(0,.15,-1.83);this.scene.add(this.opponent.group);
    this.opponent.arms.forEach(a=>a.shoulder.visible=false);
    this.opponentArms=[this._arm(this.opponent.mats[0]),this._arm(this.opponent.mats[0])];
    const seats=[];
    for(const side of[-1,1])for(let i=0;i<5;i++)seats.push({pos:v(side*(1.43+(i%2)*.12),0,-1.75+i*.68),sit:false,side,rank:0});
    for(const side of[-1,1])for(let i=0;i<5;i++)seats.push({pos:v(side*(2.25+(i%2)*.18),0,-2.3+i*.8),sit:false,side,rank:.5});
    for(const seat of barSeats(48))if(Math.abs(seat.pos.x)>3||seat.pos.z<-3.2)seats.push(seat);
    this.crowd=new Crowd(this.scene,seats,{focus:v(0,TOP,0),scale:1.36,mugs:.8,trackHands:true});
    this.crowd.setDrunk(.8);this.crowd.setMood(.28);
    // Darts placards belong to the darts stage; this crowd has their drinks.
    this.crowd.signs.forEach(s=>s.g.visible=false);
    this.crowd.react(.32,.8);
  }
  enableSound(enabled=true){this.audio.enabled=enabled;if(enabled){this.audio.init();this.audio.resume();}}
  setStyle(style){this.renderer.setStyle(style);}
  react(kind,power=.5){
    if(kind==='goal'){this.crowd.react(1.3,.27);this.audio.roar(1.15);this.audio.bell();this.goalFlash=1;}
    else if(kind==='hit'){this.audio.ballClick(power*10);this.crowd.react(.07+power*.13,.1);this.bump=Math.min(.18,power*.08);}
    else this.audio.railThud(power*8);
  }
  targetAt(clientX,clientY,seat){
    const rect=this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1),this.camera);
    if(!this.ray.ray.intersectPlane(this.plane,this.hit))return null;
    return constrainTarget({x:this.hit.x/S,y:this.hit.z/S},seat);
  }
  update(dt,t,state,{ownSeat=0,drunk=.32,excitement=0,reducedMotion=false}={}){
    this.seat=ownSeat??0;const orientation=this.seat===0?1:-1;
    const ours=state.mallets[this.seat],theirs=state.mallets[1-this.seat];
    const ownHand=v(ours.x*S,TOP+.15,ours.y*S),enemyHand=v(theirs.x*S,TOP+.15,theirs.y*S);
    const sway=reducedMotion?0:drunk;
    this.camera.position.set(Math.sin(t*.73)*sway*.028,2.02+Math.sin(t*.91)*sway*.017,orientation*2.32);
    this.camera.lookAt(Math.sin(t*.51)*sway*.015,.76,-orientation*.1);
    this.camera.rotateZ(Math.sin(t*.59)*sway*.009);
    this.camera.updateMatrixWorld();
    this.player.group.position.set(0,.14,orientation*1.88);this.player.group.rotation.y=orientation>0?Math.PI:0;
    this.player.group.visible=ownSeat!==null;
    for(const arm of this.ownArms)arm.g.visible=ownSeat!==null;
    this._poseArm(this.ownArms[0],v(.33*orientation,1.18,1.84*orientation),v(.4*orientation+ours.x*S*.35,TOP+.16,1.55*orientation),ownHand,-orientation);
    this._poseArm(this.ownArms[1],v(-.34*orientation,1.14,1.85*orientation),v(-.62*orientation,TOP+.13,1.62*orientation),v(-.75*orientation,TOP+.1,1.39*orientation),-orientation);
    this.opponent.group.position.set(theirs.x*S*.35,.15,-orientation*1.86);
    this.opponent.group.rotation.y=orientation>0?0:Math.PI;
    this.opponent.drunk=.45;this.opponent.hype=excitement*.65+.12;
    this.opponent.setLook(v(state.puck.x*S,TOP,state.puck.y*S));this.opponent.update(dt,t);
    const enemyX=this.opponent.group.position.x;
    this._poseArm(this.opponentArms[0],v(enemyX-.28*orientation,1.16,-1.79*orientation),v(enemyX-.35*orientation,1.04,-1.55*orientation),enemyHand,orientation);
    this._poseArm(this.opponentArms[1],v(enemyX+.28*orientation,1.14,-1.79*orientation),v(enemyX+.52*orientation,1.05,-1.54*orientation),v(.72*orientation,TOP+.11,-1.39*orientation),orientation);
    state.mallets.forEach((m,i)=>this.mallets[i].position.set(m.x*S,TOP,m.y*S));
    this.puck.position.set(state.puck.x*S,TOP,state.puck.y*S);this.puck.visible=state.status==='playing';
    const score=state.score.join(':');if(score!==this.lastScore){this.lastScore=score;for(const p of this.goalPips)p.material.emissiveIntensity=state.score[p.userData.seat]>p.userData.point?2:0;}
    this.goalFlash=Math.max(0,this.goalFlash-dt*.7);
    for(let i=0;i<2;i++)this.goalLights[i].intensity=.7+(state.lastGoal===i?this.goalFlash*5:0);
    this.crowd.focus.set(state.puck.x*S,TOP,state.puck.y*S);this.crowd.setMood(.22+excitement*.3);this.crowd.update(t,dt);
    for(const thing of this.room.dyn)thing.update(t,dt,excitement*.7);
    this.room.lights.tableSpots.forEach(l=>l.intensity=2.1+excitement*.35);
    this.audio.drunk=drunk;this.audio.update(dt,Math.min(.8,this.crowd.globalHype*.55+.08));
    this.renderer.setDrunk(reducedMotion?0:drunk);
    this.renderer.render(dt,t,Math.min(.55,excitement*.4));
  }
}

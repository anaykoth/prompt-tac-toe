import * as THREE from 'three';
import { Renderer } from '../core/render.js';
import { Audio } from '../core/audio.js';
import { Puppet, defaultSpec } from '../world/puppet.js';
import { Crowd } from '../world/crowd.js';
import { FIELD, batPose } from './model.js';

const UP = new THREE.Vector3(0, 1, 0);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = THREE.MathUtils.clamp;
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .84, ...extra });
function add(parent, geometry, material, x = 0, y = 0, z = 0) {
  const item = new THREE.Mesh(geometry, material);
  item.position.set(x, y, z); item.castShadow = true; item.receiveShadow = true; parent.add(item);
  return item;
}
function box(parent, size, material, x, y, z) { return add(parent, new THREE.BoxGeometry(...size), material, x, y, z); }
function line(parent, points, color, opacity = 1) {
  const item = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
  parent.add(item); return item;
}
function segment(item, a, b) {
  item.position.copy(a).add(b).multiplyScalar(.5);
  item.scale.y = a.distanceTo(b);
  item.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
}
function texture(width, height, draw) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function boardTexture(title, subtitle, color = '#103c38') {
  return texture(1024, 256, (c,w,h) => {
    c.fillStyle=color; c.fillRect(0,0,w,h); c.strokeStyle='#d4c38a';c.lineWidth=5;c.strokeRect(13,13,w-26,h-26);
    c.fillStyle='#fff1bf';c.textAlign='center';c.font='900 92px Impact, sans-serif';c.fillText(title,w/2,126);
    c.fillStyle='#b9d4ba';c.font='600 27px monospace';c.fillText(subtitle,w/2,198);
  });
}
function clothTexture() {
  return texture(128,128,(c,w,h)=>{c.fillStyle='#9b9b9b';c.fillRect(0,0,w,h);for(let i=0;i<1600;i++){c.strokeStyle=i%2?'#777':'#bbb';const x=(i*71)%w,y=(i*43)%h;c.beginPath();c.moveTo(x,y);c.lineTo(x+3,y+2);c.stroke();}});
}

/** A seat inside Felt Field. All play geometry uses the engine's metres. */
export class BaseballScene {
  constructor(canvas) {
    this.canvas=canvas;this.scene=new THREE.Scene();
    this.camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.025,320);
    this.renderer=new Renderer(canvas,this.scene,this.camera);
    this.renderer.setStyle('daylight');
    this.renderer.renderer.toneMappingExposure=.92;
    this.renderer.bloom.strength=.12;this.renderer.bloom.radius=.35;this.renderer.bloom.threshold=2.5;
    this.scene.background=new THREE.Color(0x8fb6c0);
    this.scene.fog=new THREE.Fog(0x9fb9b6,115,255);
    this.audio=new Audio();this.audio.enabled=false;
    this.camera.position.set(-.62,1.72,2.4);this.camera.lookAt(0,1.2,-18.44);
    this.look=V(0,1.3,-18.44);this.camTarget=this.camera.position.clone();
    this.ray=new THREE.Raycaster();this.targetPlane=new THREE.Plane(V(0,0,1),0);this.intersection=V();
    this.players=new Map();this.runnerPuppets=new Map();this.trailPoints=[];
    this.reaction=0;this.lastPhase='';this.lastRole='';this.lastScore='';this.resultAge=0;
    this._lights();this._field();this._stadium();this._people();this._equipment();
    this.camera.updateMatrixWorld();
  }

  _lights() {
    this.scene.add(new THREE.HemisphereLight(0xc5e2e5,0x4a4830,1.7));
    this.scene.add(new THREE.AmbientLight(0xffd9a6,.22));
    const sun=this.sun=new THREE.DirectionalLight(0xffd5a0,2.1);
    sun.position.set(-45,68,20);sun.target.position.set(0,0,-20);sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-35,right:35,top:35,bottom:-35,near:.5,far:160});
    sun.shadow.normalBias=.035;sun.shadow.bias=-.0001;this.scene.add(sun,sun.target);
    // Warm late-afternoon ground, with the lamps already glowing overhead.
    for(const [x,z] of [[-42,-12],[42,-12],[-69,-65],[69,-65]]){
      const steel=mat(0x40534b),pole=add(this.scene,new THREE.CylinderGeometry(.25,.5,28,10),steel,x,14,z);
      const rack=box(this.scene,[6,1.8,.5],steel,x,27,z);rack.lookAt(0,20,-20);
      for(let i=0;i<5;i++){
        const lamp=add(rack,new THREE.CircleGeometry(.38,12),new THREE.MeshBasicMaterial({color:0xffe7ae}),-2.4+i*1.2,0,.3);
        lamp.castShadow=false;
      }
      pole.receiveShadow=false;
    }
    // A painted sky dome, not a screen-space illustration.
    const sky=add(this.scene,new THREE.SphereGeometry(240,24,16),new THREE.ShaderMaterial({
      side:THREE.BackSide,depthWrite:false,
      uniforms:{high:{value:new THREE.Color(0x70a9be)},low:{value:new THREE.Color(0xe6cbae)}},
      vertexShader:'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:'varying vec3 p;uniform vec3 high;uniform vec3 low;void main(){float h=clamp(normalize(p).y*1.8,0.,1.);gl_FragColor=vec4(mix(low,high,h),1.);}',
    }),0,0,-35);sky.castShadow=sky.receiveShadow=false;
  }

  _field() {
    const grassTex=texture(512,512,(c,w,h)=>{
      c.fillStyle='#628744';c.fillRect(0,0,w,h);
      for(let i=0;i<16000;i++){const x=(i*127)%w,y=(i*233)%h;c.fillStyle=i%3?'#436b373d':'#a0ae6d35';c.fillRect(x,y,1,4);}
    });grassTex.wrapS=grassTex.wrapT=THREE.RepeatWrapping;grassTex.repeat.set(24,24);
    const ground=add(this.scene,new THREE.PlaneGeometry(270,270),mat(0xacc594,{map:grassTex}),0,-.04,-45);ground.rotation.x=-Math.PI/2;ground.castShadow=false;
    // Alternating mowing stripes remain geometry in perspective.
    for(let i=0;i<12;i++){
      const strip=add(this.scene,new THREE.PlaneGeometry(160,7.5),mat(i%2?0x66864c:0x729357,{map:grassTex}),0,-.025,-i*7.5-5);
      strip.rotation.x=-Math.PI/2;strip.castShadow=false;
    }
    const dirtTex=texture(256,256,(c,w,h)=>{c.fillStyle='#b17b51';c.fillRect(0,0,w,h);for(let i=0;i<6000;i++){c.fillStyle=i%2?'#e3b58544':'#63492e44';c.fillRect((i*61)%w,(i*149)%h,2,1);}});
    dirtTex.wrapS=dirtTex.wrapT=THREE.RepeatWrapping;dirtTex.repeat.set(7,7);
    const dirt=mat(0xd6b98c,{map:dirtTex});
    const b=27.43/Math.sqrt(2),corners=[V(0,.012,0),V(b,.012,-b),V(0,.012,-2*b),V(-b,.012,-b)];
    for(let i=0;i<4;i++){
      const a=corners[i],to=corners[(i+1)%4],middle=a.clone().add(to).multiplyScalar(.5);
      const path=box(this.scene,[a.distanceTo(to),.035,3.15],dirt,middle.x,.0,middle.z);
      path.rotation.y=-Math.atan2(to.z-a.z,to.x-a.x);path.castShadow=false;
    }
    const infield=add(this.scene,new THREE.CircleGeometry(22.4,64),dirt,0,.001,-18.6);infield.rotation.x=-Math.PI/2;infield.castShadow=false;
    const diamond=add(this.scene,new THREE.PlaneGeometry(22.4,22.4),mat(0x638849),0,.018,-19.4);diamond.rotation.set(-Math.PI/2,0,Math.PI/4);diamond.castShadow=false;
    const plateDirt=add(this.scene,new THREE.CircleGeometry(4.2,48),dirt,0,.025,0);plateDirt.rotation.x=-Math.PI/2;plateDirt.castShadow=false;
    const mound=add(this.scene,new THREE.SphereGeometry(2.75,40,16),dirt,0,-.04,-18.44);mound.scale.set(1,.14,1);
    box(this.scene,[.61,.025,.15],mat(0xeee5cb),0,.36,-18.44);
    for(const [i,p] of corners.entries()){
      if(i===0)continue;
      const base=box(this.scene,[.46,.13,.46],mat(0xf6ead0),p.x,.09,p.z);base.rotation.y=Math.PI/4;
    }
    const plate=new THREE.Shape();plate.moveTo(-.216,-.216);plate.lineTo(.216,-.216);plate.lineTo(.216,.02);plate.lineTo(0,.216);plate.lineTo(-.216,.02);plate.closePath();
    const hp=add(this.scene,new THREE.ShapeGeometry(plate),mat(0xf7eed5),0,.055,0);hp.rotation.x=-Math.PI/2;hp.castShadow=false;
    const chalk=mat(0xf1e9c8);
    for(const side of[-1,1]){
      const a=V(side*.23,.048,0),end=V(side*77,.048,-77),mid=a.clone().add(end).multiplyScalar(.5);
      const foul=box(this.scene,[a.distanceTo(end),.012,.075],chalk,mid.x,mid.y,mid.z);foul.rotation.y=-Math.atan2(end.z-a.z,end.x-a.x);foul.castShadow=false;
      for(const x of[side*.54,side*1.46])box(this.scene,[.035,.012,1.8],chalk,x,.06,.0).castShadow=false;
      for(const z of[-.9,.9])box(this.scene,[.92,.012,.035],chalk,side, .06,z).castShadow=false;
    }
    // The batting eye is deliberately dark behind the pitcher: white ball contrast.
    box(this.scene,[28,11,1.5],mat(0x17342d),0,5.5,-98);
    for(const side of[-1,1]){
      const pole=add(this.scene,new THREE.CylinderGeometry(.16,.16,17,10),mat(0xe7b544),side*67.2,8.5,-67.2);
      pole.castShadow=false;
    }
  }

  _stadium() {
    const wall=mat(0x204d3e),brick=mat(0x714a38),steel=mat(0x32483e),bench=mat(0x8c7655);
    this.flags=[];
    for(let i=0;i<26;i++){
      const a=-Math.PI/4+(i+.5)/26*Math.PI/2,r=96;
      const panel=box(this.scene,[6.1,FIELD.fenceHeight,.55],wall,Math.sin(a)*r,FIELD.fenceHeight/2,-Math.cos(a)*r);panel.rotation.y=-a;
      const cap=box(this.scene,[6.2,.18,.8],mat(0xd4b05b),panel.position.x,FIELD.fenceHeight+.04,panel.position.z);cap.rotation.y=-a;
      if(i%4===0){const pole=add(this.scene,new THREE.CylinderGeometry(.05,.05,4,6),steel,panel.position.x,5.6,panel.position.z);const flag=add(pole,new THREE.PlaneGeometry(1.6,.8),new THREE.MeshStandardMaterial({color:i%3?0xe9aa49:0xd95843,side:THREE.DoubleSide}),.8,1.5,0);this.flags.push(flag);}
    }
    for(const side of[-1,1]){
      // Baseline bleachers: spectators stand on real stepped wooden terraces.
      const stand=new THREE.Group();stand.position.set(side*21,0,-16);stand.rotation.y=-side*Math.PI/4;this.scene.add(stand);
      for(let row=0;row<4;row++){
        box(stand,[1.1,.65+row*.7,39],brick,side*(row*1.1),(.65+row*.7)/2,0);
        box(stand,[.3,.15,38],bench,side*(row*1.1),.85+row*.7,0);
      }
      box(stand,[.1,2,39],steel,-side*1.7,1,0);
      for(let i=0;i<15;i++)box(stand,[.08,1.9,.08],steel,-side*1.7,.95,-18+i*2.6);
      const roof=box(stand,[8,.18,41],mat(0x335749),side*2,6,0);roof.rotation.z=side*.08;
      for(const z of[-18,-6,6,18])box(stand,[.18,5.8,.18],steel,side*4.7,2.9,z);
    }
    // Backstop surrounds the catcher without putting a mesh in the pitch lane.
    for(const side of[-1,1])for(let i=0;i<8;i++){
      const x=side*(3+i*1.2),z=3.8-i*.25;box(this.scene,[.055,5,.055],steel,x,2.5,z);
      for(let y=1;y<5;y++)line(this.scene,[V(x,y,z),V(x+side*1.2,y,z-.25)],0x576259,.35);
    }
    const scoreTex=this.scoreTexture=texture(1024,384,()=>{});
    this.scoreCanvas=scoreTex.image;this.scoreKey='';
    const scoreboard=add(this.scene,new THREE.PlaneGeometry(17,6.375),new THREE.MeshBasicMaterial({map:scoreTex}),-30,9,-94);scoreboard.rotation.y=.15;scoreboard.castShadow=false;
    for(const x of[-36,-24])box(this.scene,[.45,10,.45],steel,x,5,-95);
    const title=add(this.scene,new THREE.PlaneGeometry(18,4.5),new THREE.MeshBasicMaterial({map:boardTexture('FELT FIELD','HOME OF THE ABSOLUTELY UNQUALIFIED')}),22,7,-96);title.rotation.y=-.15;title.castShadow=false;
    for(const [title,sub,x] of [['NO SMALL DREAMS','JUST VERY SMALL GLOVES',-54],['BIG LEAGUE FEELINGS','LOCAL LEAGUE ABILITY',49]]){
      const sign=add(this.scene,new THREE.PlaneGeometry(17,4.25),new THREE.MeshBasicMaterial({map:boardTexture(title,sub,'#49382e')}),x,3,-77);sign.rotation.y=-Math.sign(x)*.5;sign.castShadow=false;
    }
    // Clubhouse and little streets extend the park beyond the fence.
    for(let i=0;i<14;i++){
      const x=-106+i*16,z=-127-Math.sin(i*2.1)*11,h=8+(i%4)*4;
      box(this.scene,[11,h,9],mat([0xb38761,0x71877a,0xbdad8b,0x697b81][i%4]),x,h/2,z);
      const roof=add(this.scene,new THREE.ConeGeometry(8,3,4),mat(0x564b41),x,h+1,z);roof.rotation.y=Math.PI/4;
      for(let j=0;j<3;j++)box(this.scene,[1.4,2,.03],mat(0xeac481),x-3+j*3,h*.65,z+4.52);
    }
  }

  _makePlayer(name,fur,accent,height=1.9) {
    const p=new Puppet({...defaultSpec(name),fur,accent,height,hairStyle:'tufts',accessory:'cap',build:'average'});
    this.scene.add(p.group);p.crazy=.2;
    // Baseball jersey and contrasting belt make the cast read as a team.
    p.body.material=mat(accent,{bumpMap:clothTexture(),bumpScale:.05});
    return p;
  }

  _people() {
    this.pitcher=this._makePlayer('MANNY THE LEFTY','#ea8a43','#284c5b',2.0);
    this.pitcher.group.position.set(0,.3,-18.44);this.pitcher.setLook(V(0,1,0));
    this.batter=this._makePlayer('THE LOCAL','#b87acf','#e9d8ae',1.9);
    this.batter.group.position.set(-.95,0,.1);this.batter.group.rotation.y=-Math.PI/2;
    this.batter.arms.forEach(a=>a.shoulder.visible=false);
    this.catcher=this._makePlayer('CLIVE','#4fc5aa','#2f4f60',1.55);
    this.catcher.group.position.set(0,-.28,1.7);this.catcher.group.rotation.y=Math.PI;
    const mask=new THREE.Group();this.catcher.headPivot.add(mask);
    for(let y=0;y<4;y++)box(mask,[.48,.016,.025],mat(0x263d3f),0,-.02+y*.08,.24);
    for(const x of[-.19,0,.19])box(mask,[.016,.3,.025],mat(0x263d3f),x,.1,.24);
    const glove=add(this.catcher.group,new THREE.SphereGeometry(.24,16,12),mat(0x996131),0,1.0,-.3);glove.scale.z=.4;this.catchGlove=glove;
    this.ump=this._makePlayer('THE UMP','#d8aa46','#34393b',1.9);this.ump.group.position.set(.15,0,2.65);this.ump.group.rotation.y=Math.PI;
    const seats=[];
    for(const side of[-1,1])for(let row=0;row<4;row++)for(let i=0;i<18;i++){
      const localX=side*row*1.1,localZ=-17+i*2;
      const angle=-side*Math.PI/4;
      seats.push({pos:V(side*21+localX*Math.cos(angle)+localZ*Math.sin(angle),.65+row*.7,-16-localX*Math.sin(angle)+localZ*Math.cos(angle)),sit:false,side,rank:row});
    }
    for(let row=0;row<2;row++)for(let i=0;i<48;i++){
      const a=-.78+i/47*1.56,r=102+row*2.2;
      if(Math.abs(a)<.13)continue; // keep the batting eye clear
      seats.push({pos:V(Math.sin(a)*r,2+row*1.2,-Math.cos(a)*r),sit:false,side:Math.sign(a),rank:row});
    }
    this.crowd=new Crowd(this.scene,seats,{focus:V(0,1,-8),scale:1.48,mugs:.17});
    this.crowd.signs.forEach(s=>s.g.visible=false);this.crowd.setMood(.18);
    let spec=defaultSpec();try{spec={...spec,...JSON.parse(localStorage.getItem('splinter-alley.puppet')||'{}')}}catch{}
    this.furMat=mat(spec.fur,{bumpMap:clothTexture(),bumpScale:.07});
    this.ownArms=[this._arm(this.furMat),this._arm(this.furMat)];
    this.enemyArms=[this._arm(this.batter.mats[0]),this._arm(this.batter.mats[0])];
    this.throwArm=this._arm(this.furMat);
  }

  _arm(material) {
    const g=new THREE.Group();this.scene.add(g);
    const upper=add(g,new THREE.CylinderGeometry(.065,.083,1,10),material);
    const lower=add(g,new THREE.CylinderGeometry(.052,.067,1,10),material);
    const shoulderJoint=add(g,new THREE.SphereGeometry(.084,12,10),material);
    const elbowJoint=add(g,new THREE.SphereGeometry(.069,12,10),material);
    const hand=add(g,new THREE.SphereGeometry(.09,14,10),material);hand.scale.set(1,.78,.8);
    const fingers=[];
    for(let i=0;i<3;i++)fingers.push(add(g,new THREE.CapsuleGeometry(.024,.07,3,7),material));
    const thumb=add(g,new THREE.CapsuleGeometry(.028,.055,3,7),material);
    return {g,upper,lower,shoulderJoint,elbowJoint,hand,fingers,thumb};
  }
  _poseArm(a,shoulder,elbow,hand,direction=V(1,0,0)) {
    segment(a.upper,shoulder,elbow);segment(a.lower,elbow,hand);a.hand.position.copy(hand);
    a.shoulderJoint.position.copy(shoulder);a.elbowJoint.position.copy(elbow);
    a.fingers.forEach((f,i)=>{f.position.copy(hand).add(V((i-1)*.038,-.035,.035));f.quaternion.setFromUnitVectors(UP,direction.clone().normalize());});
    a.thumb.position.copy(hand).add(V(.075,.015,-.015));a.thumb.rotation.z=.8;
  }

  _equipment() {
    const points=[[.032,0],[.04,.025],[.027,.05],[.025,.3],[.045,.45],[FIELD.batRadius,.55],[FIELD.batRadius,.95],[.04,1]].map(([r,y])=>new THREE.Vector2(r,y-.5));
    const wood=texture(256,512,(c,w,h)=>{c.fillStyle='#cba66d';c.fillRect(0,0,w,h);for(let i=0;i<38;i++){c.strokeStyle=i%2?'#6f492a45':'#f2cd9545';c.lineWidth=1;c.beginPath();c.moveTo(i*7,0);c.bezierCurveTo(i*7+12,150,i*7-8,300,i*7,512);c.stroke();}});
    this.bat=add(this.scene,new THREE.LatheGeometry(points,18),mat(0xefcf9b,{map:wood,roughness:.46}));
    this.grip=add(this.scene,new THREE.CylinderGeometry(.029,.03,1,12),mat(0x273d3b));
    this.ball=new THREE.Group();this.scene.add(this.ball);
    const leather=texture(256,128,(c,w,h)=>{c.fillStyle='#fff7dd';c.fillRect(0,0,w,h);c.strokeStyle='#bc3e30';c.lineWidth=3;for(const off of[.25,.75]){c.beginPath();for(let y=0;y<=h;y++){const x=w*off+Math.sin(y/h*Math.PI*2)*24;y?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();for(let y=4;y<h;y+=9){const x=w*off+Math.sin(y/h*Math.PI*2)*24;c.beginPath();c.moveTo(x-5,y-2);c.lineTo(x+5,y+2);c.stroke();}}});
    const sphere=add(this.ball,new THREE.SphereGeometry(FIELD.ballRadius,24,16),mat(0xffffff,{map:leather,roughness:.55,emissive:0x766a47,emissiveIntensity:.08}));
    sphere.castShadow=true;
    add(this.ball,new THREE.SphereGeometry(FIELD.ballRadius+.003,16,12),new THREE.MeshBasicMaterial({color:0x29392d,side:THREE.BackSide}));
    this.ballShadow=add(this.scene,new THREE.CircleGeometry(.12,20),new THREE.MeshBasicMaterial({color:0x152a20,transparent:true,opacity:.35,depthWrite:false}),0,.065,0);this.ballShadow.rotation.x=-Math.PI/2;this.ballShadow.castShadow=false;
    this.trail=line(this.scene,[V(),V()],0xffefd0,.55);this.trail.frustumCulled=false;
    const zonePoints=[V(-.42,.5,0),V(.42,.5,0),V(.42,1.7,0),V(-.42,1.7,0),V(-.42,.5,0)];
    this.zone=line(this.scene,zonePoints,0xffe8a0,.26);
    this.target=new THREE.Group();this.scene.add(this.target);
    const ring=add(this.target,new THREE.RingGeometry(.105,.12,40),new THREE.MeshBasicMaterial({color:0xffd679,transparent:true,opacity:.85,side:THREE.DoubleSide,depthWrite:false}));ring.castShadow=false;
    line(this.target,[V(-.16,0,0),V(-.06,0,0)],0xffd679,.8);line(this.target,[V(.06,0,0),V(.16,0,0)],0xffd679,.8);
    line(this.target,[V(0,-.16,0),V(0,-.06,0)],0xffd679,.8);line(this.target,[V(0,.06,0),V(0,.16,0)],0xffd679,.8);
    this.target.position.set(0,1.1,.04);
  }

  enableSound(enabled=true){this.audio.enabled=enabled;if(enabled){this.audio.init();this.audio.resume();}}
  react(kind,power=1) {
    if(['hit','contact','crack'].includes(kind)){this.audio.cueStrike(3+power*3);this.audio.ballClick(4);this.crowd.react(.5+power*.3,.2);this.reaction=.25;}
    else if(['homerun','home-run','run','score','win'].includes(kind)){this.crowd.react(1.7,.2);this.audio.roar(1.4);this.audio.bell();this.crowd.burstConfetti(340,V(0,4,0));this.reaction=1;}
    else if(['strike','out','catch'].includes(kind)){this.audio.thud(.5);this.crowd.react(.4,.3);}
    else if(kind==='pitch'){this.audio.whoosh?.(.5);}
  }
  targetAt(clientX,clientY) {
    const rect=this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1),this.camera);
    if(!this.ray.ray.intersectPlane(this.targetPlane,this.intersection))return null;
    return {x:clamp(this.intersection.x,-1.1,1.1),y:clamp(this.intersection.y,.2,2.3)};
  }

  _score(state) {
    const key=[state.inning,state.half,...(state.score??[0,0]),state.counts?.outs].join(':');if(key===this.scoreKey)return;this.scoreKey=key;
    const c=this.scoreCanvas.getContext('2d');c.fillStyle='#12362b';c.fillRect(0,0,1024,384);c.strokeStyle='#b0a875';c.lineWidth=7;c.strokeRect(12,12,1000,360);
    c.textAlign='center';c.fillStyle='#e9dba9';c.font='700 56px monospace';c.fillText('FELT FIELD',512,82);
    c.font='700 39px monospace';c.fillText('LOCALS                 VISITORS',512,155);
    c.fillStyle='#f7bf65';c.font='700 108px monospace';c.fillText(String(state.score?.[0]??0),270,269);c.fillText(String(state.score?.[1]??0),760,269);
    c.fillStyle='#c7d2b8';c.font='26px monospace';c.fillText(`INNING ${state.inning??1}   ${(state.half??'top').toUpperCase()}   ${state.counts?.outs??0} OUT`,512,334);this.scoreTexture.needsUpdate=true;
  }

  _updatePlayers(dt,t,state,excitement) {
    const ball=state.ball??{x:0,y:1,z:0};const focus=V(ball.x,ball.y,ball.z);
    const wideView=state.phase==='inplay'||(['result','finished'].includes(state.phase)&&ball.z< -6);
    const pitchU=state.phase==='pitch'?clamp((state.pitch?.elapsed??0)/.65,0,1):0;
    this.pitcher.group.visible=state.role!=='pitching'||wideView;
    this.pitcher.hype=excitement*.3;this.pitcher.update(dt,t);
    // An unmistakable overarm release, followed by a bent-knee recovery.
    const wind=state.phase==='ready'?.5+.5*Math.sin(t*2.4):0;
    this.pitcher.throwArm.shoulder.rotation.x=state.phase==='pitch'?-2.4+pitchU*2.6:-.6-wind*1.6;
    this.pitcher.throwArm.elbow.rotation.x=state.phase==='pitch'?-1.5*(1-pitchU):-.9;
    this.pitcher.legs[0].hip.rotation.x=state.phase==='ready'?-.5*wind:0;
    this.pitcher.root.rotation.x=state.phase==='pitch'?.24*Math.sin(pitchU*Math.PI):0;
    this.batter.group.visible=state.role==='pitching'||wideView;
    this.batter.setLook(focus);this.batter.update(dt,t);this.catcher.setLook(focus);this.catcher.update(dt,t);this.ump.update(dt,t);
    // First-person camera sits just behind the batter's eye; hide the catcher
    // and umpire that would otherwise clip through that tight camera position.
    this.catcher.group.visible=this.ump.group.visible=state.role==='pitching'||wideView;
    this.catchGlove.position.x=clamp(ball.x,-.4,.4);this.catchGlove.position.y=clamp(ball.y,.65,1.4);
    const known=new Set();
    for(const [i,f] of (state.fielders??[]).entries()){
      if(f.id==='pitcher'){
        if(state.phase==='inplay'||state.phase==='result'){
          const old=this.pitcher.group.position.clone();this.pitcher.group.position.set(f.x,Math.hypot(f.x,f.z+18.44)<2?.3:0,f.z);
          const d=this.pitcher.group.position.clone().sub(old);this.pitcher.speed=Math.min(1,d.length()/Math.max(dt,.001)/5);
          if(d.length()>.005)this.pitcher.group.rotation.y=Math.atan2(d.x,d.z);
        }else{this.pitcher.group.position.set(0,.3,-18.44);this.pitcher.group.rotation.y=0;this.pitcher.speed=0;}
        continue;
      }
      const key=f.id??i;known.add(key);let p=this.players.get(key);
      if(!p){p=this._makePlayer(String(key),['#6acaa8','#e5ab46','#a883d6','#e38a70'][i%4],'#e4d8b5',1.85);this.players.set(key,p);const glove=add(p.group,new THREE.SphereGeometry(.19,12,10),mat(0x956332),-.35,1,.15);glove.scale.z=.6;}
      const prev=p.group.position.clone();p.group.position.set(f.x,f.y??0,f.z);
      const dx=f.x-prev.x,dz=f.z-prev.z;p.speed=Math.min(1,Math.hypot(dx,dz)/Math.max(dt,.001)/5);
      if(Math.hypot(dx,dz)>.005)p.group.rotation.y=Math.atan2(dx,dz);
      else p.group.rotation.y=Math.atan2(ball.x-f.x,ball.z-f.z);
      p.setLook(focus);p.hype=excitement*.2;p.update(dt,t);p.group.visible=true;
    }
    for(const [key,p]of this.players)p.group.visible=known.has(key);
    const runners=new Set();
    for(const [i,r]of (state.runners??[]).entries()){
      const key=r.id??i;runners.add(key);let p=this.runnerPuppets.get(key);
      if(!p){p=this._makePlayer('RUNNER','#77d276','#bb6a46',1.8);this.runnerPuppets.set(key,p);}
      const old=p.group.position.clone();p.group.position.set(r.x,r.y??0,r.z);const d=p.group.position.clone().sub(old);
      if(d.length()>.005)p.group.rotation.y=Math.atan2(d.x,d.z);p.speed=1;p.update(dt,t);p.group.visible=true;
    }
    for(const[key,p]of this.runnerPuppets)p.group.visible=runners.has(key);
  }

  _poseBat(state, delivery = null) {
    const pose=batPose(state);if(!pose?.handle||!pose?.tip)return;
    const a=V(pose.handle.x,pose.handle.y,pose.handle.z),b=V(pose.tip.x,pose.tip.y,pose.tip.z),direction=b.clone().sub(a).normalize();
    segment(this.bat,a,b);const gripEnd=a.clone().addScaledVector(direction,.24);segment(this.grip,a,gripEnd);
    const following=state.role==='batting'&&state.bat.control==='direct'&&state.phase==='inplay'&&this.resultAge<.3;
    const batting=state.role!=='pitching',playing=!following&&(state.phase==='inplay'||(['result','finished'].includes(state.phase)&&state.ball.z< -6));
    const own=batting&&!playing;
    const left=a.clone().addScaledVector(direction,.075),right=a.clone().addScaledVector(direction,.19);
    this.bat.visible=this.grip.visible=!playing||this.resultAge<.5;
    for(const arm of this.ownArms)arm.g.visible=own;
    for(const arm of this.enemyArms)arm.g.visible=!own&&this.bat.visible;
    if(own){
      // Shoulders are behind the eye and elbows below its frustum. The forearms
      // enter naturally through the lower edge instead of ending in mid-air.
      this._poseArm(this.ownArms[0],V(-1.05,.8,2.8),V(-1.03,.85,1.15),left,direction);
      this._poseArm(this.ownArms[1],V(-.15,.78,2.75),V(-.15,.86,1.22),right,direction);
    }else{
      // Third-person arms attach to the animated torso's actual shoulder pivots.
      this.batter.group.updateMatrixWorld(true);
      for(const [i,hand]of [left,right].entries()){
        const shoulder=this.batter.arms[i].shoulder.getWorldPosition(V());
        const elbow=shoulder.clone().lerp(hand,.5).add(V(-.2,-.22,.1));
        this._poseArm(this.enemyArms[i],shoulder,elbow,hand,direction);
      }
    }
    this.throwArm.g.visible=!batting&&!playing;
    if(this.throwArm.g.visible){
      const u=state.phase==='pitch'?clamp((state.pitch?.elapsed??0)/.45,0,1):0;
      const wind=delivery?.active?clamp((delivery.back-delivery.forward*.7)/90,0,1):0;
      const hand=state.phase==='pitch'?V(-u*.4,1.85-Math.sin(u*Math.PI)*.4,-18.44+u*.9):V(.42+wind*.18,1.35+wind*.45,-17.7-wind*1.2);
      this.heldBallPosition=hand.clone().add(V(-.02,.08,.06));
      this._poseArm(this.throwArm,V(.34,1.35,-19.05),V(.6,1.1+u*.45,-18.5),hand,V(0,0,1));
    }
  }

  update(dt,t,state,options={}) {
    if(!state)return;
    const {drunk=0,excitement=0,aim=null,reducedMotion=false}=options;
    const ball=state.ball??{x:0,y:1,z:-18.44,visible:false};
    const play=state.phase==='inplay',result=state.phase==='result'||state.phase==='finished';
    if(play||result)this.resultAge+=dt;else this.resultAge=0;
    if(this.lastPhase!==state.phase){
      if(state.phase==='pitch'){this.trailPoints.length=0;this.react('pitch');}
      if(play){this.trailPoints.length=0;this.react('hit',.8);}
      if(result){const outcome=state.feedback?.outcome??'';if(/home.?run/i.test(outcome))this.react('homerun');else if(/out|caught/i.test(outcome))this.react('out');}
      this.lastPhase=state.phase;
    }
    this._score(state);this._updatePlayers(dt,t,state,excitement);this._poseBat(state,options.delivery);
    this.ball.visible=ball.visible!==false;this.ball.position.set(ball.x,ball.y,ball.z);this.ball.rotation.x+=dt*12;this.ball.rotation.z+=dt*7;
    if(state.role==='pitching'&&state.phase==='ready'&&this.heldBallPosition){this.ball.visible=true;this.ball.position.copy(this.heldBallPosition);}
    this.ballShadow.visible=this.ball.visible;this.ballShadow.position.set(ball.x,.07,ball.z);this.ballShadow.material.opacity=.3/(1+Math.max(0,ball.y)*.1);this.ballShadow.scale.setScalar(1+Math.min(10,ball.y)*.1);
    if(this.ball.visible&&(state.phase==='pitch'||play)){
      this.trailPoints.push(V(ball.x,ball.y,ball.z));if(this.trailPoints.length>(play?25:9))this.trailPoints.shift();
      this.trail.geometry.dispose();this.trail.geometry=new THREE.BufferGeometry().setFromPoints(this.trailPoints);
    }
    this.trail.visible=this.ball.visible&&(play||state.phase==='pitch')&&this.trailPoints.length>1;
    const role=state.role==='pitching'?'pitching':'batting';
    const following=play&&role==='batting'&&state.bat.control==='direct'&&this.resultAge<.3;
    if((play&&!following)||(result&&this.resultAge>0&&ball.z< -6)){
      const x=clamp(ball.x,-80,80),z=clamp(ball.z,-105,4);
      this.camTarget.set(x*.26-10,clamp(15+ball.y*.35,15,36),Math.max(9,z*.1+16));
      this.look.set(x*.7,Math.max(1,ball.y*.62),Math.min(-10,z*.75));
      this.camera.fov=65;
    }else if(role==='pitching'){
      this.camTarget.set(.2,1.92,-19.35);this.look.set(0,1.05,.4);this.camera.fov=48;
    }else{
      this.camTarget.set(-.62,1.72,2.4);this.look.set(0,1.2,-18.44);this.camera.fov=62;
    }
    const snap=this.lastRole!==role;this.lastRole=role;
    this.camera.position.lerp(this.camTarget,snap?1:1-Math.exp(-dt*(play?2.1:7)));
    const wobble=reducedMotion?0:Math.min(.5,drunk)*.012;
    this.camera.position.x+=Math.sin(t*.8)*wobble;this.camera.lookAt(this.look);this.camera.rotateZ(Math.sin(t*.65)*wobble*.3);
    this.camera.updateProjectionMatrix();this.camera.updateMatrixWorld();
    this.zone.visible=!play&&!result&&options.showZone!==false;
    this.target.visible=!play&&!result&&options.showAim!==false;
    const tx=aim?.x??state.bat?.x??state.pitch?.targetX??0,ty=aim?.y??state.bat?.y??state.pitch?.targetY??1.1;
    this.target.position.set(clamp(tx,-1.1,1.1),clamp(ty,.2,2.3),role==='pitching'?-.025:.025);
    this.reaction=Math.max(0,this.reaction-dt*.35);
    this.crowd.focus.set(ball.x,Math.min(4,ball.y),ball.z);this.crowd.setMood(.18+excitement*.25+this.reaction*.2);this.crowd.setDrunk(drunk);this.crowd.update(t,dt);
    for(const [i,flag]of this.flags.entries())flag.rotation.y=Math.sin(t*2+i)*.22;
    this.audio.update(dt,Math.min(.8,this.crowd.globalHype*.45+.08));
    this.renderer.setDrunk(reducedMotion?0:drunk*.25);this.renderer.render(dt,t,Math.min(.4,excitement*.3));
  }

  dispose() {
    this.crowd?.dispose();
    this.scene.traverse(o=>{if(o.isMesh||o.isLine){o.geometry?.dispose();const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){m?.map?.dispose();m?.dispose();}}});
    this.audio.ctx?.close();this.renderer.composer?.dispose();this.renderer.renderer.dispose();
  }
}

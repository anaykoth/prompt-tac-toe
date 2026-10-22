import * as THREE from 'three';
import { Puppet, defaultSpec, FUR } from '../world/puppet.js';

const clamp = THREE.MathUtils.clamp;
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
export const LOCALS = [
  { id: 'npc-pierre', name: 'Pierre', x: -4, y: 0.5, coins: 250 },
  { id: 'npc-dot', name: 'Dot', x: -1.8, y: -2, coins: 250 },
  { id: 'npc-basil', name: 'Basil', x: 1.3, y: -2.3, coins: 250 },
  { id: 'npc-nell', name: 'Nell', x: 4, y: 0.8, coins: 250 },
];
export const TABLES = [
  { id: 'pool', name: 'The Pool Table', x: -3.5, y: -.25, action: 'TRY THE CONTROLS', href: '/pool.html', copy: 'Classic feel, or a new stroke that makes contact count.' },
  { id: 'hockey', name: 'The Air Hockey Table', x: 3.8, y: .25, action: 'TAKE THE TABLE', href: '/air-hockey.html', copy: 'Soft hands. Fast puck. First to seven.' },
];

export class PubScene {
  constructor(canvas, labels) {
    this.canvas = canvas;
    this.labels = labels;
    this.actors = new Map();
    this.keys = new Set();
    this.target = null;
    this.active = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0e251f');
    this.scene.fog = new THREE.Fog('#0e251f', 23, 48);
    this.camera = new THREE.PerspectiveCamera(44, innerWidth / innerHeight, .1, 70);
    this.camera.position.set(1.2, 12.5, 15.5);
    this.camera.lookAt(0, 0, -.7);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.scene.add(new THREE.HemisphereLight('#d9edce', '#362519', 2.2));
    const sun = new THREE.DirectionalLight('#fff1cc', 3.1);
    sun.position.set(-4, 10, 5); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 30 });
    sun.shadow.bias = -.001;
    this.scene.add(sun);
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._makeRoom();
    this.resize = () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.position.y = innerWidth < 750 ? 16 : 12.5;
      this.camera.position.z = innerWidth < 750 ? 21 : 15.5;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    };
    addEventListener('resize', this.resize);
    this.resize();
    this.setCharacters(LOCALS, null);
  }

  box(w, h, d, color, x, y, z, opts = {}) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: .85, ...opts });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m); return m;
  }

  textSign(text, subtitle, x, y, z, w = 4.4) {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#143a2d'; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#d6b778'; g.lineWidth = 6; g.strokeRect(13, 13, 998, 230);
    g.textAlign = 'center'; g.fillStyle = '#e8d9ad'; g.font = 'bold 62px Georgia';
    g.fillText(text, 512, 118); g.font = '24px monospace'; g.fillText(subtitle, 512, 183);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), roughness: 1 }));
    m.position.set(x, y, z); this.scene.add(m);
  }

  _makeRoom() {
    this.box(16, .35, 11, '#322b22', 0, -.2, 0);
    for (let i = 0; i < 32; i++) {
      const colors = ['#7a5d3a', '#6f5232', '#816340', '#735534'];
      this.box(.49, .05, 10.5, colors[i % 4], -7.75 + i * .5, .005, 0);
    }
    this.box(16, 3.5, .22, '#294a3d', 0, 1.75, -5.3);
    this.box(.2, 2.6, 10.6, '#294a3d', -8, 1.3, 0);
    this.box(.2, 1, 10.6, '#294a3d', 8, .5, 0);
    for (const x of [-7.8, -4.5, 0, 4.5, 7.8]) this.box(.12, 3.65, .28, '#b09359', x, 1.8, -5.12);
    this.box(16, .09, .3, '#a78b53', 0, 1.05, -5.1);
    this.textSign('THE FUZZ & FEATHER', 'GOOD HANDS. QUESTIONABLE COMPANY.', 0, 2.55, -5.11, 6);
    // The bar is a real object in the room, but leaves the entire central aisle open.
    this.box(5.5, 1, .9, '#412f22', .1, .5, -4.1);
    this.box(5.7, .13, 1.1, '#ac7946', .1, 1.05, -4.1);
    for (let i = 0; i < 12; i++) {
      const x = -2.3 + i * .43;
      this.box(.14, .3 + (i % 3) * .04, .14, ['#68935e','#9c6536','#607d77'][i % 3], x, 1.28, -4.3, { roughness: .25, metalness: .1 });
    }
    for (const x of [-1.9, -.6, .7, 2]) {
      this.box(.12, .65, .12, '#202b25', x, .32, -3.2);
      this.box(.5, .12, .5, '#783b31', x, .7, -3.2);
    }
    this.box(4.4, .035, 3.9, '#4b3026', 0, .06, 1);
    for (const x of [-2.1, 2.1]) this.box(.07, .01, 3.75, '#b49152', x, .085, 1);
    for (const z of [-.8, 2.8]) this.box(4.2, .01, .07, '#b49152', 0, .085, z);
    this._poolTable(-4, -1.5);
    this._hockeyTable(4, -1.4);
    this.textSign('POOL', 'CLASSIC / CONTACT', -4.8, 2.2, -5.09, 2.1);
    this.textSign('AIR HOCKEY', 'SOFT HANDS. FAST PUCK.', 4.8, 2.2, -5.09, 2.1);
    const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({length:41}, (_,i) => new THREE.Vector3(-7.5+i*.375, 3.8-.6*Math.sin(i/40*Math.PI),-2.2))), new THREE.LineBasicMaterial({color:'#302d23'}));
    this.scene.add(wire);
    for (let i = 0; i < 20; i++) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(.055, 8, 8), new THREE.MeshBasicMaterial({color: i%3 ? '#ffdc80' : '#d0e49c'}));
      bulb.position.set(-7.1+i*.75,3.8-.6*Math.sin((i+.5)/20*Math.PI),-2.2); this.scene.add(bulb);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(.25,.29,40), new THREE.MeshBasicMaterial({color:'#eed49a',side:THREE.DoubleSide,transparent:true,opacity:.85}));
    ring.rotation.x=-Math.PI/2; ring.position.y=.1; ring.visible=false; this.scene.add(ring); this.destinationRing=ring;
    this.obstacles = [
      {x:-4,z:-1.5,w:2.65,d:1.75}, {x:4,z:-1.4,w:2.2,d:2},
      {x:.1,z:-4.1,w:5.8,d:1.25},
    ];
  }

  _poolTable(x, z) {
    this.box(2.8,.35,1.7,'#513724',x,.8,z);
    this.box(2.55,.08,1.45,'#25744e',x,1.02,z);
    for(const side of [-1,1]) {
      this.box(2.8,.13,.13,'#9f7344',x,1.08,z+side*.8);
      this.box(.13,.13,1.6,'#9f7344',x+side*1.34,1.08,z);
      for(const end of [-1,1])this.box(.14,.65,.14,'#34271b',x+side*1.1,.35,z+end*.55);
    }
    const colors=['#f2d151','#fff3d6','#d75e3a','#569ac7','#7b5ca0','#151b19'];
    for(let i=0;i<6;i++) {
      const ball=new THREE.Mesh(new THREE.SphereGeometry(.055,12,10),new THREE.MeshStandardMaterial({color:colors[i],roughness:.25}));
      ball.position.set(x-.75+(i%3)*.6,1.12,z-.3+Math.floor(i/3)*.5);this.scene.add(ball);
    }
  }

  _hockeyTable(x,z) {
    this.box(2.3,.4,1.9,'#354c49',x,.8,z); this.box(2.15,.08,1.75,'#b3d4cb',x,1.05,z);
    this.box(.025,.012,1.7,'#437f7e',x,1.099,z);
    for(const side of [-1,1]){
      this.box(2.3,.16,.1,'#92c8bc',x,1.12,z+side*.88);
      this.box(.1,.16,1.8,'#92c8bc',x+side*1.1,1.12,z);
      this.box(.3,.65,1.25,'#253731',x+side*.8,.35,z);
      const mallet=new THREE.Mesh(new THREE.CylinderGeometry(.13,.15,.1,20),new THREE.MeshStandardMaterial({color:side<0?'#d9774e':'#f4d77e'}));
      mallet.position.set(x+side*.7,1.16,z);this.scene.add(mallet);
    }
    const puck=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,.035,20),new THREE.MeshStandardMaterial({color:'#1b3431'}));puck.position.set(x,1.12,z+.22);this.scene.add(puck);
  }

  setCharacters(characters, selfId) {
    this.selfId = selfId;
    const present = new Set();
    for (const ch of characters) {
      if (ch.online === false) continue;
      present.add(ch.id);
      let actor = this.actors.get(ch.id);
      if (!actor) {
        const n=hash(ch.id), npc=ch.id.startsWith('npc-');
        const spec={...defaultSpec(ch.name),fur:FUR[n%FUR.length],hair:['#ffe14a','#ff7a1a','#f4f1e6','#c86bff'][n%4],hairStyle:['tufts','mohawk','shaggy','antennae'][n%4],accessory:['cap','bowtie','scarf','beanie'][n%4],build:['round','average','lanky','gremlin'][n%4],height:1.25+(n%4)*.1};
        const puppet = new Puppet(spec); puppet.group.userData.actorId=ch.id;
        puppet.group.position.set(ch.x??0,0,ch.y??ch.z??3.2); this.scene.add(puppet.group);
        const label=document.createElement('div');label.className='name-label';
        const name=document.createElement('span'), sub=document.createElement('small');label.append(name,sub);this.labels.append(label);
        actor={puppet,label,name,sub,data:ch,npc,target:new THREE.Vector3(ch.x??0,0,ch.y??ch.z??3.2)};this.actors.set(ch.id,actor);
      }
      actor.data=ch;actor.name.textContent=ch.name;actor.sub.textContent=ch.id===selfId?'YOU':actor.npc?'UP FOR A WAGER':(ch.activity==='air-hockey'?'AT AIR HOCKEY':'A FELLOW MUPPET');
      actor.label.classList.toggle('self',ch.id===selfId);
      actor.target.set(ch.x??0,0,ch.y??ch.z??3.2);
      if(ch.id===selfId && actor.puppet.group.position.distanceTo(actor.target)>1.2) actor.puppet.group.position.copy(actor.target);
    }
    for(const [id,a] of this.actors)if(!present.has(id)){this.scene.remove(a.puppet.group);a.puppet.dispose();a.label.remove();this.actors.delete(id);}
  }

  get position() { return this.actors.get(this.selfId)?.puppet.group.position; }
  get yaw() { return this.actors.get(this.selfId)?.puppet.group.rotation.y ?? 0; }
  moveTo(point) { this.target = { x:clamp(point.x,-7,7),z:clamp(point.z,-4.5,4.5) };this.destinationRing.position.set(this.target.x,.1,this.target.z);this.destinationRing.visible=true; }
  stop() { this.keys.clear();this.target=null;this.destinationRing.visible=false; }

  pick(event) {
    const rect=this.canvas.getBoundingClientRect();
    this.ndc.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    this.ray.setFromCamera(this.ndc,this.camera);
    const hits=this.ray.intersectObjects([...this.actors.values()].map(a=>a.puppet.group),true);
    for(const hit of hits){let o=hit.object;while(o&&!o.userData.actorId)o=o.parent;if(o?.userData.actorId&&o.userData.actorId!==this.selfId)return {actorId:o.userData.actorId};}
    const point=new THREE.Vector3();
    if(this.ray.ray.intersectPlane(this.groundPlane,point))return {point};
    return null;
  }

  _walkable(x,z) {return !this.obstacles.some(o=>Math.abs(x-o.x)<o.w/2+.18 && Math.abs(z-o.z)<o.d/2+.18);}

  frame(dt,t) {
    const me=this.actors.get(this.selfId);
    if(me&&this.active){
      const p=me.puppet.group.position;
      let dx=(this.keys.has('d')||this.keys.has('arrowright')?1:0)-(this.keys.has('a')||this.keys.has('arrowleft')?1:0);
      let dz=(this.keys.has('s')||this.keys.has('arrowdown')?1:0)-(this.keys.has('w')||this.keys.has('arrowup')?1:0);
      if(dx||dz){this.target=null;this.destinationRing.visible=false;}
      else if(this.target){dx=this.target.x-p.x;dz=this.target.z-p.z;if(Math.hypot(dx,dz)<.12){this.target=null;this.destinationRing.visible=false;dx=dz=0;}}
      const length=Math.hypot(dx,dz);me.puppet.speed=length?1:0;
      if(length){dx=dx/length*2.7*dt;dz=dz/length*2.7*dt;const x=clamp(p.x+dx,-7,7),z=clamp(p.z+dz,-4.5,4.5);if(this._walkable(x,p.z))p.x=x;if(this._walkable(p.x,z))p.z=z;me.puppet.group.rotation.y=Math.atan2(dx,dz);}
    }else if(me)me.puppet.speed=0;
    for(const [id,a]of this.actors){
      const p=a.puppet.group.position;
      if(id!==this.selfId){const distance=p.distanceTo(a.target);a.puppet.speed=distance>.06?Math.min(1,distance*3):0;if(distance>.06)a.puppet.group.rotation.y=Math.atan2(a.target.x-p.x,a.target.z-p.z);p.lerp(a.target,Math.min(1,dt*12));}
      if(a.npc){a.puppet.group.rotation.y=Math.sin(t*.11+hash(id))*.2;if(me)a.puppet.setLook(me.puppet.group.position.clone().add(new THREE.Vector3(0,1.2,0)));}
      a.puppet.update(dt,t);
      const screen=p.clone().add(new THREE.Vector3(0,a.puppet.spec.height+.22,0)).project(this.camera);
      a.label.style.left=`${(screen.x*.5+.5)*innerWidth}px`;a.label.style.top=`${(-screen.y*.5+.5)*innerHeight}px`;
      a.label.style.display=screen.z>1?'none':'';
    }
    if(!this.active){this.camera.position.x=1.2+Math.sin(t*.08)*.6;this.camera.lookAt(0,0,-.7);}
    this.renderer.render(this.scene,this.camera);
  }
}

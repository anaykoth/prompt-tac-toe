import { courseScenery } from './scenery.js';
import { courseTextures, texturedMaterial, worldUV } from './textures.js';
import { predictShot } from './trajectory.js';
import * as THREE from 'three';
import { BALL_RADIUS, CUP_RADIUS, SURFACE_SKIN, groundHeight } from './model.js';
import { Puppet, defaultSpec } from '../world/puppet.js';
import { HOLE, BUNKERS, heightAt, fairwayX, fairwayWidth, bunkerDistance, ellipse, slopeAt } from './course.js';

const V = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
const mat = color => new THREE.MeshStandardMaterial({ color, roughness: .95 });
function mesh(parent, geometry, material, x=0,y=0,z=0) { const m=new THREE.Mesh(geometry,material); m.position.set(x,y,z); m.receiveShadow=true; parent.add(m); return m; }
function box(parent,w,h,d,color,x,y,z) { return mesh(parent,new THREE.BoxGeometry(w,h,d),mat(color),x,y,z); }
function label(text,color='#f9eac6') {
  const c=document.createElement('canvas'); c.width=512;c.height=128;
  const g=c.getContext('2d');g.fillStyle=color;g.textAlign='center';g.textBaseline='middle';g.font='bold 72px sans-serif';g.fillText(text,256,68);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:t,depthTest:false,transparent:true}));sprite.scale.set(12,3,1);return sprite;
}
function groundLine(points, material, lift=.08) {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>V(p.x,heightAt(p.x,p.z)+lift,p.z))), material);
}

function cutCup(material){
  material.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 vGroundWorld;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvGroundWorld = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader='varying vec3 vGroundWorld;\n'+shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
if (distance(vGroundWorld.xz, vec2(${HOLE.cup.x.toFixed(3)}, ${HOLE.cup.z.toFixed(3)})) < ${CUP_RADIUS.toFixed(5)}) discard;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
float footprint = max(length(dFdx(vGroundWorld.xz)), length(dFdy(vGroundWorld.xz)));
float grain = fract(sin(dot(floor(vGroundWorld.xz * 150.0), vec2(127.1,311.7))) * 43758.5453);
diffuseColor.rgb *= 1.0 - (1.0-smoothstep(0.004,0.025,footprint)) * (0.12 * grain);`);
  };
  const courseId=HOLE.id;material.customProgramCacheKey=()=> 'ground-with-open-cup-v3-'+courseId;return material;
}
export class GolfScene {
  constructor(canvas) {
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#b5d2ce');this.scene.fog=new THREE.Fog('#aec4ba',280,850);
    this.camera=new THREE.PerspectiveCamera(52,innerWidth/innerHeight,.3,1100);
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.setSize(innerWidth,innerHeight);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.95;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;
    this.scene.add(new THREE.HemisphereLight('#cbddeb','#35402d',.75));
    const sun=this.sun=new THREE.DirectionalLight('#fff0d6',2.6);sun.castShadow=true;sun.shadow.mapSize.set(4096,4096);sun.shadow.camera.left=-65;sun.shadow.camera.right=65;sun.shadow.camera.top=65;sun.shadow.camera.bottom=-65;sun.shadow.camera.near=1;sun.shadow.camera.far=650;sun.shadow.normalBias=.025;sun.shadow.bias=-.00008;sun.shadow.radius=2;this.scene.add(sun,sun.target);
    this.camera.position.set(0,16,12);this.look=V(5,9,-65);this.camera.lookAt(this.look);
    this.scene.add(this.camera);this.people=[];this.time=0;this.overview=false;this.cupView=false;this.motion={pitch:0,roll:0,yaw:0,armed:false};this.trailCount=0;
    this.cartOcclusion={enabled:{value:0},target:{value:V()}};
    this.courseGroup=new THREE.Group();this.scene.add(this.courseGroup);this.textures=courseTextures(HOLE.seed);this.buildCourse();this.buildClub();this.buildCart();
    this.ball=mesh(this.scene,new THREE.SphereGeometry(BALL_RADIUS,24,16),new THREE.MeshStandardMaterial({color:0xfffef1,roughness:.5}));
    this.ball.castShadow=true;this.pinMarker=document.getElementById('pin-marker');
    this.ballHalo=mesh(this.scene,new THREE.SphereGeometry(.045,12,8),new THREE.MeshBasicMaterial({color:'#fff4bd',transparent:true,opacity:.17}));
    this.trail=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({color:'#7cf7ee',transparent:true,opacity:.95}));this.scene.add(this.trail);this.trailPoints=[];
    this.preview=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({color:'#ffe08c',transparent:true,opacity:.85}));this.scene.add(this.preview);
    this.flightRibs=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineDashedMaterial({color:'#ffe08c',dashSize:.45,gapSize:.65,transparent:true,opacity:.3}));this.scene.add(this.flightRibs);
    this.landing=mesh(this.scene,new THREE.TorusGeometry(1.2,.07,6,48),new THREE.MeshBasicMaterial({color:'#ffe08c',transparent:true,opacity:.8}));this.landing.rotation.x=-Math.PI/2;
    this.aimLine=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineDashedMaterial({color:'#fff4be',dashSize:.7,gapSize:.5,transparent:true,opacity:.85}));this.scene.add(this.aimLine);
    this.grid=new THREE.Group();this.scene.add(this.grid);this.buildGreenGrid();
    this.resize=()=>{this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();this.renderer.setSize(innerWidth,innerHeight);};window.addEventListener('resize',this.resize);
  }
  buildCourse() {
    mesh(this.courseGroup,new THREE.SphereGeometry(900,32,16),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{high:{value:new THREE.Color('#78b3c3')},low:{value:new THREE.Color('#f1e6c5')}},vertexShader:'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'varying vec3 p;uniform vec3 high;uniform vec3 low;void main(){float h=clamp(normalize(p).y*2.4,0.,1.);gl_FragColor=vec4(mix(low,high,h),1.);}'}));
    const geo=new THREE.PlaneGeometry(520,750,346,500);geo.rotateX(-Math.PI/2);geo.translate(0,0,-200);
    const pos=geo.attributes.position,colors=new Float32Array(pos.count*3);
    for(let i=0;i<pos.count;i++){
      const x=pos.getX(i),z=pos.getZ(i);pos.setY(i,groundHeight(x,z));
      const color=new THREE.Color(HOLE.theme==='coast'?'#8c9460':HOLE.theme==='woodland'?'#4e713e':'#657f43');
      const texture=.98+.025*Math.sin(x*2.7+z*1.9)*Math.sin(z*3.1);
      color.multiplyScalar(texture);colors.set([color.r,color.g,color.b],i*3);
    }
    geo.setAttribute('color',new THREE.BufferAttribute(colors,3));geo.computeVertexNormals();mesh(this.courseGroup,worldUV(geo),cutCup(texturedMaterial(this.textures,'grass','#ffffff',{vertexColors:true,polygonOffset:true,polygonOffsetFactor:2,polygonOffsetUnits:2})));
    this.buildPlayingSurfaces();
    // A quiet gravel path follows the outside of the hole.
    const pathGeo=new THREE.BufferGeometry(),vertices=[];
    for(let i=0;i<Math.ceil((HOLE.length+50)/2.3);i++){
      const z=15-i*2.3,nz=z-2.3,x=fairwayX(z)+49,nx=fairwayX(nz)+49;
      for(const [px,pz]of[[x-1.5,z],[x+1.5,z],[nx+1.5,nz],[x-1.5,z],[nx+1.5,nz],[nx-1.5,nz]])vertices.push(px,groundHeight(px,pz)+.02,pz);
    }
    pathGeo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));pathGeo.computeVertexNormals();mesh(this.courseGroup,worldUV(pathGeo,1),texturedMaterial(this.textures,'gravel','#c2bca2'));
    this.buildTrees();this.buildDetails();
    for(let i=0;i<15;i++){
      const x=-390+i*58,z=-540-Math.sin(i*2)*45,h=18+(i%4)*8;
      const hill=mesh(this.courseGroup,new THREE.SphereGeometry(1,24,12),mat(i%2?'#829e89':'#9bad95'),x,3,z);hill.scale.set(90,h,85);
    }
    const cup=HOLE.cup,cy=groundHeight(cup.x,cup.z);
    // A true opening through every turf layer, with soil, a recessed liner and a floor.
    mesh(this.courseGroup,new THREE.CylinderGeometry(CUP_RADIUS,CUP_RADIUS,.105,64,1,true),new THREE.MeshStandardMaterial({color:'#40382c',side:THREE.BackSide,roughness:1}),cup.x,cy-.0525,cup.z);
    mesh(this.courseGroup,new THREE.CylinderGeometry(CUP_RADIUS-.002,CUP_RADIUS-.002,.077,64,1,true),new THREE.MeshStandardMaterial({color:'#dedbd0',side:THREE.BackSide,roughness:.8}),cup.x,cy-.067,cup.z);
    const floor=mesh(this.courseGroup,new THREE.CircleGeometry(CUP_RADIUS,64),new THREE.MeshBasicMaterial({color:'#0b100c'}),cup.x,cy-.105,cup.z);floor.rotation.x=-Math.PI/2;
    const rim=mesh(this.courseGroup,new THREE.RingGeometry(CUP_RADIUS,CUP_RADIUS+.003,64),mat('#c2c68b'),cup.x,cy+.001,cup.z);rim.rotation.x=-Math.PI/2;
    this.flag=new THREE.Group();this.flag.position.set(cup.x,cy,cup.z);this.courseGroup.add(this.flag);
    mesh(this.flag,new THREE.CylinderGeometry(.007,.007,1.9,8),mat('#eee9d7'),0,.95,0);
    for(let i=0;i<4;i++)mesh(this.flag,new THREE.CylinderGeometry(.0075,.0075,.2,8),mat('#29352b'),0,.3+i*.4,0);
    const flagGeo=new THREE.PlaneGeometry(.48,.32,12,4);flagGeo.translate(.24,0,0);this.flagCloth=mesh(this.flag,flagGeo,new THREE.MeshStandardMaterial({color:'#d46b42',side:THREE.DoubleSide,roughness:1}),0,1.7,0);
    this.flag.traverse(o=>{if(o.isMesh)o.castShadow=true;});
    this.pinLabel=label('01 / PIN');this.pinLabel.position.set(cup.x,cy+3,cup.z);this.courseGroup.add(this.pinLabel);
    for(const x of[-3,3]){const marker=mesh(this.courseGroup,new THREE.SphereGeometry(.25,12,8),mat('#efe4b7'),x,heightAt(x,1)+.14,1);marker.scale.y=.7;}
    for(const [name,x,z,color] of[['Basil',-7,2,'#99bb69'],['Dot',7,0,'#e99ab4']]){
      const p=new Puppet({...defaultSpec(name),fur:color,accessory:'cap',height:1.7});p.group.position.set(x,heightAt(x,z),z);p.group.rotation.y=x<0?.7:-.9;p.group.traverse(o=>{if(o.isMesh)o.castShadow=true;});this.courseGroup.add(p.group);this.people.push(p);
    }
    const signY=heightAt(-9,3)+1.5;
    box(this.courseGroup,2.5,1,.15,'#214d40',-9,signY,3);for(const x of[-10,-8])box(this.courseGroup,.08,1.5,.08,'#a1916a',x,signY-.75,3);
    const sign=label(`01 / PAR ${HOLE.par}`);sign.position.set(-9,signY,3.1);sign.scale.set(2.25,.56,1);this.courseGroup.add(sign);
    mesh(this.courseGroup,new THREE.SphereGeometry(16,24,16),new THREE.MeshBasicMaterial({color:'#fff1cc',fog:false}),-280,160,-650);
    for(let i=0;i<8;i++)for(let j=0;j<4;j++){
      const cloud=mesh(this.courseGroup,new THREE.SphereGeometry(1,12,8),new THREE.MeshBasicMaterial({color:'#f4eee0',transparent:true,opacity:.45}),-380+i*105+j*15,118+(i%3)*18+Math.sin(j)*4,-430-(i%2)*90);cloud.scale.set(23,5+j%2*2,12);
    }
  }
  buildPlayingSurfaces(){
    // Separate, finely tessellated surfaces keep curved edges smooth at ground level.
    const ribbon=new THREE.PlaneGeometry(2,HOLE.length-16,36,Math.ceil(HOLE.length));ribbon.rotateX(-Math.PI/2);ribbon.translate(0,0,-HOLE.length/2);
    const p=ribbon.attributes.position,colors=new Float32Array(p.count*3);
    for(let i=0;i<p.count;i++){
      const z=p.getZ(i),x=fairwayX(z)+p.getX(i)*fairwayWidth(z);p.setXYZ(i,x,groundHeight(x,z),z);
      const color=new THREE.Color(Math.floor((z+x*.26)/9)%2===0?(HOLE.theme==='coast'?'#8eaa66':'#78a75c'):(HOLE.theme==='coast'?'#7f9b59':'#65964e'));colors.set([color.r,color.g,color.b],i*3);
    }
    ribbon.setAttribute('color',new THREE.BufferAttribute(colors,3));ribbon.computeVertexNormals();mesh(this.courseGroup,worldUV(ribbon),cutCup(texturedMaterial(this.textures,'grass','#ffffff',{vertexColors:true,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4})));
    const patch=(e,scale,color,lift,shaped=false,kind='grass')=>{
      const geometry=new THREE.RingGeometry(0,1,144,48);geometry.rotateX(-Math.PI/2);const p=geometry.attributes.position;
      for(let i=0;i<p.count;i++){
        const u=p.getX(i),v=p.getZ(i),r=Math.hypot(u,v),c=Math.cos(e.angle||0),s=Math.sin(e.angle||0);
        const dx=u*e.rx*c-v*e.rz*s,dz=u*e.rx*s+v*e.rz*c;let edge=1;
        if(shaped&&r>.0001)for(let k=0;k<4;k++)edge/=bunkerDistance(e.x+dx/r*edge,e.z+dz/r*edge,e);
        const x=e.x+dx*scale*edge,z=e.z+dz*scale*edge;p.setXYZ(i,x,groundHeight(x,z),z);
      }
      geometry.computeVertexNormals();worldUV(geometry,kind==='sand'?2.5:1);const material=texturedMaterial(this.textures,kind,color);material.polygonOffset=true;material.polygonOffsetFactor=-3-lift*20;material.polygonOffsetUnits=-6-lift*30;mesh(this.courseGroup,geometry,cutCup(material));
    };
    patch(HOLE.green,1.14,'#79a359',.035);patch(HOLE.green,1,'#a2bc70',.045);
    patch({x:0,z:1,rx:6,rz:9},1,'#89aa60',.035);
    for(const b of BUNKERS){patch(b,1.04,'#b5b47b',.04,true);patch(b,1,'#f1dfaf',.055,true,'sand');}
  }
  buildTrees(){
    const {trees}=courseScenery();
    const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.14,.24,1,6),texturedMaterial(this.textures,'bark','#817456'),trees.length);
    const leaves=new THREE.InstancedMesh(new THREE.ConeGeometry(1,1,7),mat('#ffffff'),trees.length*3);
    const broad=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),mat('#ffffff'),trees.length);
    const dummy=new THREE.Object3D(),color=new THREE.Color();let li=0,bi=0;
    trees.forEach((t,i)=>{
      const y=heightAt(t.x,t.z);dummy.position.set(t.x,y+t.h*.4,t.z);dummy.scale.set(1,t.h*.8,1);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
      if(t.pine)for(let n=0;n<3;n++){
        dummy.position.set(t.x,y+t.h*(.5+n*.17),t.z);dummy.scale.set(t.h*(.31-n*.055),t.h*.62,t.h*(.31-n*.055));dummy.updateMatrix();leaves.setMatrixAt(li,dummy.matrix);color.set(n%2?'#496d44':'#385d43');leaves.setColorAt(li++,color);
      }else{
        dummy.position.set(t.x,y+t.h*.8,t.z);dummy.scale.set(t.h*.42,t.h*.48,t.h*.39);dummy.updateMatrix();broad.setMatrixAt(bi,dummy.matrix);color.setHSL(.22+(i%5)*.01,.28,.3+(i%4)*.025);broad.setColorAt(bi++,color);
      }
    });
    leaves.count=li;broad.count=bi;
    for(const tree of[trunks,leaves,broad]){
      tree.castShadow=true;tree.receiveShadow=true;
      // Dither only the foliage/trunk pixels between the chase camera and cart.
      // Physical tree collision and the rest of the forest remain unchanged.
      tree.material.onBeforeCompile=shader=>{
        shader.uniforms.cartFade=this.cartOcclusion.enabled;shader.uniforms.cartTarget=this.cartOcclusion.target;
        shader.vertexShader='varying vec3 cartTreeWorld;\n'+shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\ncartTreeWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
        shader.fragmentShader='uniform float cartFade;\nuniform vec3 cartTarget;\nvarying vec3 cartTreeWorld;\n'+shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
if (cartFade > 0.5) {
  vec3 ray = cartTarget - cameraPosition;
  float t = dot(cartTreeWorld - cameraPosition, ray) / max(dot(ray, ray), 0.01);
  float distanceToRay = length(cartTreeWorld - cameraPosition - ray * clamp(t, 0.0, 1.0));
  float cutaway = (1.0 - smoothstep(1.8, 3.0, distanceToRay)) * step(0.0, t) * step(t, 1.08);
  float pattern = fract(dot(floor(gl_FragCoord.xy), vec2(0.75487766, 0.56984029)));
  if (pattern < cutaway * 0.94) discard;
}`);
      };
      tree.material.customProgramCacheKey=()=> 'cart-foliage-cutaway-v1';
    }
    this.courseGroup.add(trunks,leaves,broad);
  }
  buildDetails(){
    const data=courseScenery(),dummy=new THREE.Object3D();
    const grass=new THREE.InstancedMesh(new THREE.ConeGeometry(.14,.7,3),mat(HOLE.theme==='coast'?'#b8ad75':'#748d48'),data.grass.length);
    const rocks=new THREE.InstancedMesh(new THREE.SphereGeometry(1,12,8),texturedMaterial(this.textures,'gravel','#8f9484'),data.rocks.length);
    const flowers=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.055,0),mat('#e2ca87'),data.flowers.length);
    data.grass.forEach((p,i)=>{dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(0,p.yaw,p.lean);dummy.scale.set(p.width,p.h,1);dummy.updateMatrix();grass.setMatrixAt(i,dummy.matrix);});
    data.flowers.forEach((p,i)=>{dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(0,p.yaw,p.lean);dummy.scale.setScalar(p.size);dummy.updateMatrix();flowers.setMatrixAt(i,dummy.matrix);});
    data.rocks.forEach((p,i)=>{dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(0,0,0);dummy.scale.set(p.rx,p.ry,p.rz);dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);});
    rocks.castShadow=true;grass.receiveShadow=rocks.receiveShadow=true;this.courseGroup.add(grass,rocks,flowers);
    // Teeing-ground bench, rail fence, distance posts and bunker rakes.
    const y=groundHeight(8,7);box(this.courseGroup,2.2,.12,.65,'#8d714b',8,y+.5,7);
    for(const x of[7.15,8.85])box(this.courseGroup,.12,.5,.5,'#3f4b3e',x,y+.25,7);
    for(let z=4;z<24;z+=3){const x=-13,h=groundHeight(x,z);box(this.courseGroup,.11,1.1,.11,'#bcb293',x,h+.55,z);if(z<22)for(const lift of[.45,.9])box(this.courseGroup,.08,.09,3,'#aea589',x,h+lift,z+1.5);}
    for(let d=50;d<HOLE.length-25;d+=50){const x=fairwayX(-d)+fairwayWidth(-d)+1,h=groundHeight(x,-d);box(this.courseGroup,.09,.7,.09,'#e1dbc2',x,h+.35,-d);box(this.courseGroup,.1,.15,.1,'#b95f3c',x,h+.6,-d);}
    for(const b of BUNKERS){const x=b.x+b.rx+1,z=b.z,y=groundHeight(x,z);const rake=box(this.courseGroup,.035,.035,1.4,'#ae9872',x,y+.055,z);rake.rotation.y=.5;box(this.courseGroup,.42,.055,.07,'#666d5b',x+.32,y+.055,z+.58);}
    if(HOLE.theme==='coast'){
      const sea=mesh(this.courseGroup,new THREE.PlaneGeometry(230,740,1,1),new THREE.MeshStandardMaterial({color:'#548f99',roughness:.4,metalness:.12}),-270,.4,-190);sea.rotation.x=-Math.PI/2;
      for(let n=0;n<9;n++){const x=-158-n*9,pts=[];for(let z=150;z>-550;z-=4)pts.push(V(x+Math.sin(z*.035+n)*1.3,.43,z));this.courseGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:'#c5e0d7',transparent:true,opacity:.3})));}
    }
  }
  rebuildCourse(){
    const dispose=group=>{const seen=new Set();group.traverse(o=>{for(const value of [o.geometry,...(Array.isArray(o.material)?o.material:[o.material])])if(value&&!seen.has(value)){seen.add(value);value.dispose();}});group.clear();};
    dispose(this.courseGroup);for(const tile of Object.values(this.textures)){tile.map.dispose();tile.bump.dispose();}
    this.textures=courseTextures(HOLE.seed);this.people=[];this.buildCourse();dispose(this.grid);this.buildGreenGrid();this.guideKey='';this.reset();
  }
  tube(target,points,radius){
    target.geometry.dispose();
    if(points.length<2){target.geometry=new THREE.BufferGeometry();return;}
    const path=new THREE.CurvePath();for(let i=1;i<points.length;i++)if(points[i].distanceToSquared(points[i-1])>1e-10)path.add(new THREE.LineCurve3(points[i-1],points[i]));
    target.geometry=path.curves.length?new THREE.TubeGeometry(path,Math.min(600,Math.max(2,points.length*2)),radius,6,false):new THREE.BufferGeometry();
  }
  buildGreenGrid(){
    const material=new THREE.LineBasicMaterial({color:'#e3edb1',transparent:true,opacity:.3});
    for(let axis=0;axis<2;axis++)for(let k=-24;k<=24;k+=2){
      let points=[];
      for(let n=-27;n<=27;n+=.5){const x=HOLE.green.x+(axis?k:n),z=HOLE.green.z+(axis?n:k);if(ellipse(x,z,HOLE.green)<.97)points.push({x,z});}
      if(points.length>1)this.grid.add(groundLine(points,material,.08));
    }
    this.slopeDots=[];
    const dotGeo=new THREE.SphereGeometry(.055,6,4),dotMat=new THREE.MeshBasicMaterial({color:'#edf2c2',transparent:true,opacity:.65});
    for(let x=-14;x<=14;x+=4)for(let z=-18;z<=18;z+=4){const p={x:HOLE.green.x+x,z:HOLE.green.z+z};if(ellipse(p.x,p.z,HOLE.green)<.9){const dot=mesh(this.grid,dotGeo,dotMat);this.slopeDots.push({dot,...p});}}
  }
  buildClub(){
    const rig=this.club=new THREE.Group();this.camera.add(rig);rig.position.set(.36,-.05,-1.5);rig.scale.setScalar(.55);
    mesh(rig,new THREE.CylinderGeometry(.016,.019,1.3,10),new THREE.MeshStandardMaterial({color:'#cbd4ce',metalness:.8,roughness:.25}),0,-.45,0);
    mesh(rig,new THREE.CylinderGeometry(.037,.037,.3,10),mat('#274d3d'),0,.18,0);
    const face=this.clubface=new THREE.Group();face.position.y=-1.1;rig.add(face);
    this.driverHead=mesh(face,new THREE.SphereGeometry(.15,18,10),new THREE.MeshStandardMaterial({color:'#253b36',metalness:.55,roughness:.3}),.075,0,0);this.driverHead.scale.set(1.3,.55,.85);
    this.ironHead=box(face,.25,.15,.045,'#b9c8bf',.075,.01,-.07);this.ironHead.rotation.x=-.3;
    this.putterHead=box(face,.32,.08,.14,'#a8bcb5',.075,-.02,-.03);
    box(face,.23,.105,.025,'#dce2d0',.075,0,-.102);
    for(const y of[-.025,0,.025])box(face,.19,.004,.002,'#52645c',.075,y,-.116);
    const hand=mesh(rig,new THREE.SphereGeometry(.095,14,10),mat('#a6c77d'),-.025,.07,.035);hand.scale.set(1,1.6,.8);
  }
  buildCart(){
    const rig=this.cartRig=new THREE.Group();this.scene.add(rig);
    box(rig,1.75,.34,2.8,'#d8c58b',0,.65,0);box(rig,1.8,.22,.7,'#234b3d',0,.9,-1.05);box(rig,1.65,.15,.85,'#dfdfc4',0,1.12,.4);box(rig,1.65,.65,.15,'#c3c7a7',0,1.4,.8);
    for(const x of[-.78,.78])for(const z of[-.95,.95])box(rig,.06,1.8,.06,'#38554a',x,1.45,z);
    box(rig,2,.12,3,'#eee2b7',0,2.4,0);
    this.cartWheels=[];this.cartSteering=[];
    for(const x of[-.96,.96])for(const z of[-.95,.95]){
      const axle=new THREE.Group();axle.position.set(x,.42,z);rig.add(axle);if(z<0)this.cartSteering.push(axle);
      const rotor=new THREE.Group();axle.add(rotor);this.cartWheels.push(rotor);
      const tyre=mesh(rotor,new THREE.CylinderGeometry(.42,.42,.3,16),mat('#26342f'));tyre.rotation.z=Math.PI/2;
      const hub=mesh(rotor,new THREE.CylinderGeometry(.22,.22,.315,12),mat('#f2be64'));hub.rotation.z=Math.PI/2;
      box(rotor,.32,.05,.32,'#355b47',0,0,0);
    }
    for(const x of[-.89,.89])box(rig,.025,.12,2.2,'#efac54',x,.72,.15);
    this.cartFlames=[];
    for(const x of[-.57,.57]){const flame=mesh(rig,new THREE.ConeGeometry(.18,1,8),new THREE.MeshBasicMaterial({color:'#88ffdf',transparent:true,opacity:.85}),x,.64,1.9);flame.rotation.x=Math.PI/2;this.cartFlames.push(flame);}
    box(rig,.1,.7,.1,'#647768',-.45,1.2,-.5);const wheel=mesh(rig,new THREE.TorusGeometry(.25,.028,8,24),mat('#243d33'),-.45,1.57,-.5);wheel.rotation.x=-.6;
    for(const x of[-.65,.65])box(rig,.25,.13,.03,'#f4e6a8',x,.86,-1.42);
    // A small seated club regular makes the third-person driving view legible.
    box(rig,.42,.45,.3,'#92b568',-.42,1.38,.25);
    mesh(rig,new THREE.SphereGeometry(.23,16,12),mat('#a3c477'),-.42,1.83,.2);
    mesh(rig,new THREE.SphereGeometry(.16,12,8),mat('#adc77b'),-.42,1.78,-.02);
    for(const x of[-.51,-.33])mesh(rig,new THREE.SphereGeometry(.055,8,6),mat('#f5ebd1'),x,1.92,.005);
    for(const x of[-.51,-.33])mesh(rig,new THREE.SphereGeometry(.025,8,6),mat('#243e32'),x,1.92,-.044);
    const cap=mesh(rig,new THREE.SphereGeometry(.24,14,8),mat('#d69c56'),-.42,2,.2);cap.scale.y=.4;
    box(rig,.34,.035,.3,'#b87d42',-.42,1.98,.02);
    rig.traverse(o=>{if(o.isMesh)o.castShadow=true;});
    this.cartTarget=mesh(this.scene,new THREE.TorusGeometry(1,.04,6,48),new THREE.MeshBasicMaterial({color:'#efcd78',transparent:true,opacity:.8}));this.cartTarget.rotation.x=-Math.PI/2;
    // Fixed-size pools keep tyre trails and dust cheap throughout a long drive.
    const skidGeo=new THREE.PlaneGeometry(1,1);skidGeo.rotateX(-Math.PI/2);
    this.cartSkids=Array.from({length:220},()=>{const m=mesh(this.scene,skidGeo,new THREE.MeshBasicMaterial({color:'#37432a',transparent:true,opacity:0,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));m.visible=false;m.userData.life=0;return m;});
    const dustGeo=new THREE.IcosahedronGeometry(1,0);
    this.cartDust=Array.from({length:48},()=>{const m=mesh(this.scene,dustGeo,new THREE.MeshBasicMaterial({color:'#d5c99d',transparent:true,opacity:0,depthWrite:false}));m.visible=false;m.userData.life=0;return m;});
    this.cartSkidIndex=this.cartDustIndex=this.cartDustAt=0;this.cartTyres=null;this.cartCameraHeading=null;
  }
  updateCart(dt,cart){
    const h=cart.heading,s=Math.sin(h),c=Math.cos(h),slope=slopeAt(cart.x,cart.z),speed=cart.groundSpeed;
    const roll=THREE.MathUtils.clamp(cart.yawRate*speed*.006,-.2,.2);
    this.cartRig.position.set(cart.x,groundHeight(cart.x,cart.z)+Math.sin(this.time*19)*Math.min(.035,speed*.003),cart.z);
    this.cartRig.rotation.set(Math.atan(slope.x*s-slope.z*c),-h,Math.atan(slope.x*c+slope.z*s)+roll,'YXZ');
    for(const wheel of this.cartWheels)wheel.rotation.x-=cart.speed*dt/.42;
    for(const axle of this.cartSteering)axle.rotation.y=-cart.steer*.45;
    for(const flame of this.cartFlames){flame.visible=cart.boosting;flame.scale.y=1+Math.sin(this.time*53)*.25;}
    const tyres=[-.96,.96].map(side=>({x:cart.x+c*side-s*.95,z:cart.z+s*side+c*.95}));
    const skidding=cart.active&&(cart.drifting||(cart.input.brake&&speed>5));
    if(skidding&&this.cartTyres)for(let i=0;i<2;i++){
      const p=tyres[i],prev=this.cartTyres[i],distance=Math.hypot(p.x-prev.x,p.z-prev.z);
      if(distance<.02||distance>3)continue;
      const m=this.cartSkids[this.cartSkidIndex++%this.cartSkids.length];
      const x=(p.x+prev.x)/2,z=(p.z+prev.z)/2;
      m.position.set(x,groundHeight(x,z)+.035,z);m.rotation.y=-Math.atan2(p.x-prev.x,prev.z-p.z);m.scale.set(.24,1,distance+.08);m.userData.life=14;m.visible=true;
    }
    this.cartTyres=cart.active?tyres:null;
    if(cart.active&&speed>3&&this.time-this.cartDustAt>(skidding?.025:.11)){
      this.cartDustAt=this.time;
      for(const p of tyres){const m=this.cartDust[this.cartDustIndex++%this.cartDust.length];m.position.set(p.x,groundHeight(p.x,p.z)+.15,p.z);m.scale.setScalar(skidding?.32:.17);Object.assign(m.userData,{life:.8,dx:-cart.vx*.07+(Math.random()-.5),dz:-cart.vz*.07+(Math.random()-.5)});m.visible=true;}
    }
    for(const m of this.cartSkids){m.userData.life=Math.max(0,m.userData.life-dt);m.visible=m.userData.life>0;m.material.opacity=Math.min(.36,m.userData.life*.05);}
    for(const m of this.cartDust){const d=m.userData;d.life=Math.max(0,d.life-dt);m.visible=d.life>0;if(!m.visible)continue;m.position.x+=d.dx*dt;m.position.z+=d.dz*dt;m.position.y+=dt*.7;m.scale.multiplyScalar(1+dt*1.8);m.material.opacity=d.life*.32;}
  }
  setMotion(m){this.motion=m;}
  setPuttGuide(points,key=''){
    if(!this.puttGuide){this.puttGuide=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({color:'#f1d376',transparent:true,opacity:.75}));this.scene.add(this.puttGuide);}
    this.guideEnabled=!!points;
    if(points&&this.guideKey!==key){this.guideKey=key;this.tube(this.puttGuide,points.map(p=>V(p.x,groundHeight(p.x,p.z)+.045,p.z)),.016);}
  }
  hit(){const preview=this.previewPoints;this.overview=false;this.cupView=false;this.reset();this.previewPoints=preview;}
  reset(){this.trailPoints=[];this.tube(this.trail,[],.1);this.aimKey='';this.previewKey='';this.previewPoints=null;this.cartTyres=null;this.cartCameraHeading=null;for(const m of [...this.cartSkids,...this.cartDust]){m.visible=false;m.userData.life=0;}}
  frame(dt,round,cart=null){
    this.time+=dt;for(const p of this.people)p.update(dt,this.time);
    const ball=round.ball,position=ball||round.position,inFlight=ball&&!ball.stopped,putting=round.club==='putter';
    const driving=!!cart?.active;this.cartRig.visible=!!cart;
    this.cartOcclusion.enabled.value=driving?1:0;if(cart)this.cartOcclusion.target.value.set(cart.x,groundHeight(cart.x,cart.z)+1.3,cart.z);
    if(cart)this.updateCart(dt,cart);
    this.cartTarget.visible=driving;if(driving)this.cartTarget.position.set(round.position.x,groundHeight(round.position.x,round.position.z)+.06,round.position.z);
    const a=(round.directionLock?.heading??round.heading)+(round.directionLock?.aim??round.aim)*Math.PI/180,dx=Math.sin(a),dz=-Math.cos(a);
    const y=ball?.y??groundHeight(position.x,position.z)+BALL_RADIUS;
    this.ball.position.set(position.x,y,position.z);this.ball.visible=!(ball?.holed||round.holed);
    if(inFlight&&this.trailPoints.length<650&&(!this.trailPoints.length||this.time-this.lastTrail>.075)){
      this.trailPoints.push(V(position.x,Math.max(y,groundHeight(position.x,position.z)+.045),position.z));this.tube(this.trail,this.trailPoints,putting?.019:.11);this.lastTrail=this.time;
    }
    const power=round.directionLock?.power??round.previewPower??.65,face=0,previewKey=[HOLE.id,round.club,round.position.x,round.position.z,round.aim.toFixed(1),power,face].join(':');
    if(!ball&&!putting&&this.previewKey!==previewKey&&this.time-(this.previewAt||-1)>.15){
      this.previewAt=this.time;this.previewKey=previewKey;const predicted=predictShot(round,power,face);this.previewPoints=predicted.points.map(p=>V(p.x,Math.max(p.y,groundHeight(p.x,p.z)+.1),p.z));this.tube(this.preview,this.previewPoints,.09);
      const ribs=[];for(let i=8;i<this.previewPoints.length;i+=14){const p=this.previewPoints[i],h=groundHeight(p.x,p.z);if(p.y>h+.5)ribs.push(V(p.x,h+.1,p.z),p.clone());}this.flightRibs.geometry.dispose();this.flightRibs.geometry=new THREE.BufferGeometry().setFromPoints(ribs);this.flightRibs.computeLineDistances();
      const end=predicted.points.at(-1);this.landing.position.set(end.x,groundHeight(end.x,end.z)+.12,end.z);
    }
    this.flightRibs.visible=this.preview.visible=this.landing.visible=!driving&&!!this.previewPoints?.length&&!putting&&!this.cupView;
    this.trail.visible=!driving&&!this.cupView;
    const legend=document.getElementById('trajectory-legend');if(legend){legend.hidden=driving||this.cupView||putting;legend.lastChild.textContent=` CYAN · YOUR SHOT  /  GUIDE ${Math.round(power*100)}%`;}
    const follow=ball&&ball.age>.8;
    let cam,look;
    if(driving){
      const velocityHeading=cart.groundSpeed>3?Math.atan2(cart.vx,-cart.vz):cart.heading;
      const targetHeading=cart.spinning?velocityHeading:cart.heading;
      this.cartCameraHeading??=targetHeading;
      const angle=Math.atan2(Math.sin(targetHeading-this.cartCameraHeading),Math.cos(targetHeading-this.cartCameraHeading));
      this.cartCameraHeading+=angle*(1-Math.exp(-dt*(cart.spinning?1.5:3.5)));
      const f=V(Math.sin(this.cartCameraHeading),0,-Math.cos(this.cartCameraHeading)),rush=Math.min(1,cart.groundSpeed/23);
      cam=V(cart.x,groundHeight(cart.x,cart.z)+4.3+rush*.7,cart.z).addScaledVector(f,-8-rush*2.5);cam.y=Math.max(cam.y,groundHeight(cam.x,cam.z)+2);
      look=V(cart.x,groundHeight(cart.x,cart.z)+1.2,cart.z).addScaledVector(f,4);
    }
    else if(this.cupView){const c=HOLE.cup,h=groundHeight(c.x,c.z);cam=V(c.x+.24,h+.42,c.z+.75);look=V(c.x,h-.025,c.z);}
    else if(this.shotView&&!putting){const pts=ball?[...(this.previewPoints||[]),...this.trailPoints]:this.previewPoints,box=new THREE.Box3().setFromPoints(pts?.length>1?pts:[V(position.x,y,position.z),V(position.x,y,position.z-60)]),size=box.getSize(V()),middle=box.getCenter(V()),span=Math.max(55,size.length());cam=middle.clone().add(V(span*.8,span*.42,span*.35));look=middle;}
    else if(this.overview){cam=V(145,Math.max(135,HOLE.length*.5),35);look=V(0,5,-HOLE.length*.5);}
    else if(putting){
      // Keep the ball's start and cup in one steady view throughout the stroke.
      // Chasing a slow rolling ball hides pace and break.
      const origin=ball?.start||round.position,d=Math.hypot(HOLE.cup.x-origin.x,HOLE.cup.z-origin.z),gap=Math.max(3.4,d*.42);
      const heading=Math.atan2(HOLE.cup.x-origin.x,origin.z-HOLE.cup.z),px=Math.sin(heading),pz=-Math.cos(heading);
      cam=V(origin.x-px*gap,groundHeight(origin.x,origin.z)+Math.max(2.8,d*.6),origin.z-pz*gap);
      look=V(origin.x+px*d*.45,groundHeight(origin.x+px*d*.45,origin.z+pz*d*.45),origin.z+pz*d*.45);
    }
    else if(follow){const gap=19;cam=V(position.x-dx*gap,Math.max(y+9,heightAt(position.x-dx*gap,position.z-dz*gap)+4),position.z-dz*gap);look=V(position.x,y,position.z);}
    else {const gap=putting?2.8:5.5;cam=V(position.x-dx*gap,heightAt(position.x,position.z)+(putting?1.6:1.8),position.z-dz*gap);const ahead=putting?Math.min(round.toPin*.35,4):24;look=V(position.x+dx*ahead,heightAt(position.x+dx*ahead,position.z+dz*ahead)+(putting?0:2),position.z+dz*ahead);}
    const fov=driving?58+Math.min(1,cart.groundSpeed/23)*13:52;
    if(Math.abs(this.camera.fov-fov)>.01){this.camera.fov=THREE.MathUtils.damp(this.camera.fov,fov,5,dt);this.camera.updateProjectionMatrix();}
    if(!driving)this.cartCameraHeading=null;
    const smoothing=1-Math.exp(-dt*(driving?6:2.4));this.camera.position.lerp(cam,smoothing);this.look.lerp(look,smoothing);this.camera.lookAt(this.look);
    this.club.visible=!driving&&!ball&&!this.overview&&!this.cupView&&!this.shotView;
    this.driverHead.visible=['driver','wood'].includes(round.club);this.putterHead.visible=putting;this.ironHead.visible=!putting&&!this.driverHead.visible;
    const m=this.motion;
    // The player faces the locked target. A live shaft can move left/right
    // inside that frame; yaw never rotates the player or the aim guide.
    const shaft=m.armed&&m.shaft?V(...m.shaft).normalize():V(0,-1,0),pose=new THREE.Quaternion().setFromUnitVectors(V(0,-1,0),shaft);
    pose.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-.18,0,-.32)));
    this.club.quaternion.slerp(pose,1-Math.exp(-dt*14));
    this.clubface.rotation.y=THREE.MathUtils.damp(this.clubface.rotation.y,-(m.face??0)*Math.PI/180,14,dt);
    this.ball.scale.setScalar(1);this.ballHalo.position.copy(this.ball.position);this.ballHalo.visible=!round.holed&&!this.cupView;this.ballHalo.scale.setScalar(Math.max(1,this.camera.position.distanceTo(this.ball.position)*.012));
    this.aimLine.visible=!driving&&!ball&&!this.cupView&&!this.shotView;
    if(this.puttGuide)this.puttGuide.visible=this.guideEnabled&&!driving&&putting&&!ball&&!this.cupView&&!this.overview;
    const aimKey=[position.x,position.z,a,putting].join(':');
    if(!ball&&this.aimKey!==aimKey){
      this.aimKey=aimKey;const points=[],length=putting?Math.min(round.toPin+2,18):32;
      for(let d=.4;d<=length;d+=.5){const x=position.x+dx*d,z=position.z+dz*d;points.push(V(x,heightAt(x,z)+.1,z));}
      this.aimLine.geometry.dispose();this.aimLine.geometry=new THREE.BufferGeometry().setFromPoints(points);this.aimLine.computeLineDistances();
    }
    this.grid.visible=!driving&&putting&&!this.overview&&!this.cupView;
    if(this.grid.visible)for(const p of this.slopeDots){const s=slopeAt(p.x,p.z),t=(this.time*.3)%1;const x=p.x-s.x*t*12,z=p.z-s.z*t*12;p.dot.position.set(x,heightAt(x,z)+.12,z);}
    this.flag.visible=!putting&&!this.cupView;this.pinLabel.visible=!putting&&!this.cupView;const labelScale=Math.min(1.8,Math.max(.4,round.toPin/200));this.pinLabel.scale.set(12*labelScale,3*labelScale,1);
    const flagPositions=this.flagCloth.geometry.attributes.position;for(let i=0;i<flagPositions.count;i++)flagPositions.setZ(i,Math.sin(this.time*2.4+flagPositions.getX(i)*3)*.13*flagPositions.getX(i));flagPositions.needsUpdate=true;
    const centre=driving?cart:this.cupView?HOLE.cup:this.overview?{x:0,z:-HOLE.length*.5}:position;
    const radius=this.overview?230:65;if(this.shadowRadius!==radius){this.shadowRadius=radius;Object.assign(this.sun.shadow.camera,{left:-radius,right:radius,top:radius,bottom:-radius});this.sun.shadow.camera.updateProjectionMatrix();}
    this.sun.target.position.set(centre.x,groundHeight(centre.x,centre.z),centre.z);
    this.sun.position.copy(this.sun.target.position).add(this.overview?V(-165,135,90):V(-55,45,30));
    if(this.pinMarker){const pin=V(HOLE.cup.x,groundHeight(HOLE.cup.x,HOLE.cup.z)+.1,HOLE.cup.z).project(this.camera);this.pinMarker.hidden=driving||!putting||this.cupView||this.overview||pin.z>1;this.pinMarker.style.left=(pin.x*.5+.5)*innerWidth+'px';this.pinMarker.style.top=(-pin.y*.5+.5)*innerHeight-12+'px';this.pinMarker.textContent='CUP · '+round.toPin.toFixed(1)+' m';}
    this.renderer.render(this.scene,this.camera);
  }
}

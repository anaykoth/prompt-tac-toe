import * as THREE from 'three';

// Small deterministic tiles generated locally. World-space UVs preserve scale
// across the fairway, raised green mesh and bunker layers.
export function courseTextures(seed=721){
  let state=seed;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const make=(kind)=>{
    const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d');
    g.fillStyle=kind==='bark'?'#9b8d79':'#d5d7c7';g.fillRect(0,0,256,256);
    const count=kind==='grass'?14000:kind==='sand'?9000:5000;
    for(let i=0;i<count;i++){
      const x=random()*256,y=random()*256,v=100+Math.floor(random()*140);
      g.strokeStyle=`rgba(${v},${v},${v},${kind==='grass'?.48:.35})`;g.lineWidth=kind==='grass'?.5:1;
      g.beginPath();g.moveTo(x,y);
      if(kind==='grass')g.lineTo(x+(random()-.5)*3,y-2-random()*6);
      else if(kind==='bark')g.lineTo(x+(random()-.5)*3,y+8+random()*32);
      else g.lineTo(x+random()*2,y+random()*2);
      g.stroke();
    }
    if(kind==='sand')for(let y=0;y<256;y+=9){g.strokeStyle='#99978345';g.beginPath();for(let x=0;x<=256;x+=4){const yy=y+Math.sin(x/35)*2;x?g.lineTo(x,yy):g.moveTo(x,yy);}g.stroke();}
    const map=new THREE.CanvasTexture(c);map.wrapS=map.wrapT=THREE.RepeatWrapping;map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=8;
    const bump=map.clone();bump.colorSpace=THREE.NoColorSpace;bump.needsUpdate=true;
    return {map,bump};
  };
  return {grass:make('grass'),sand:make('sand'),gravel:make('gravel'),bark:make('bark')};
}
export function worldUV(geometry,scale=2){
  const p=geometry.attributes.position,uv=new Float32Array(p.count*2);
  for(let i=0;i<p.count;i++){uv[i*2]=p.getX(i)/scale;uv[i*2+1]=p.getZ(i)/scale;}
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));return geometry;
}
export function texturedMaterial(textures,kind,color,extra={}){
  return new THREE.MeshStandardMaterial({color,map:textures[kind].map,bumpMap:textures[kind].bump,bumpScale:kind==='grass'?.035:kind==='sand'?.07:.05,roughness:1,...extra});
}

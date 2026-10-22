import { HOLE, BUNKERS, heightAt, fairwayX, fairwayWidth, ellipse } from './course.js';
const cache=new Map();
const randomFor=initial=>{let seed=initial;return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};};
// Rendering and collision consume these same world-space objects.
export function courseScenery(){
  if(cache.has(HOLE.id))return cache.get(HOLE.id);
  const random=randomFor(HOLE.seed),trees=[],grass=[],flowers=[],rocks=[];
  for(let i=0;i<(HOLE.theme==='coast'?65:HOLE.theme==='woodland'?420:290);i++){
    const z=24-random()*(HOLE.length+90),side=i%2?1:-1,x=fairwayX(z)+side*(33+random()*150);
    if((HOLE.theme==='coast'&&x<-65)||ellipse(x,z,HOLE.green)<1.7||BUNKERS.some(b=>ellipse(x,z,b)<1.4)||Math.abs(x-fairwayX(z)-49)<5)continue;
    trees.push({id:`tree-${i}`,x,z,y:heightAt(x,z),h:5+random()*8,pine:random()>.3});
  }
  const rand=randomFor(HOLE.seed+17);
  for(let i=0;i<2400;i++){
    const z=16-rand()*(HOLE.length+36),side=rand()>.5?1:-1,x=fairwayX(z)+side*(fairwayWidth(z)+2+rand()*21);
    if(ellipse(x,z,HOLE.green)<1.25||BUNKERS.some(b=>ellipse(x,z,b)<1.2)||Math.abs(x-fairwayX(z)-49)<4)continue;
    const h=.45+rand()*.9,g={x,y:heightAt(x,z)+.055+h*.25,z,h,yaw:rand()*6.28,lean:(rand()-.5)*.2,width:.7+rand()};grass.push(g);
    if(flowers.length<600&&rand()>.65)flowers.push({...g,y:g.y+h*.24,size:1+rand()});
    if(rocks.length<95&&rand()>.91){const size=.25+rand()*.8;rocks.push({id:`rock-${rocks.length}`,x:x+side*7,y:heightAt(x+side*7,z)+.055+size*.25,z,rx:size,ry:size*.6,rz:size*.8});}
  }
  const data={trees,grass,flowers,rocks};cache.set(HOLE.id,data);return data;
}

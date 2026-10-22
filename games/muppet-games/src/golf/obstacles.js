import { HOLE } from './course.js';
import { courseScenery } from './scenery.js';
const indexes=new Map(),CELL=16;
export function courseObstacles(){
  if(indexes.has(HOLE.id))return indexes.get(HOLE.id);
  const {trees,rocks}=courseScenery(),shapes=[];
  for(const t of trees){
    shapes.push({id:t.id+'-trunk',type:'trunk',shape:'cylinder',x:t.x,y:t.y+t.h*.4,z:t.z,rx:.24,ry:t.h*.4,rz:.24});
    if(t.pine)for(let n=0;n<3;n++)shapes.push({id:t.id+'-canopy-'+n,type:'canopy',shape:'cone',x:t.x,y:t.y+t.h*(.5+n*.17),z:t.z,rx:t.h*(.31-n*.055),ry:t.h*.31,rz:t.h*(.31-n*.055)});
    else shapes.push({id:t.id+'-canopy',type:'canopy',shape:'ellipsoid',x:t.x,y:t.y+t.h*.8,z:t.z,rx:t.h*.42,ry:t.h*.48,rz:t.h*.39});
  }
  for(const r of rocks)shapes.push({...r,type:'rock',shape:'ellipsoid'});
  const grid=new Map();for(const s of shapes)for(let x=Math.floor((s.x-s.rx-.1)/CELL);x<=Math.floor((s.x+s.rx+.1)/CELL);x++)for(let z=Math.floor((s.z-s.rz-.1)/CELL);z<=Math.floor((s.z+s.rz+.1)/CELL);z++){const key=x+':'+z;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(s);}
  const result={shapes,grid};indexes.set(HOLE.id,result);return result;
}
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
// Sweep a ball through expanded obstacle surfaces instead of testing its endpoint.
// Trees use trunk cylinders and canopy cones/ellipsoids; rocks use ellipsoids.
export function sweepObstacle(from,to,s,radius=.021335){
  const radii=[s.rx+radius,s.ry+radius,s.rz+radius],centre=[s.x,s.y,s.z],o=from.map((v,i)=>(v-centre[i])/radii[i]),d=to.map((v,i)=>(v-from[i])/radii[i]);
  let a,b,c;
  if(s.shape==='ellipsoid'){a=dot(d,d);b=2*dot(o,d);c=dot(o,o)-1;}
  else{const cone=s.shape==='cone',k=cone?.5:0,q=cone?(1-o[1])*.5:1;a=d[0]**2+d[2]**2-(k*d[1])**2;b=2*(o[0]*d[0]+o[2]*d[2]+q*k*d[1]);c=o[0]**2+o[2]**2-q*q;}
  const candidates=[];
  if(Math.abs(a)<1e-12){if(Math.abs(b)>1e-12)candidates.push(-c/b);}else{const disc=b*b-4*a*c;if(disc>=0){const q=Math.sqrt(disc);candidates.push((-b-q)/(2*a),(-b+q)/(2*a));}}
  if(s.shape!=='ellipsoid'&&Math.abs(d[1])>1e-12)for(const cap of[-1,1]){const t=(cap-o[1])/d[1],x=o[0]+d[0]*t,z=o[2]+d[2]*t,rr=s.shape==='cone'?(1-cap)*.5:1;if(x*x+z*z<=rr*rr)candidates.push({t,cap});}
  candidates.sort((a,b)=>(a.t??a)-(b.t??b));
  for(const candidate of candidates){const t=candidate.t??candidate;if(t<0||t>1)continue;const p=o.map((v,i)=>v+d[i]*t);if(s.shape!=='ellipsoid'&&(p[1]<-1.00001||p[1]>1.00001))continue;
    let n=candidate.cap!==undefined?[0,candidate.cap,0]:s.shape==='ellipsoid'?p:[p[0],s.shape==='cone'?(1-p[1])*.25:0,p[2]];
    n=n.map((v,i)=>v/radii[i]);const length=Math.hypot(...n)||1;n=n.map(v=>v/length);
    if(dot(to.map((v,i)=>v-from[i]),n)>=0)continue;
    return {t,normal:n,obstacle:s};
  }
  return null;
}
export function collideObstacles(ball,from,radius){
  const to=[ball.x,ball.y,ball.z],{grid}=courseObstacles(),candidates=new Set();
  for(let x=Math.floor((Math.min(from[0],to[0])-radius)/CELL);x<=Math.floor((Math.max(from[0],to[0])+radius)/CELL);x++)for(let z=Math.floor((Math.min(from[2],to[2])-radius)/CELL);z<=Math.floor((Math.max(from[2],to[2])+radius)/CELL);z++)for(const s of grid.get(x+':'+z)||[])candidates.add(s);
  let first=null;for(const s of candidates){const hit=sweepObstacle(from,to,s,radius);if(hit&&(!first||hit.t<first.t))first=hit;}
  if(!first)return false;
  const {normal:n,obstacle:s,t}=first,v=[ball.vx,ball.vy,ball.vz],incoming=Math.hypot(...v),vn=dot(v,n),e=s.type==='rock'?.6:s.type==='trunk'?.42:.08,retention=s.type==='canopy'?.55:.84;
  const response=v.map((value,i)=>(value-vn*n[i])*retention-vn*e*n[i]);
  [ball.x,ball.y,ball.z]=from.map((value,i)=>value+(to[i]-value)*t+n[i]*.003);
  [ball.vx,ball.vy,ball.vz]=response;ball.rpm*=s.type==='canopy'?.45:.7;
  if(ball.vy>.15)ball.rolling=false;
  ball.collisions??=[];if(ball.collisions.length<24&&(!ball.collisions.length||ball.collisions.at(-1).id!==s.id||ball.age-ball.collisions.at(-1).time>.25))ball.collisions.push({id:s.id,type:s.type,time:ball.age,speedBefore:incoming,speedAfter:Math.hypot(...response),x:ball.x,y:ball.y,z:ball.z});
  return true;
}

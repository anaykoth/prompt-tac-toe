import { launch, stepBall } from './model.js';
import { HOLE, clamp, distanceToPin, headingToPin, heightAt, slopeAt } from './course.js';

// The coach uses the game's actual rolling solver. No separate canned curve.
export function tracePutt(position, power, aim = 0, { ignoreCup = false } = {}) {
  const ball=launch({club:'putter',position,heading:headingToPin(position),power,aim});
  ball.ignoreCup=ignoreCup;
  const heading=headingToPin(position),distance=distanceToPin(position),f=[Math.sin(heading),-Math.cos(heading)],r=[Math.cos(heading),Math.sin(heading)];
  let crossing=null;
  const points=[{x:ball.x,z:ball.z}];
  for(let i=0;i<4800&&!ball.stopped;i++){
    const old={x:ball.x,z:ball.z},before=(old.x-position.x)*f[0]+(old.z-position.z)*f[1];
    stepBall(ball,1/120);
    const after=(ball.x-position.x)*f[0]+(ball.z-position.z)*f[1];
    if(crossing===null&&before<=distance&&after>=distance&&after>before){
      const t=(distance-before)/(after-before);
      crossing=(old.x+(ball.x-old.x)*t-HOLE.cup.x)*r[0]+(old.z+(ball.z-old.z)*t-HOLE.cup.z)*r[1];
    }
    if(i%12===0||ball.stopped)points.push({x:ball.x,z:ball.z});
  }
  return {ball,points,crossing};
}

export function puttingGuide(position) {
  const distance=distanceToPin(position),heading=headingToPin(position);
  const forward={x:Math.sin(heading),z:-Math.cos(heading)};
  const target={x:HOLE.cup.x+forward.x*.25,z:HOLE.cup.z+forward.z*.25};
  let power=clamp(Math.sqrt(1.1*(distance+.25))/4.6,.02,1),aim=0;
  const end=(p,a)=>tracePutt(position,p,a,{ignoreCup:true}).ball;
  // Solve for a square-faced stroke that would stop 25 cm beyond the cup.
  // The real cup remains active when drawing / playing the resulting putt.
  for(let i=0;i<10;i++){
    const b=end(power,aim),ex=target.x-b.x,ez=target.z-b.z;
    if(Math.hypot(ex,ez)<.003)break;
    const p=end(power+.001,aim),a=end(power,aim+.1);
    const px=(p.x-b.x)/.001,pz=(p.z-b.z)/.001,ax=(a.x-b.x)/.1,az=(a.z-b.z)/.1,det=px*az-pz*ax;
    if(Math.abs(det)<1e-7)break;
    power=clamp(power+clamp((ex*az-ez*ax)/det,-.15,.15),.02,.999);
    aim=clamp(aim+clamp((px*ez-pz*ex)/det,-8,8),-35,35);
  }
  const solved=end(power,aim),error=Math.hypot(solved.x-target.x,solved.z-target.z);
  // Aim at the cup crossing, not the eventual resting point: break continues
  // after the ball passes the hole, especially on the longer drills.
  for(let i=0;i<4;i++){
    const {crossing}=tracePutt(position,power,aim,{ignoreCup:true});
    if(crossing===null||Math.abs(crossing)<.001)break;
    aim=clamp(aim-Math.atan2(crossing,distance)*180/Math.PI,-35,35);
  }
  const trace=tracePutt(position,power,aim);
  return {power,aim,points:trace.points,available:error<.15&&trace.ball.holed,holed:trace.ball.holed,distance,
    rise:heightAt(HOLE.cup.x,HOLE.cup.z)-heightAt(position.x,position.z),
    offset:Math.tan(aim*Math.PI/180)*distance};
}

export function puttingRead(guide) {
  if(!guide?.available)return 'Read the slope dots and try a test stroke.';
  const pace=`${Math.round(guide.power*100)}% pace`;
  const aim=Math.abs(guide.offset)<.01?'straight':`${Math.round(Math.abs(guide.offset)*100)} cm ${guide.offset<0?'left':'right'} of cup`;
  return `${pace} · aim ${aim} · square face`;
}

export class PuttingCoach {
  constructor(view){this.view=view;this.key='';this.guide=null;this.visible=true;this.canvas=document.getElementById('putt-map');}
  update(round){
    const $=id=>document.getElementById(id),putting=round.club==='putter';
    $('putting-coach').hidden=!putting;$('course-map').hidden=putting;
    $('putting-drill-wrap').hidden=round.mode!=='putting';
    $('putting-drill').value=round.drill;$('putting-drill').disabled=!!round.ball&&!round.finished;
    if(!putting){this.view.setPuttGuide(null);return;}
    const origin=round.ball?.start||round.position,key=`${HOLE.id}:${origin.x}:${origin.z}`;
    if(key!==this.key){this.key=key;this.guide=puttingGuide(origin);}
    const g=this.guide;
    $('putt-read').textContent=puttingRead(g);
    $('putt-rise').textContent=Math.abs(g.rise)<.005?'LEVEL PUTT':`${Math.round(Math.abs(g.rise)*100)} CM ${g.rise>0?'UPHILL':'DOWNHILL'}`;
    $('putt-guide-toggle').textContent=this.visible?'HIDE GUIDE':'SHOW GUIDE';
    $('putt-guide-toggle').setAttribute('aria-pressed',this.visible);
    $('putt-guide-copy').disabled=!!round.ball&&!(round.finished&&round.ball.testSwing)||!g.available;
    this.view.setPuttGuide(this.visible&&g.available?g.points:null,key);
    this.draw(round,origin);
  }
  draw(round,origin){
    const c=this.canvas,g=c.getContext('2d'),w=c.width,h=c.height,guide=this.guide;
    const angle=headingToPin(origin),f={x:Math.sin(angle),z:-Math.cos(angle)},r={x:Math.cos(angle),z:Math.sin(angle)};
    const scale=(h-55)/Math.max(2,guide.distance+1),project=p=>{const dx=p.x-origin.x,dz=p.z-origin.z;return [w/2+(dx*r.x+dz*r.z)*scale,h-25-(dx*f.x+dz*f.z)*scale];};
    g.fillStyle='#153b30';g.fillRect(0,0,w,h);
    // Slope arrows are drawn in the player's current view, including reverse drills.
    for(let x=25;x<w;x+=35)for(let y=25;y<h-10;y+=35){
      const side=(x-w/2)/scale,ahead=(h-25-y)/scale,px=origin.x+r.x*side+f.x*ahead,pz=origin.z+r.z*side+f.z*ahead;
      const slope=slopeAt(px,pz),sx=-(slope.x*r.x+slope.z*r.z),sy=slope.x*f.x+slope.z*f.z,len=Math.hypot(sx,sy)||1,dx=sx/len*7,dy=sy/len*7;
      g.strokeStyle='#87ae7760';g.lineWidth=1;g.beginPath();g.moveTo(x-dx/2,y-dy/2);g.lineTo(x+dx/2,y+dy/2);g.lineTo(x+dx/2-dx*.4-dy*.3,y+dy/2-dy*.4+dx*.3);g.stroke();
    }
    const cup=project(HOLE.cup),ball=project(round.ball||origin),start=project(origin);
    g.setLineDash([3,5]);g.strokeStyle='#fff1c45c';g.beginPath();g.moveTo(...start);g.lineTo(...cup);g.stroke();g.setLineDash([]);
    if(this.visible&&guide.available){g.strokeStyle='#f1d376';g.lineWidth=2;g.beginPath();guide.points.forEach((p,i)=>{const xy=project(p);i?g.lineTo(...xy):g.moveTo(...xy);});g.stroke();}
    g.fillStyle='#091f1a';g.strokeStyle='#f1d376';g.lineWidth=2;g.beginPath();g.arc(...cup,5,0,Math.PI*2);g.fill();g.stroke();
    g.fillStyle='#fff8df';g.beginPath();g.arc(...ball,4,0,Math.PI*2);g.fill();
    g.font='11px sans-serif';g.fillStyle='#d0dcb9';g.fillText('ARROWS = DOWNHILL',10,15);
    if(round.ball?.stopped){g.fillStyle='#f1d376';g.fillText(round.ball.holed?'IN THE CUP':`${distanceToPin(round.ball).toFixed(2)} m from cup`,10,h-8);}
  }
}

import { swingQuality, swingAdvice } from './swing-quality.js';
const $=id=>document.getElementById(id),deg=x=>(x>0?'+':'')+x.toFixed(1)+'°';
const cream='#f4eed7',muted='#a8c1b0',gold='#efcd78',mint='#88dbc3',orange='#ff9c78';
export class SwingReview {
  constructor(){
    this.panel=$('shot-review');this.canvas=$('swing-model');this.ctx=this.canvas.getContext('2d');this.time=0;this.playing=false;this.report=null;
    $('shot-review-close').onclick=()=>this.panel.hidden=true;
    $('shot-review-toggle').onclick=()=>this.panel.hidden=!this.panel.hidden;
    $('swing-replay').onclick=()=>{this.time=0;this.playing=true;};
    $('swing-time').oninput=()=>{this.playing=false;this.time=Number($('swing-time').value)/1000*(this.report?.duration||1);this.draw();};
  }
  show(report,delivery,result=null){
    this.report=report;this.delivery=delivery;this.result=result;this.quality=delivery.feedback||swingQuality(report);this.advice=swingAdvice(report,this.quality);this.time=0;this.playing=true;this.panel.hidden=false;$('shot-review-toggle').hidden=false;
    $('swing-grade').textContent=`${report.grade} · ${Math.round(report.score*100)}/100`;
    $('swing-source').textContent=report.source==='demo'?'MOUSE SIMULATION / PRACTICE COACH':'YOUR PHONE / PRACTICE COACH';
    $('swing-shape').textContent=delivery.shape;
    $('swing-reason').textContent=`${report.club==='putter'?'Face controls the starting line; green slope controls break.':'Face versus path controls start and curve.'} ${this.quality.speedPenalty>.01?`Excess speed reduced estimated contact by ${Math.round(this.quality.speedPenalty*100)} points.`:'Controlled speed keeps more of the available power.'}`;
    $('swing-confidence').textContent=`${report.impactMethod==='address-return'?'Address return':'Speed-peak fallback'} · ${Math.round(report.confidence*100)}% model confidence · tempo ${report.tempo.toFixed(2)}:1 · angular jerk ${(report.angularJerk/1000).toFixed(1)}k °/s³${report.linearJerk===null?' · no linear acceleration':''}`;
    this.draw();
  }
  finish(ball,result){if(this.report!==ball.analysis)return;this.result={...result,collisions:ball.collisions||[]};this.draw();}
  tick(dt){if(this.report&&this.playing){this.time=Math.min(this.report.duration,this.time+dt*1000*.35);if(this.time>=this.report.duration)this.playing=false;}if(!this.panel.hidden)this.draw();}
  draw(){
    const g=this.ctx,w=this.canvas.width,h=this.canvas.height;g.fillStyle='#102e28';g.fillRect(0,0,w,h);
    if(!this.report)return;
    const r=this.report,q=this.quality,trace=r.trace;
    const text=(value,x,y,size=14,color=muted,bold=false)=>{g.fillStyle=color;g.font=`${bold?'bold ':''}${size}px sans-serif`;g.fillText(value,x,y);};
    const line=(a,b,color=muted,width=2)=>{g.strokeStyle=color;g.lineWidth=width;g.beginPath();g.moveTo(...a);g.lineTo(...b);g.stroke();};
    const circle=(x,y,r,color,fill=false)=>{g.beginPath();g.arc(x,y,r,0,Math.PI*2);g[fill?'fillStyle':'strokeStyle']=color;fill?g.fill():g.stroke();};
    const wrap=(value,x,y,max,size=15,color=cream)=>{let row='';g.font=`${size}px sans-serif`;for(const word of value.split(' ')){const next=row?row+' '+word:word;if(g.measureText(next).width>max){text(row,x,y,size,color);y+=21;row=word;}else row=next;}text(row,x,y,size,color);};
    // Three views describe one impact in the same locked target frame.
    for(const x of[356,716])line([x,24],[x,288],'#355449',1);
    text('01 / SWING PATH',24,31,14,cream,true);text('02 / LOCKED TARGET',380,31,14,cream,true);text('03 / VIRTUAL CONTACT',740,31,14,cream,true);
    const project=p=>[171+p[1]*83+p[3]*42,145-p[2]*78+p[3]*12];
    g.strokeStyle='#355f4e';g.beginPath();g.ellipse(171,223,109,24,0,0,Math.PI*2);g.stroke();
    for(let i=1;i<trace.length;i++){g.globalAlpha=trace[i][0]<=this.time?1:.25;line(project(trace[i-1]),project(trace[i]),trace[i][0]<r.backswingMs?gold:mint,3);}g.globalAlpha=1;
    let at=trace.find(p=>p[0]>=this.time)||trace.at(-1);const tip=project(at);line([171,145],tip,cream,5);circle(...tip,7,orange,true);
    const impact=trace.reduce((a,b)=>Math.abs(b[0]-r.impactMs)<Math.abs(a[0]-r.impactMs)?b:a);circle(...project(impact),12,orange);
    text('GOLD: BACK   MINT: THROUGH',24,265,12);text(`Plane variation ${r.planeError.toFixed(1)}°`,24,284,13);
    const origin=[534,217],arrow=(angle,color,length,width=3)=>{const a=angle*Math.PI/180,end=[origin[0]+Math.sin(a)*length,origin[1]-Math.cos(a)*length];line(origin,end,color,width);circle(...end,4,color,true);};
    g.setLineDash([5,6]);arrow(0,'#6e8f7b',156,1);g.setLineDash([]);arrow(r.path,mint,140);arrow(this.delivery.startAngle,gold,153);
    const f=r.face*Math.PI/180;line([origin[0]-Math.cos(f)*34,origin[1]-Math.sin(f)*34],[origin[0]+Math.cos(f)*34,origin[1]+Math.sin(f)*34],orange,7);
    text(`PATH ${deg(r.path)}`,380,265,15,mint,true);text(`FACE ${deg(r.face)}`,552,265,15,orange,true);text(`Face − path ${deg(r.faceToPath)} → ${this.delivery.shape.toLowerCase()}`,380,284,12);
    const cx=887,cy=146;g.fillStyle='#2e5045';g.fillRect(cx-102,cy-53,204,106);g.strokeStyle='#6c8c76';g.strokeRect(cx-102,cy-53,204,106);
    for(let y=-38;y<=38;y+=13)line([cx-88,cy+y],[cx+88,cy+y],'#8ca68e77',1);
    g.setLineDash([3,5]);circle(cx,cy,32,'#bed0b0');g.setLineDash([]);circle(cx+q.contactX*78,cy-q.contactY*37,10,q.contact>.75?mint:orange,true);
    text(`${Math.round(q.contact*100)}% CONTACT`,740,238,25,q.contact>.75?mint:orange,true);text('Estimated transfer / face strike',740,261,13);text('A game model, not measured contact',740,282,12);
    line([24,305],[1056,305],'#355449',1);
    text('PHONE ROTATION SPEED',24,333,14,cream,true);text(`${Math.round(q.peakSpeed)}°/s`,24,366,29,q.overSpeed>.1?orange:gold,true);
    text(q.overSpeed>.1?`${Math.round((q.speedRatio-1)*100)}% above the game’s power range`:`Game power range: up to ${q.speedLimit}°/s`,192,359,14,q.overSpeed>.1?orange:muted);
    const left=24,right=687,top=385,bottom=470,max=Math.max(q.speedLimit*1.2,...trace.map(p=>p[4]));
    const xy=p=>[left+p[0]/Math.max(1,r.duration)*(right-left),bottom-p[4]/max*(bottom-top)];
    g.fillStyle='#ef956217';const limitY=bottom-q.speedLimit/max*(bottom-top);g.fillRect(left,top,right-left,limitY-top);
    g.setLineDash([4,5]);line([left,limitY],[right,limitY],'#dca46d',1);g.setLineDash([]);
    for(let i=1;i<trace.length;i++)line(xy(trace[i-1]),xy(trace[i]),trace[i][4]>q.speedLimit?orange:gold,2);
    const impactX=left+r.impactMs/Math.max(1,r.duration)*(right-left);line([impactX,top],[impactX,bottom],mint,1);text('IMPACT',Math.min(impactX+6,620),top+12,11,mint);
    const bar=(title,value,y,detail)=>{text(title,740,y,14,cream,true);text(`${Math.round(value*100)}%`,995,y,18,value>.75?mint:orange,true);g.fillStyle='#355449';g.fillRect(740,y+12,300,7);g.fillStyle=value>.75?mint:value>.5?gold:orange;g.fillRect(740,y+12,300*value,7);text(detail,740,y+40,12);};
    bar('SWING CONTROL',q.control,337,'Smoothness + plane + face stability');bar('SMOOTH ACCELERATION',r.smoothness,412,`Face variation ${r.faceStability.toFixed(1)}° · closure ${Math.round(r.closureRate)}°/s`);
    g.fillStyle='#26473a';g.fillRect(16,491,1048,66);text('NEXT REP',30,515,11,gold,true);text(this.advice.title,115,515,18,cream,true);wrap(this.advice.text,30,539,1010,14,muted);
    const result=this.result,collisions=result?.collisions||[];
    $('swing-outcome').textContent=result?`${result.total?.toFixed(1)||'—'} m · ${result.holed?'HOLED':(result.lie||'').toUpperCase()}${collisions.length?' · HIT '+[...new Set(collisions.map(c=>c.type==='canopy'?'BRANCHES':c.type.toUpperCase()))].join(' + '):''}`:'Watch the ball, then compare the result.';
    $('swing-time').value=this.time/Math.max(1,r.duration)*1000;$('swing-time-label').textContent=(this.time/1000).toFixed(2)+' s';
  }
}

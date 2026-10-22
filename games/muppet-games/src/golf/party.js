import { GolfRound } from './model.js';

/** Each phone owns a ball and score. The display chooses who may play it. */
export class GolfParty {
  constructor(){this.players=new Map();this.activeId=null;this.practice=new GolfRound();}
  get round(){return this.players.get(this.activeId)?.round||this.practice;}
  sync(roster){
    const initial=this.round;
    for(const p of roster){
      if(!this.players.has(p.id)){
        const round=this.players.size===0?initial:new GolfRound();
        if(round!==initial)round.reset(initial.mode,initial.drill);
        this.players.set(p.id,{...p,round});
      }else Object.assign(this.players.get(p.id),p);
    }
    for(const id of this.players.keys())if(!roster.some(p=>p.id===id))this.players.delete(id);
    if(!this.players.has(this.activeId))this.activeId=this.players.keys().next().value||null;
  }
  select(id){
    if(this.round.ball&&!this.round.finished||!this.players.has(id))return false;
    this.activeId=id;if(this.round.finished&&!this.round.holed)this.round.next();return true;
  }
  next(){
    if(!this.round.finished)return;
    if(this.round.ball?.testSwing){this.round.next();return;}
    if(this.players.size<2){this.round.next();return;}
    const current=this.round;
    if(!current.holed)current.next();
    const waiting=[...this.players.values()].filter(p=>p.online&&!p.round.holed);
    // Everyone tees off before approaching. Then the ball farthest from the pin plays.
    waiting.sort((a,b)=>a.round.shots===0&&b.round.shots!==0?-1:b.round.shots===0&&a.round.shots!==0?1:b.round.toPin-a.round.toPin);
    if(waiting.length){this.activeId=waiting[0].id;const r=this.round;if(r.finished&&!r.holed)r.next();}
  }
  reset(mode,drill){this.practice.reset(mode,drill);for(const p of this.players.values())p.round.reset(mode,drill);}
}

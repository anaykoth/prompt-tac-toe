/** Bounded persistent outbox. Retry only while paired to the same room. */
export class ShotJournal {
  constructor(link,role,onUpdate=()=>{}){
    this.link=link;this.role=role;this.onUpdate=onUpdate;this.key=`felt-fairway:shot-outbox:${role}`;this.pending=[];this.status='Shot tracking ready';this.records=[];this.sending=false;
    try{const p=JSON.parse(localStorage.getItem(this.key)||'[]');if(Array.isArray(p))this.pending=p.slice(-100);}catch{}
    this.timer=setInterval(()=>this.flush(),5000);
  }
  persist(){try{localStorage.setItem(this.key,JSON.stringify(this.pending));return true;}catch{this.status='Browser storage is full. Keep this page open while shots upload.';return false;}}
  enqueue(event){
    const room=this.link.credentials?.room;if(!room)return false;
    const entry={room,event},index=this.pending.findIndex(p=>p.room===room&&p.event.id===event.id&&p.event.kind===event.kind&&p.event.playerId===event.playerId);
    if(index>=0)this.pending[index]=entry;else if(this.pending.length<100)this.pending.push(entry);else{this.status='Tracking queue is full. Export pending data before taking more shots.';this.onUpdate();return false;}
    this.status='Saving shot data…';this.persist();this.onUpdate();this.flush();return true;
  }
  async request(method,body){
    const c=this.link.credentials,controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),6000);
    try{const response=await fetch(`/phone-shots?room=${encodeURIComponent(c.room)}`,{method,headers:{Authorization:`Bearer ${c.token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});const data=await response.json();if(!response.ok)throw Error(data.error||'Shot data unavailable');return data;}finally{clearTimeout(timeout);}
  }
  async flush(){
    if(this.sending||!this.link.connected)return;
    this.sending=true;
    try{
      while(this.link.connected){
        const entry=this.pending.find(p=>p.room===this.link.credentials.room);if(!entry)break;
        const data=await this.request('POST',entry.event);
        this.pending=this.pending.filter(p=>p!==entry);this.persist();
        if(data.record)this.merge([data.record]);
      }
      this.status=this.pending.length?`${this.pending.length} pending events from an earlier session — export to keep them.`:'Saved on this computer';
    }catch(error){this.status=`Not saved yet: ${error.message}. Retrying; pending data stays in this browser.`;}
    finally{this.sending=false;this.onUpdate();}
  }
  merge(records){this.refreshTicket=(this.refreshTicket||0)+1;const all=new Map(this.records.map(r=>[`${r.playerId}/${r.id}`,r]));for(const r of records)all.set(`${r.playerId}/${r.id}`,r);this.records=[...all.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).slice(-500);}
  async refresh(){
    if(!this.link.connected)return;
    const ticket=this.refreshTicket=(this.refreshTicket||0)+1;
    try{const data=await this.request('GET');if(ticket!==this.refreshTicket)return;this.records=data.records;this.onUpdate();}catch(error){this.status=error.message;this.onUpdate();}
  }
  welcome(){this.records=[];this.flush();this.refresh();}
  export(){return {format:'felt-fairway-shot-history',version:1,exportedAt:new Date().toISOString(),records:this.records,pending:this.pending};}
}

import fs from 'node:fs';
import path from 'node:path';
import { SHOT_MODEL, validateShotEvent, signalMetrics } from '../src/golf/shot-data.js';

/** Disk is the durable source; the room map only indexes authorized live records. */
export class ShotStore {
  constructor(directory){this.directory=directory;}
  save(room,actor,event){
    if(!validateShotEvent(event))throw Error('Invalid shot data.');
    const {kind,id,data}=event;
    if(actor.role==='controller'&&!['attempt','feedback'].includes(kind))throw Error('Only the display records ball flight.');
    if(actor.role==='host'&&kind==='attempt')throw Error('Only the phone records sensor attempts.');
    const playerId=actor.role==='controller'?actor.id:kind==='launch'?data.playerId:event.playerId;
    if(typeof playerId!=='string'||!/^[\w-]{1,64}$/.test(playerId))throw Error('Invalid player.');
    const key=`${playerId}-${id}`,old=room.shotRecords.get(key);
    if(kind==='feedback'&&!old)throw Error('Save the swing before rating it.');
    if(kind==='result'&&!old?.launch)throw Error('Save the launch before its result.');
    if(!old&&room.shotRecords.size>=500)throw Error('This session has 500 attempts. Start a new session to record more.');
    // Attempt/launch/result are immutable and idempotent; feedback may be revised.
    if(old?.[kind]&&kind!=='feedback')return old;
    const record=structuredClone(old||{version:1,session:room.sessionId,room:room.code,id,playerId,playerName:actor.name||data.playerName||'Practice',source:actor.role==='controller'?'phone':data.source,model:SHOT_MODEL,units:'Raw sample t, heldMs and offsetMs: milliseconds; gyro alpha,beta,gamma: degrees/s; orientation: degrees; acceleration: m/s² in device frame, null when unavailable. Trajectory: seconds,x,y,z,rolling in metres. Delivery angles: degrees; speed: m/s; spin: rpm. Lateral positive is right of the chosen aim. Return path and contact are virtual-model estimates.',createdAt:new Date().toISOString()});
    if(kind==='launch'&&old?.source&&old.source!==data.source)throw Error('Shot source does not match its attempt.');
    if(kind==='attempt'&&old?.source==='demo')throw Error('A simulated shot cannot receive phone sensor data.');
    record[kind]=structuredClone(data);record.updatedAt=new Date().toISOString();
    if(kind==='attempt')record.signal=signalMetrics(data.samples);
    const filename=`${room.sessionId}-${key}.json`;fs.mkdirSync(this.directory,{recursive:true});
    fs.writeFileSync(path.join(this.directory,filename+'.tmp'),JSON.stringify(record,null,2)+'\n',{mode:0o600});fs.renameSync(path.join(this.directory,filename+'.tmp'),path.join(this.directory,filename));
    room.shotRecords.set(key,record);return record;
  }
}
export function shotSummary(record){const copy=structuredClone(record);if(copy.attempt)delete copy.attempt.samples;return copy;}

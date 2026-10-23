import { LiveLink as SharedLink, SeenIds } from '../../../shared/net/live.js';
export const AIM_MS=45;
export class LiveLink extends SharedLink {
  constructor({seat,onAim=()=>{},onLaunch=()=>{},onChanged=()=>{},onPresence=()=>{},onStatus=()=>{},token,room}={}){
    super({channel:'splinter-alley-live',seat,token,room,on:{aim:onAim,launch:onLaunch,changed:onChanged},rate:{aim:AIM_MS},onPresence,onStatus});
  }
  sendAim(p){return this.send('aim',p);}
  sendLaunch(launch){return this.send('launch',{launch});}
  sendChanged(){return this.send('changed',{});}
}
export class SeenSeeds extends SeenIds {}

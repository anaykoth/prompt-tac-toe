import { RoomClient } from '../room/client.js';
import { PubScene, LOCALS, TABLES } from './scene.js';

const $ = id => document.getElementById(id);
const client = new RoomClient();
const scene = new PubScene($('pub-scene'), $('name-labels'));
const dialog = $('rps-dialog');
const HANDS = { rock: '✊', paper: '✋', scissors: '✌' };
const LINES = {
  'npc-pierre': 'Pierre considers every round a matter of historical importance.',
  'npc-dot': 'Dot has been watching everyone’s hands. She says nothing.',
  'npc-basil': 'Basil describes his strategy as “largely geological.”',
  'npc-nell': 'Nell is very gracious about winning. Less so about everything else.',
};
let state = null, nearby = null, opponentId = null, challenge = null, round = null;
let connectedOnce = false, awaitingResult = false, selectedChoice = null, toastTimer, resultTimer;
let currentResultId = null, lastRoster = '', lastPacket = 0, lastNear = 0, currentResult = null;
let audio;
const query = new URLSearchParams(location.search);
const suppliedRoom = (query.get('room') || '').toUpperCase();
try { $('player-name').value = localStorage.getItem('muppet-pub:name') || localStorage.getItem('muppet-room-name') || 'Guest'; } catch { /* optional */ }
if (suppliedRoom) { $('join-fields').hidden = false; $('join-code').value = suppliedRoom; $('create-room').textContent = 'JOIN THIS ROOM →'; }

function notify(text) {
  $('toast').textContent = text; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4500);
}
function people() { return [...(state?.players || []), ...(state?.npcs || LOCALS)]; }
function person(id) { return people().find(p => p.id === id); }
function me() { return person(client.id); }
function beep(win = false) {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume();
    for (const [i, frequency] of (win ? [392, 494, 587] : [247, 220]).entries()) {
      const oscillator = audio.createOscillator(), gain = audio.createGain(), start = audio.currentTime + i * .085;
      oscillator.type = 'sine'; oscillator.frequency.value = frequency; gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(.07, start + .01); gain.gain.exponentialRampToValueAtTime(.0001, start + .2);
      oscillator.connect(gain).connect(audio.destination); oscillator.start(start); oscillator.stop(start + .22);
    }
  } catch { /* Sound is optional. */ }
}

async function connect(create) {
  const name = $('player-name').value.trim() || 'Guest';
  const code = $('join-code').value.trim().toUpperCase();
  if (!create && !code) { $('entry-message').textContent = 'Enter your friend’s room code.'; $('join-code').focus(); return; }
  $('create-room').disabled = $('join-room').disabled = true;
  $('entry-message').textContent = create ? 'Opening the doors…' : 'Finding your friends…';
  try {
    localStorage.setItem('muppet-pub:name', name);
  } catch { /* optional */ }
  try { await client.connect({ name, room: create ? undefined : code, create }); }
  catch (error) { $('entry-message').textContent = error.message; }
  finally { $('create-room').disabled = $('join-room').disabled = false; }
}

function enter(welcome) {
  connectedOnce = true;
  $('welcome').hidden = true; $('room-panel').hidden = false; $('room-tools').hidden = false;
  $('room-code').textContent = welcome.room; $('connection-state').textContent = 'LIVE';
  $('connection-state').style.color = '';
  history.replaceState(null, '', `${location.pathname}?room=${encodeURIComponent(welcome.room)}`);
  $('join-code').value = welcome.room;
  $('hockey-link').href = `/air-hockey.html?room=${encodeURIComponent(welcome.room)}`;
  $('pool-link').href = `/pool.html?room=${encodeURIComponent(welcome.room)}`;
  $('baseball-link').href = `/baseball.html?room=${encodeURIComponent(welcome.room)}`;
  scene.active = true;
  updateState(welcome.state);
  const desiredName = $('player-name').value.trim() || 'Guest';
  if (me()?.name !== desiredName) client.send('name', { name: desiredName });
  notify(`Welcome, ${me()?.name || 'friend'}. Click the floor to walk, or use WASD.`);
}

function updateState(next) {
  state = next;
  scene.setCharacters(people(), client.id);
  $('balance').textContent = String(me()?.coins ?? 0);
  const rosterKey = JSON.stringify((state.players || []).map(p => [p.id, p.name, p.online, p.activity]));
  if (rosterKey !== lastRoster) {
    lastRoster = rosterKey; $('roster').replaceChildren();
    for (const p of state.players || []) {
      if (!p.online) continue;
      const row = document.createElement('div'); row.className = 'roster-row';
      const dot = document.createElement('span'); dot.className = 'avatar-dot';
      const name = document.createElement('span'); name.textContent = p.name;
      const detail = document.createElement('small'); detail.textContent = p.id === client.id ? 'YOU' : p.activity === 'air-hockey' ? 'AT TABLE' : 'IN THE PUB';
      row.append(dot, name, detail); $('roster').append(row);
    }
    const locals = document.createElement('div'); locals.className = 'roster-row';
    locals.textContent = '＋ Four familiar faces'; $('roster').append(locals);
  }
  const mine = (state.rounds || []).find(r => (r.participants || r.participantIds).includes(client.id));
  if (mine) {
    if (round?.id !== mine.id) showRound(mine);
    else { round = mine; updateLocked(); }
  } else if (round && !currentResult) {
    const missed = (state.results || []).find(result => result.roundId === round.id);
    if (missed) receiveResult(missed);
    else { round = null; awaitingResult = false; closeDialog(); notify('That round has ended. Your balance is up to date.'); }
  }
  const pending = (state.challenges || []).find(c => c.participants.includes(client.id));
  if (!mine && pending && challenge?.id !== pending.id) showChallenge(pending);
  else if (!pending && challenge && !mine) {
    challenge = null; closeDialog(); notify('That offer is no longer open.');
  }
}

function openDialog() { scene.stop();scene.active=false;if(!dialog.open)dialog.showModal(); }
function closeDialog() { dialog.close();scene.active=client.connected;scene.stop(); }
function hidePanels() { for (const id of ['stake-panel','accept-panel','choice-panel','result-panel']) $(id).hidden=true; }
function openOpponent(id) {
  if (round && !currentResult) { showRound(round); return; }
  const opponent = person(id);if(!opponent)return;
  opponentId=id;challenge=null;round=null;currentResult=null;selectedChoice=null;awaitingResult=false;clearTimeout(resultTimer);
  hidePanels();$('stake-panel').hidden=false;
  $('rps-title').textContent = `YOU & ${opponent.name.toUpperCase()}`;
  $('rps-subtitle').textContent=LINES[id]||'A friendly wager. Both hands stay secret until the reveal.';
  $('rps-fineprint').textContent='Pub coins have no cash value. Both stakes are held until the round ends.';
  $('offer-stake').disabled=false;updateStake();openDialog();
}
function updateStake() {
  const max=Math.min(1000,me()?.coins??0,person(opponentId)?.coins??0);
  $('stake').max=String(max);
  const raw=Number($('stake').value);
  const valid=Number.isInteger(raw)&&raw>=1&&raw<=max;
  $('offer-stake').textContent=valid?`OFFER ${raw} COINS →`:max<1?'NO COINS LEFT':`CHOOSE 1–${max} COINS`;
  $('offer-stake').disabled=!valid||!client.connected;
  document.querySelectorAll('[data-stake]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.stake)===raw));
}
function offer() {
  updateStake();if($('offer-stake').disabled)return;
  const p=scene.position;if(p)client.send('move',{x:p.x,y:p.z,yaw:scene.yaw});
  if(client.send('rps.challenge',{targetId:opponentId,stake:Number($('stake').value)})){
    $('offer-stake').disabled=true;$('rps-subtitle').textContent='Making your offer…';
  }
}
function showChallenge(packet) {
  if(!packet.participants.includes(client.id))return;
  challenge=packet;
  const incoming=packet.targetId===client.id;
  opponentId=incoming?packet.fromId:packet.targetId;
  hidePanels();openDialog();
  $('rps-title').textContent=`YOU & ${(person(opponentId)?.name||'A FRIEND').toUpperCase()}`;
  if(incoming){
    $('accept-panel').hidden=false;$('rps-subtitle').textContent='Somebody thinks they can read you.';
    $('offer-description').textContent=`${person(opponentId)?.name||'Your friend'} offers ${packet.stake} coins each. Winner takes the pot; a draw returns both stakes.`;
  }else{
    $('rps-subtitle').textContent=`Waiting for ${person(opponentId)?.name||'your friend'} to accept ${packet.stake} coins. Close to withdraw your offer.`;
  }
}
function showRound(packet) {
  const ids=packet.participants||packet.participantIds;if(!ids.includes(client.id))return;
  if(round?.id!==packet.id){selectedChoice=null;currentResult=null;awaitingResult=false;currentResultId=null;}
  round=packet;challenge=null;opponentId=ids.find(id=>id!==client.id);
  hidePanels();$('choice-panel').hidden=false;dialog.classList.remove('locked');openDialog();
  $('rps-title').textContent='ROCK. PAPER. SCISSORS.';
  $('rps-subtitle').textContent=`${packet.stake} coins each · ${packet.stake*2} in the pot`;
  $('their-name').textContent=person(opponentId)?.name||'YOUR FRIEND';
  $('my-hand').textContent=selectedChoice?HANDS[selectedChoice]:'?';$('their-hand').textContent='?';$('duel-vs').textContent='VS';
  updateLocked();
}
function updateLocked() {
  if(!round||currentResult)return;
  const ids=round.participants||round.participantIds;
  const index=ids.indexOf(client.id),locked=Boolean(round.locked?.[index]);
  const theirs=Boolean(round.locked?.[1-index]);
  document.querySelectorAll('[data-choice]').forEach(button=>{
    button.disabled=locked||awaitingResult;
    button.classList.toggle('selected',button.dataset.choice===selectedChoice);
  });
  if(locked||awaitingResult){$('round-status').textContent='Your hand is locked. Waiting for the other hand…';dialog.classList.add('locked');}
  else $('round-status').textContent=theirs?'Their hand is locked. Choose yours.':'Choose your hand. It stays secret until both are locked.';
}
function choose(choice) {
  if(!round||currentResult||awaitingResult)return;
  const ids=round.participants||round.participantIds;if(round.locked?.[ids.indexOf(client.id)])return;
  selectedChoice=choice;awaitingResult=true;$('my-hand').textContent=HANDS[choice];updateLocked();
  if(!client.send('rps.choose',{roundId:round.id,choice})){awaitingResult=false;notify('Your connection closed. Rejoin to resume.');}
}
function receiveResult(packet) {
  if(!packet.participantIds?.includes(client.id)||currentResultId===packet.roundId)return;
  currentResultId=packet.roundId;currentResult=packet;awaitingResult=false;
  opponentId=packet.participantIds.find(id=>id!==client.id);
  clearTimeout(resultTimer);hidePanels();$('choice-panel').hidden=false;openDialog();
  $('rps-title').textContent='ROCK. PAPER. SCISSORS.';$('their-name').textContent=person(opponentId)?.name||'YOUR FRIEND';
  document.querySelectorAll('[data-choice]').forEach(b=>b.disabled=true);
  if(packet.reason==='played'){
    $('my-hand').textContent=$('their-hand').textContent='✊';dialog.classList.add('locked');
    let beat=0;const beats=['ROCK','PAPER','SCISSORS'];
    const advance=()=>{
      if(currentResultId!==packet.roundId)return;
      if(beat<beats.length){$('duel-vs').textContent=beats[beat++];$('round-status').textContent='Both hands are locked. Here we go…';resultTimer=setTimeout(advance,430);}
      else reveal(packet);
    };advance();
  }else reveal(packet);
}
function reveal(packet) {
  const mine=packet.participantIds.indexOf(client.id),won=packet.winnerId===client.id;
  dialog.classList.remove('locked');$('duel-vs').textContent='VS';
  $('my-hand').textContent=HANDS[packet.choices[mine]]||'—';$('their-hand').textContent=HANDS[packet.choices[1-mine]]||'—';
  $('result-panel').hidden=false;
  $('round-status').textContent=packet.reason==='played'?`${packet.choices[mine].toUpperCase()} / ${packet.choices[1-mine].toUpperCase()}`:'The stakes have been returned.';
  const draw=!packet.winnerId;
  $('result-title').textContent=packet.reason!=='played'?'STAKES RETURNED':draw?'GREAT MINDS.':won?`YOURS. +${packet.stake} COINS`:`THEIRS. −${packet.stake} COINS`;
  $('result-copy').textContent=packet.reason!=='played'?'The round ended before both hands were ready. Nobody loses coins.':draw?'The same hand. Both stakes returned. Obviously a rematch.':won?'A very small fortune. A very large reaction.':'They are going to be unbearable about this.';
  $('play-again').disabled=!client.connected;
  for(const[id,a]of scene.actors){if(id===client.id||id===opponentId)a.puppet.react(draw?.3:id===packet.winnerId?1.1:-.4);}
  beep(won||draw);
  round=null;
}

client.on(packet=>{
  switch(packet.type){
    case 'welcome':enter(packet);break;
    case 'state':updateState(packet);break;
    case 'rps.challenge':showChallenge(packet);break;
    case 'rps.round':if((packet.participants||[]).includes(client.id)){if(round?.id===packet.id){round=packet;updateLocked();}else showRound(packet);}break;
    case 'rps.result':receiveResult(packet);break;
    case 'rps.cancelled':if(challenge?.id===packet.challengeId){challenge=null;closeDialog();notify(packet.reason==='timeout'?'That offer expired. Try another Muppet.':packet.reason==='disconnect'?'The other player left the room. No coins were taken.':'The challenge was declined.');}break;
    case 'error':notify(packet.message);if(dialog.open){$('rps-subtitle').textContent=packet.message;awaitingResult=false;updateStake();}break;
    case 'disconnected':
      clearTimeout(resultTimer);round=null;challenge=null;currentResult=null;currentResultId=null;selectedChoice=null;awaitingResult=false;
      if(dialog.open)dialog.close();dialog.classList.remove('locked');
      scene.active=false;scene.stop();$('connection-state').textContent='OFFLINE';$('connection-state').style.color='#ffad85';
      notify(packet.message);$('entry-message').textContent=packet.message;$('welcome').hidden=false;$('join-fields').hidden=false;$('create-room').textContent='REJOIN YOUR ROOM →';
      break;
  }
});

$('entry-form').addEventListener('submit',event=>{event.preventDefault();connect(!(suppliedRoom||connectedOnce));});
$('show-join').onclick=()=>{$('join-fields').hidden=!$('join-fields').hidden;if(!$('join-fields').hidden)$('join-code').focus();};
$('join-room').onclick=()=>connect(false);
$('invite').onclick=async()=>{
  const url=`${location.origin}/pub.html?room=${encodeURIComponent(client.room)}`;
  try{await navigator.clipboard.writeText(url);notify('Invitation copied. Friends on another computer need the host’s LAN address.');}
  catch{notify(`Room ${client.room} — share the address in your browser.`);}
};
$('leave-room').onclick=()=>{client.close();scene.stop();location.href='/pub.html';};
$('rps-close').onclick=()=>{if(challenge)client.send('rps.decline',{challengeId:challenge.id});closeDialog();};
dialog.addEventListener('cancel',event=>{event.preventDefault();$('rps-close').click();});
$('stake').addEventListener('input',updateStake);
document.querySelectorAll('[data-stake]').forEach(b=>b.onclick=()=>{$('stake').value=b.dataset.stake;updateStake();});
$('offer-stake').onclick=offer;
$('accept-stake').onclick=()=>{if(challenge)client.send('rps.accept',{challengeId:challenge.id});};
$('decline-stake').onclick=()=>{if(challenge)client.send('rps.decline',{challengeId:challenge.id});closeDialog();};
document.querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>choose(b.dataset.choice));
$('play-again').onclick=()=>openOpponent(opponentId);

function interact(){
  if(!client.connected)return;
  if(round&&!currentResult){showRound(round);return;}
  if(!nearby)return;
  if(nearby.href)location.href=`${nearby.href}?room=${encodeURIComponent(client.room)}`;
  else openOpponent(nearby.id);
}
$('interact').onclick=interact;
addEventListener('keydown',event=>{
  if(event.target.closest('input,textarea,select'))return;
  const key=event.key.toLowerCase();
  if(dialog.open){if(['1','2','3'].includes(key)){event.preventDefault();choose(['rock','paper','scissors'][Number(key)-1]);}return;}
  if(!scene.active)return;
  if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','e'].includes(key))event.preventDefault();
  scene.keys.add(key);if(key==='e'&&!event.repeat)interact();
});
addEventListener('keyup',event=>scene.keys.delete(event.key.toLowerCase()));
addEventListener('blur',()=>scene.stop());
$('pub-scene').addEventListener('pointerdown',event=>{
  if(!scene.active||dialog.open)return;
  const picked=scene.pick(event);if(!picked)return;
  if(picked.actorId){
    const actor=person(picked.actorId),p=scene.position;if(!actor||!p)return;
    const dx=p.x-actor.x,dz=p.z-(actor.y??actor.z),dist=Math.hypot(dx,dz);
    if(dist<2.2)openOpponent(actor.id);
    else{scene.moveTo({x:actor.x+(dx/dist)*1.5,z:(actor.y??actor.z)+(dz/dist)*1.5});notify(`Walk over to ${actor.name}, then press E.`);}
  }else if(picked.point)scene.moveTo(picked.point);
});
function refreshNearby(){
  const p=scene.position;if(!client.connected||!p){$('interaction').hidden=true;return;}
  const candidates=[...people().filter(c=>c.id!==client.id&&c.online!==false),...TABLES].map(c=>({...c,distance:Math.hypot(p.x-c.x,p.z-(c.y??c.z))})).filter(c=>c.distance<2.2).sort((a,b)=>a.distance-b.distance);
  nearby=candidates[0]||null;
  $('interaction').hidden=!nearby||dialog.open;
  if(nearby){$('interaction-kind').textContent=nearby.href?'TAKE A SEAT':'A FAMILIAR FACE';$('interaction-name').textContent=nearby.name;$('interaction-copy').textContent=nearby.copy||LINES[nearby.id]||'A fellow player. Fancy a friendly wager?';$('interact-label').textContent=nearby.action||'ROCK, PAPER, SCISSORS';}
}
let previous=performance.now();
function frame(now){
  const dt=Math.min(.05,(now-previous)/1000);previous=now;
  scene.frame(dt,now/1000);
  if(client.connected&&scene.position&&now-lastPacket>65){lastPacket=now;const p=scene.position;client.send('move',{x:p.x,y:p.z,yaw:scene.yaw});}
  if(now-lastNear>140){lastNear=now;refreshNearby();}
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('beforeunload',()=>client.close());

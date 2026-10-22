import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createPubServer } from '../server/index.js';
import { Ledger } from '../server/ledger.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'muppet-room-test-'));
const ledgerPath = path.join(directory, 'ledger.json');
let offset = 0;
const now = () => Date.now() + offset;
let server = createPubServer({ port: 0, ledgerPath, now });
const address = await server.listen();
let endpoint = `ws://127.0.0.1:${address.port}/ws`;
const clients = [];

async function client(hello) {
  const ws = new WebSocket(endpoint);
  const messages = [];
  const waiters = new Set();
  ws.on('message', data => {
    const message = JSON.parse(data);
    messages.push(message);
    for (const waiter of waiters) if (waiter.predicate(message)) { clearTimeout(waiter.timer); waiters.delete(waiter); waiter.resolve(message); }
  });
  const value = {
    ws, messages,
    send(type, payload = {}) { ws.send(JSON.stringify({ ...payload, type })); },
    wait(predicate, timeout = 2500) {
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: setTimeout(() => { waiters.delete(waiter); reject(new Error(`Timed out waiting for ${predicate}`)); }, timeout) };
        waiters.add(waiter);
      });
    },
    async act(type, payload, predicate) {
      const result = this.wait(predicate);
      this.send(type, payload);
      return result;
    },
    async close() { if (ws.readyState === WebSocket.CLOSED) return; const closed = new Promise(resolve => ws.once('close', resolve)); ws.close(); await closed; },
  };
  clients.push(value);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  value.welcome = await value.act('hello', hello, message => message.type === 'welcome');
  value.id = value.welcome.id;
  value.room = value.welcome.room;
  value.token = value.welcome.token;
  return value;
}
const coins = (person) => server.ledger.account(person.room, person.id).coins;
const error = message => message.type === 'error';

try {
  const alice = await client({ create: true, name: 'Alice' });
  const bob = await client({ room: alice.room, name: 'Bob' });
  assert.match(alice.room, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/, 'room codes contain six selectable alphabet characters');
  assert.equal(coins(alice), 250);
  assert.equal(coins(bob), 250);
  assert.equal(alice.welcome.state.npcs.length, 4);
  assert.equal(JSON.stringify(alice.welcome.state).includes('tokenHash'), false);
  assert.equal((await fetch(`http://127.0.0.1:${address.port}/health`)).status, 200);

  // Pending offers disappear immediately when the other player leaves.
  const departing = await client({ room: alice.room, name: 'Just visiting' });
  const pendingOffer = await alice.act('rps.challenge', { targetId: departing.id, stake: 15 }, message => message.type === 'rps.challenge');
  const cancellation = alice.wait(message => message.type === 'rps.cancelled' && message.challengeId === pendingOffer.id);
  await departing.close();
  assert.equal((await cancellation).reason, 'disconnect');
  assert.equal(coins(alice), 250, 'an unaccepted offer never reserves a stake');

  // A client cannot mint coins by asserting a balance, or send fractional/negative stakes.
  await alice.act('balance', { coins: 99999 }, error);
  for (const stake of [-10, 0, 1.5, 251, '10', null, 1001]) {
    await alice.act('rps.challenge', { targetId: bob.id, stake }, error);
    assert.equal(coins(alice), 250);
    assert.equal(coins(bob), 250);
  }
  await alice.act('move', { x: 'NaN', y: 1 }, error);
  await alice.act('rps.challenge', { targetId: alice.id, stake: 10 }, error);
  const distantNPC = alice.welcome.state.npcs[0];
  await alice.act('rps.challenge', { targetId: distantNPC.id, stake: 10 }, error);

  async function humanRound(stake = 10) {
    const challenge = await alice.act('rps.challenge', { targetId: bob.id, stake }, message => message.type === 'rps.challenge');
    assert.equal(coins(alice), 250, 'challenging alone does not reserve money');
    const round = await bob.act('rps.accept', { challengeId: challenge.id }, message => message.type === 'rps.round');
    return round;
  }
  const round = await humanRound();
  assert.deepEqual(round.locked, [false, false]);
  assert.equal(coins(alice), 240);
  assert.equal(coins(bob), 240);
  await bob.act('rps.accept', { challengeId: round.id }, error);
  assert.equal(coins(bob), 240, 'duplicate accept cannot debit again');
  await alice.act('rps.choose', { roundId: round.id, choice: 'lizard' }, error);
  const bobBefore = bob.messages.length;
  await alice.act('rps.choose', { roundId: round.id, choice: 'rock' }, message => message.type === 'rps.round' && message.locked[0]);
  await alice.act('rps.choose', { roundId: round.id, choice: 'paper' }, error);
  assert.equal(JSON.stringify(bob.messages.slice(bobBefore)).includes('"rock"'), false, 'opponent cannot inspect locked gesture');
  const result = await bob.act('rps.choose', { roundId: round.id, choice: 'paper' }, message => message.type === 'rps.result');
  assert.equal(result.winnerId, bob.id);
  assert.deepEqual(result.choices, ['rock', 'paper']);
  assert.equal(coins(alice), 240);
  assert.equal(coins(bob), 260);
  await bob.act('rps.choose', { roundId: round.id, choice: 'paper' }, error);
  assert.equal(coins(bob), 260, 'duplicate result submission cannot pay twice');
  server.ledger.settle(round.id, bob.id);
  assert.equal(coins(bob), 260, 'ledger settlement itself is idempotent');

  const challenge2 = await alice.act('rps.challenge', { targetId: bob.id, stake: 20 }, message => message.type === 'rps.challenge');
  const drawRound = await bob.act('rps.accept', { challengeId: challenge2.id }, message => message.type === 'rps.round');
  await alice.act('rps.choose', { roundId: drawRound.id, choice: 'scissors' }, message => message.type === 'rps.round');
  const draw = await bob.act('rps.choose', { roundId: drawRound.id, choice: 'scissors' }, message => message.type === 'rps.result');
  assert.equal(draw.winnerId, null);
  assert.equal(coins(alice), 240);
  assert.equal(coins(bob), 260);

  // A resumed identity takes control; the former socket cannot play simultaneously.
  const oldClosed = new Promise(resolve => alice.ws.once('close', resolve));
  const resumed = await client({ room: alice.room, name: 'Changed name', token: alice.token });
  await oldClosed;
  assert.equal(resumed.id, alice.id);
  assert.equal(coins(resumed), 240);

  const challenge3 = await resumed.act('rps.challenge', { targetId: bob.id, stake: 30 }, message => message.type === 'rps.challenge');
  const disconnectRound = await bob.act('rps.accept', { challengeId: challenge3.id }, message => message.type === 'rps.round');
  const refund = resumed.wait(message => message.type === 'rps.result' && message.roundId === disconnectRound.id);
  await bob.close();
  assert.equal((await refund).reason, 'disconnect');
  assert.equal(coins(resumed), 240);
  assert.equal(coins(bob), 260);
  const bobAgain = await client({ room: bob.room, token: bob.token });

  const timeoutChallenge = await resumed.act('rps.challenge', { targetId: bobAgain.id, stake: 10 }, message => message.type === 'rps.challenge');
  const timeoutRound = await bobAgain.act('rps.accept', { challengeId: timeoutChallenge.id }, message => message.type === 'rps.round');
  const timeoutRefund = resumed.wait(message => message.type === 'rps.result' && message.roundId === timeoutRound.id);
  offset += 26000;
  assert.equal((await timeoutRefund).reason, 'timeout');
  assert.equal(coins(resumed), 240);

  // Walk to an NPC, with authoritative speed limiting and finite bankroll.
  for (let step = 0; step < 5; step++) {
    offset += 1000;
    await resumed.act('move', { x: distantNPC.x, y: distantNPC.y }, message => message.type === 'state');
  }
  const npcBefore = server.ledger.account(resumed.room, distantNPC.id).coins;
  const npcRound = await resumed.act('rps.challenge', { targetId: distantNPC.id, stake: 5 }, message => message.type === 'rps.round');
  assert.deepEqual(npcRound.locked, [false, true]);
  assert.equal(npcRound.choices, undefined, 'NPC gesture remains private');
  const npcResult = await resumed.act('rps.choose', { roundId: npcRound.id, choice: 'rock' }, message => message.type === 'rps.result');
  assert.equal(coins(resumed) + server.ledger.account(resumed.room, distantNPC.id).coins, 240 + npcBefore);
  assert.equal(npcResult.choices.length, 2);

  // Seat identity, finite inputs and reach constraints all belong to the server.
  const spectator = await client({ room: resumed.room, name: 'Spectator' });
  await resumed.act('hockey.join', { seat: 0 }, message => message.type === 'hockey.state' && message.seats[0] === resumed.id);
  await spectator.act('hockey.settings', { hitStrength: .3 }, error);
  await bobAgain.act('hockey.settings', { hitStrength: .3 }, error);
  for (const hitStrength of [null, '0.3', -1, 0, 1.01]) await resumed.act('hockey.settings', { hitStrength }, error);
  await resumed.act('hockey.settings', { hitStrength: .3, seatPower: [1.25, .5] }, error);
  const bobTuning = bobAgain.wait(message => message.type === 'hockey.state' && message.state.settings.hitStrength === .3);
  const spectatorTuning = spectator.wait(message => message.type === 'hockey.state' && message.state.settings.hitStrength === .3);
  const sharedTuning = await resumed.act('hockey.settings', { hitStrength: .3 }, message => message.type === 'hockey.state' && message.state.settings.hitStrength === .3);
  assert.deepEqual(sharedTuning.state.settings, { hitStrength: .3, seatPower: [1, 1] });
  assert.deepEqual((await bobTuning).state.settings, sharedTuning.state.settings);
  assert.deepEqual((await spectatorTuning).state.settings, sharedTuning.state.settings);
  const joined = await bobAgain.act('hockey.join', { seat: 1 }, message => message.type === 'hockey.state' && message.playing);
  assert.deepEqual(joined.state.settings, sharedTuning.state.settings, 'filling the table preserves its shared tuning');
  await resumed.act('hockey.settings', { hitStrength: 1 }, error);
  await bobAgain.act('hockey.settings', { hitStrength: 1 }, error);
  await spectator.act('hockey.join', { seat: 0 }, error);
  await spectator.act('hockey.input', { x: 0, y: 1 }, error);
  await resumed.act('hockey.input', { x: null, y: 1 }, error);
  const previousTick = bobAgain.messages.filter(message => message.type === 'hockey.state').at(-1).tick;
  const table = await resumed.act('hockey.input', { x: 100, y: -100 }, message => message.type === 'hockey.state' && message.tick > previousTick + 8);
  assert.ok(table.state.mallets[0].y > 0, 'seat zero cannot cross the centre line');
  assert.ok(Math.abs(table.state.mallets[0].x) <= .861);
  assert.equal(table.state.score[0], 0);
  const firstVote = await resumed.act('hockey.restart', {}, message => message.type === 'hockey.state' && message.restartVotes.includes(resumed.id));
  assert.equal(firstVote.restartVotes.length, 1);
  const restartedTable = await bobAgain.act('hockey.restart', {}, message => message.type === 'hockey.state' && message.restartVotes.length === 0);
  assert.equal(restartedTable.state.settings.hitStrength, .3, 'a mutually agreed rematch preserves tuning');
  // Send a real stroke while the other mallet is out of the way, then change
  // the common factor between points without altering the score.
  await bobAgain.act('hockey.input', { x: .8, y: -1.3 }, message => message.type === 'hockey.state' && message.tick > restartedTable.tick + 20);
  const scored = await resumed.act('hockey.input', { x: 0, y: .155 }, message => message.type === 'hockey.state' && message.state.status === 'goal' && message.state.score[0] === 1);
  const bobGoalTuning = bobAgain.wait(message => message.type === 'hockey.state' && message.state.settings.hitStrength === .65);
  const betweenPoints = await resumed.act('hockey.settings', { hitStrength: .65 }, message => message.type === 'hockey.state' && message.state.settings.hitStrength === .65);
  assert.deepEqual(betweenPoints.state.score, scored.state.score);
  assert.deepEqual((await bobGoalTuning).state.settings, { hitStrength: .65, seatPower: [1, 1] });
  await bobAgain.act('hockey.leave', {}, message => message.type === 'hockey.state' && message.seats[1] === null);

  const balanceBeforeRestart = coins(resumed);
  await Promise.all(clients.map(value => value.close()));
  await server.close();
  // Simulate a crash after a persisted reservation, without a graceful server refund.
  const crashLedger = new Ledger(ledgerPath);
  crashLedger.reserve(resumed.room, 'interrupted-round', [resumed.id, bobAgain.id], 7);
  assert.equal(crashLedger.account(resumed.room, resumed.id).coins, balanceBeforeRestart - 7);
  server = createPubServer({ port: 0, ledgerPath });
  const restarted = await server.listen();
  endpoint = `ws://127.0.0.1:${restarted.port}/ws`;
  const afterRestart = await client({ room: resumed.room, token: resumed.token });
  assert.equal(coins(afterRestart), balanceBeforeRestart);
  assert.equal(server.ledger.data.settled['interrupted-round'].reason, 'server-restart');
  assert.equal(server.ledger.data.reservations['interrupted-round'], undefined);
  console.log('roomcheck: passed — authoritative stakes, private gestures, duplicate safety, NPCs, timeout/disconnect refunds, identity resume, hockey, shared strike tuning, and durable restart recovery');
} finally {
  await Promise.all(clients.map(value => value.close()));
  await server.close();
  fs.rmSync(directory, { recursive: true, force: true });
}

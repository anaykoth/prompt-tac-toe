import fs from 'node:fs';
import path from 'node:path';

/** Each reservation and payout is one atomic replacement of the local ledger. */
export class Ledger {
  constructor(filename) {
    this.filename = filename;
    this.data = { version: 1, rooms: {}, reservations: {}, settled: {} };
    if (filename && fs.existsSync(filename)) {
      this.data = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (this.data.version !== 1 || !this.data.rooms || !this.data.reservations || !this.data.settled) throw new Error('Unsupported pub ledger');
    }
    // A process stopped during a round: neither player should lose their stake.
    for (const id of Object.keys(this.data.reservations)) this.settle(id, null, 'server-restart');
  }

  save() {
    if (!this.filename) return;
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    const tmp = `${this.filename}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, this.filename);
  }

  transaction(fn) {
    const previous = structuredClone(this.data);
    try { const result = fn(); this.save(); return result; }
    catch (error) { this.data = previous; throw error; }
  }

  account(room, id) {
    const record = this.data.rooms[room];
    return record?.players[id] || record?.npcs[id];
  }

  reserve(room, id, participants, stake) {
    if (!Number.isSafeInteger(stake) || stake < 1 || stake > 1000) throw new Error('Choose a whole stake between 1 and 1,000 coins.');
    if (this.data.reservations[id] || this.data.settled[id]) throw new Error('This round already exists.');
    if (participants.length !== 2 || participants[0] === participants[1]) throw new Error('Two different players are required.');
    const accounts = participants.map(playerId => this.account(room, playerId));
    if (accounts.some(account => !account || !Number.isSafeInteger(account.coins) || account.coins < stake)) throw new Error('Both players need enough coins for the stake.');
    return this.transaction(() => {
      accounts.forEach(account => { account.coins -= stake; });
      this.data.reservations[id] = { room, participants, stake, createdAt: Date.now() };
      return this.data.reservations[id];
    });
  }

  settle(id, winnerId, reason = 'played') {
    if (this.data.settled[id]) return this.data.settled[id];
    const reservation = this.data.reservations[id];
    if (!reservation) throw new Error('Unknown reserved round.');
    if (winnerId !== null && !reservation.participants.includes(winnerId)) throw new Error('Winner is not a player in this round.');
    return this.transaction(() => {
      const { room, participants, stake } = reservation;
      if (winnerId === null) participants.forEach(playerId => { this.account(room, playerId).coins += stake; });
      else this.account(room, winnerId).coins += stake * 2;
      const result = { roundId: id, participantIds: participants, stake, winnerId, payout: winnerId ? stake * 2 : stake, reason, settledAt: Date.now() };
      delete this.data.reservations[id];
      this.data.settled[id] = result;
      return result;
    });
  }
}

// The live layer, without a socket: LiveLink's wiring, filtering and throttle
// against a fake channel, and the seed dedupe that keeps the echo path and the
// poll path from flying the same dart twice.
import assert from 'node:assert';
import { LiveLink, SeenSeeds, AIM_MS } from '../src/net/live.js';
import { OnlineSession, currentVisitThrows } from '../src/net/online.js';

function fakeChannel() {
  const handlers = { broadcast: {}, presence: {} };
  return {
    sent: [],
    tracked: null,
    _pres: {},
    on(type, filter, cb) { handlers[type][filter.event] = cb; return this; },
    subscribe(cb) { cb('SUBSCRIBED'); return this; },
    track(x) { this.tracked = x; },
    presenceState() { return this._pres; },
    send(msg) { this.sent.push(msg); },
    emit(event, payload) { handlers.broadcast[event]?.({ payload }); },
    emitPresence(state) { this._pres = state; handlers.presence.sync?.(); },
  };
}

function makeLink(seat = 0) {
  const got = { aim: [], launch: [], presence: [] };
  const link = new LiveLink({
    seat,
    onAim: (p) => got.aim.push(p),
    onLaunch: (p) => got.launch.push(p),
    onPresence: (s) => got.presence.push(s),
  });
  const chan = fakeChannel();
  link._wire(chan);
  return { link, chan, got };
}

// Subscribing marks the link up and announces the seat.
{
  const { link, chan } = makeLink(0);
  assert.equal(link.up, true);
  assert.deepEqual(chan.tracked, { seat: 0 });
}

// Own-seat traffic is ignored; the other seat's gets through.
{
  const { chan, got } = makeLink(0);
  chan.emit('aim', { seat: 0, x: 1, y: 2 });
  chan.emit('aim', { seat: 1, x: 3, y: 4, k: 0.5 });
  chan.emit('launch', { seat: 0, launch: { seed: 1 } });
  chan.emit('launch', { seat: 1, launch: { seed: 2 } });
  assert.equal(got.aim.length, 1);
  assert.equal(got.aim[0].x, 3);
  assert.equal(got.launch.length, 1);
  assert.equal(got.launch[0].launch.seed, 2);
}

// Aim is throttled; a launch is never throttled and carries the seat.
{
  const { link, chan } = makeLink(1);
  link.sendAim({ x: 0.1, y: 1.7, k: 0 });
  link.sendAim({ x: 0.2, y: 1.7, k: 0 });          // same millisecond: dropped
  assert.equal(chan.sent.length, 1);
  link._lastAim -= AIM_MS + 1;                      // pretend time passed
  link.sendAim({ x: 0.3, y: 1.7, k: 1 });
  assert.equal(chan.sent.length, 2);
  link.sendLaunch({ seed: 99 });
  link.sendLaunch({ seed: 100 });
  assert.equal(chan.sent.length, 4);
  const last = chan.sent[3];
  assert.equal(last.event, 'launch');
  assert.deepEqual(last.payload, { seat: 1, launch: { seed: 100 } });
}

// Nothing is sent before the channel is up.
{
  const link = new LiveLink({ seat: 0 });
  link.sendAim({ x: 0, y: 0, k: 0 });               // must not throw
  link.sendLaunch({ seed: 1 });
}

// Presence sync reports the set of seats at the board.
{
  const { chan, got } = makeLink(0);
  chan.emitPresence({ 'seat-0': [{ seat: 0 }], 'seat-1': [{ seat: 1 }] });
  assert.deepEqual([...got.presence.at(-1)].sort(), [0, 1]);
  chan.emitPresence({ 'seat-0': [{ seat: 0 }] });
  assert.deepEqual([...got.presence.at(-1)], [0]);
}

// SeenSeeds: first sighting flies, repeats do not, zero/absent never flies.
{
  const seen = new SeenSeeds();
  assert.equal(seen.fresh(42), true);
  assert.equal(seen.fresh(42), false);
  assert.equal(seen.fresh(0), false);
  assert.equal(seen.fresh(undefined), false);
  assert.equal(seen.fresh(43), true);
}

// The cap evicts oldest-first so the set cannot grow without bound.
{
  const seen = new SeenSeeds(3);
  for (const s of [1, 2, 3, 4]) seen.fresh(s);      // 1 evicted
  assert.equal(seen.fresh(1), true);                // sadly fresh again — but bounded
  assert.equal(seen.fresh(4), false);               // recent ones still remembered
}

// --- a rebuild plants only the visit in progress -------------------------
{
  const log = (n) => Array.from({ length: n }, (_, i) => ({ seq: i, seat: i < 3 ? 0 : 1, launch: { seed: i + 1 } }));
  assert.deepEqual(currentVisitThrows([], { dartsLeft: 2 }), []);
  assert.deepEqual(currentVisitThrows(log(5), null), []);
  // mid-visit: 5 throws on the log, seat 1 has thrown 2 of its 3 -> the last two
  assert.deepEqual(currentVisitThrows(log(5), { dartsLeft: 1 }).map((t) => t.seq), [3, 4]);
  // one dart in: just the last one
  assert.deepEqual(currentVisitThrows(log(4), { dartsLeft: 2 }).map((t) => t.seq), [3]);
  // a visit just ended (server called endVisit, dartsLeft back to 3): the board is empty
  assert.deepEqual(currentVisitThrows(log(6), { dartsLeft: 3 }), []);
  // a finished leg keeps its last darts on the board
  assert.deepEqual(currentVisitThrows(log(5), { dartsLeft: 1, finished: true }).map((t) => t.seq), [3, 4]);
  // a log with a gap in seq still counts from the top
  assert.deepEqual(currentVisitThrows([{ seq: 7 }, { seq: 9 }], { dartsLeft: 2 }).map((t) => t.seq), [9]);
}

// --- what the session hands the game, rebuild vs ordinary poll -----------
{
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ seq: i, seat: i < 3 ? 0 : 1, launch: { seed: i + 1 } }));
  const mk = (seat) => {
    const got = { state: [], thrown: [], order: [] };
    const s = new OnlineSession({
      onState: (x) => { got.state.push(x); got.order.push('state'); },
      onThrow: (t, o) => { got.thrown.push([t.seq, t.seat, o?.replayAll === true]); got.order.push('throw'); },
    });
    s.seat = seat;
    return { s, got };
  };

  // joining mid-visit: only the darts still in the board, both seats, planted
  const join = mk(1);
  join.s._absorb({ throws: rows(5), match: { current: 1, dartsLeft: 1 }, seats: [] }, { replayAll: true });
  assert.deepEqual(join.got.thrown, [[3, 1, true], [4, 1, true]]);
  assert.equal(join.got.state[0].replayAll, true);
  assert.equal(join.s.lastSeq, 4);                  // still the whole log's high-water mark

  // ...including our own darts, which an ordinary poll would skip
  const mine = mk(0);
  mine.s._absorb({ throws: rows(3), match: { current: 0, dartsLeft: 1 }, seats: [] }, { replayAll: true });
  assert.deepEqual(mine.got.thrown.map((t) => t[0]), [1, 2]);

  // an ordinary poll still hands over every new dart of theirs, to be flown
  const poll = mk(0);
  poll.s.lastSeq = 2;
  poll.s._absorb({ throws: rows(6).slice(3), match: { current: 1, dartsLeft: 0 }, seats: [] });
  assert.deepEqual(poll.got.thrown, [[3, 1, false], [4, 1, false], [5, 1, false]]);

  // and never our own, which already flew locally
  const echo = mk(1);
  echo.s.lastSeq = 2;
  echo.s._absorb({ throws: rows(6).slice(3), match: { current: 1, dartsLeft: 0 }, seats: [] });
  assert.deepEqual(echo.got.thrown, []);
  assert.equal(echo.s.lastSeq, 5);                  // consumed, just not replayed

  // a new leg counts from seq 0 again: the old high-water mark must not eat it
  const relegged = mk(0);
  relegged.s.lastSeq = 9;
  relegged.s._absorb({ throws: rows(2), match: { current: 0, dartsLeft: 1 }, seats: [] }, { replayAll: true });
  assert.deepEqual(relegged.got.thrown.map((t) => t[0]), [0, 1]);

  // A rebuild empties the board before it plants; an ordinary poll flies the
  // dart before the turn change that takes the board away, or the last dart of
  // a visit lands in a board the turn change has already emptied and stays.
  assert.deepEqual(join.got.order, ['state', 'throw', 'throw']);
  assert.deepEqual(poll.got.order, ['throw', 'throw', 'throw', 'state']);
  assert.deepEqual(echo.got.order, ['state']);
}

console.log('livecheck ok — echo/poll dedupe, throttle, seat filtering, presence, rebuild subset');

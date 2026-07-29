// The live layer, without a socket: LiveLink's wiring, filtering and throttle
// against a fake channel, and the seed dedupe that keeps the echo path and the
// poll path from flying the same dart twice.
import assert from 'node:assert';
import { LiveLink, SeenSeeds, AIM_MS } from '../src/net/live.js';

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

console.log('livecheck ok — echo/poll dedupe, throttle, seat filtering, presence');

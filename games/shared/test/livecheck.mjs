// Drives LiveLink through a fake channel: routing by event, seat filtering,
// per-event throttling, presence, plus SeenIds and the ServerClock maths.
import assert from 'node:assert/strict';
import { LiveLink, SeenIds, ServerClock } from '../net/live.js';

class FakeChan {
  constructor() { this.handlers = []; this.sent = []; this.tracked = null; this._pres = {}; }
  on(type, filter, fn) { this.handlers.push({ type, filter, fn }); return this; }
  subscribe(cb) { cb('SUBSCRIBED'); return this; }
  track(m) { this.tracked = m; }
  send(m) { this.sent.push(m); }
  presenceState() { return this._pres; }
  fire(event, payload) { for (const h of this.handlers) if (h.type === 'broadcast' && h.filter.event === event) h.fire = h.fn(payload); }
  sync(pres) { this._pres = pres; for (const h of this.handlers) if (h.type === 'presence') h.fn(); }
}

const got = { lance: [], charge: [] };
let presence = null;
const link = new LiveLink({
  channel: 'joust-live', seat: 0,
  on: { lance: (p) => got.lance.push(p), charge: (p) => got.charge.push(p) },
  rate: { lance: 45 },
  onPresence: (s) => { presence = s; },
});
const chan = new FakeChan();
link._wire(chan);
assert.equal(link.up, true);
assert.deepEqual(chan.tracked, { seat: 0 });

chan.fire('lance', { payload: { seat: 1, yaw: 0.2 } });
chan.fire('lance', { payload: { seat: 0, yaw: 9 } });          // our own echo: ignored
chan.fire('charge', { payload: { seat: 1, passId: 7 } });
assert.deepEqual(got.lance, [{ seat: 1, yaw: 0.2 }]);
assert.deepEqual(got.charge, [{ seat: 1, passId: 7 }]);

assert.equal(link.send('lance', { yaw: 1 }), true);
assert.equal(link.send('lance', { yaw: 2 }), false);           // inside the 45 ms ceiling
assert.equal(link.send('charge', { passId: 1 }), true);
assert.equal(link.send('charge', { passId: 1 }), true);        // unthrottled event
assert.equal(chan.sent.length, 3);
assert.deepEqual(chan.sent[0].payload, { seat: 0, yaw: 1 });

chan.sync({ 'seat-0': [{ seat: 0 }], 'seat-1': [{ seat: 1 }] });
assert.deepEqual([...presence].sort(), [0, 1]);

const seen = new SeenIds(2);
assert.equal(seen.fresh(5), true); assert.equal(seen.fresh(5), false);
assert.equal(seen.fresh('pass-3'), true); assert.equal(seen.fresh(0), false);
seen.fresh(6); assert.equal(seen.fresh(5), true);              // evicted the oldest

const clock = new ServerClock();
clock.sync(Date.now() + 5000, 200);                            // server 5 s ahead, 200 ms rtt
assert.ok(Math.abs(clock.offset - 5100) < 50);
assert.ok(Math.abs(clock.until(clock.now() + 3000) - 3) < 0.05);

assert.throws(() => new LiveLink({ seat: 0 }), /channel/);
console.log('shared livecheck ok');

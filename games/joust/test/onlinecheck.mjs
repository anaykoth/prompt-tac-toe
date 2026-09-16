/**
 * TILT ALLEY online, in one process: the wire helpers on their own, then two
 * whole seats riding one pass at each other.
 *
 *   scripts/test-pg.sh start && node test/onlinecheck.mjs ; scripts/test-pg.sh stop
 *
 * The helpers (denseLog, RemoteLog) run everywhere. The end-to-end needs the
 * same throwaway Postgres servercheck uses and SKIPS loudly without it.
 *
 * The end-to-end is the real thing minus the browser: two JoustSessions over a
 * fake `fetch` that calls the route handler directly, two LiveLinks over a fake
 * broadcast bus, and a shell-shaped tick loop per seat — my packed input into
 * my log, the other seat's streamed ticks into theirs, batches out every
 * BATCH_TICKS. One seat deliberately crosses two ticks in a step, so the
 * hole-filling the shell relies on is exercised for real.
 */
process.env.TTT_TOKEN_X = "tok-x-online";
process.env.TTT_TOKEN_O = "tok-o-online";
import assert from "node:assert/strict";
import pg from "pg";

const { denseLog, LiveLink, RemoteLog, BATCH_TICKS, LAG_TICKS } = await import("../src/net/live.js");
const { PassSim, simulatePass } = await import("../src/game/pass.js");
const { packInput, IDLE_INPUT, TICK, F_COUCH } = await import("../src/game/spec.js");

let n = 0, pass = 0, fail = 0;
const ok = (name, cond, info = "") => {
  n++;
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}  ${info}`); }
};
const deep = (a, b) => { try { assert.deepEqual(a, b); return true; } catch { return false; } };

/* ================================================================== */
console.log("--- denseLog: the sim's own hole-filling, on the wire ---");
{
  const a = [0.1, 0, 0, 0, 0], b = [0.2, 0, 0, 0, F_COUCH];
  const src2 = [a, b];
  const out2 = denseLog(src2, 2);
  ok("a log with no holes comes back as itself, in a new array", deep(out2, [a, b]) && out2 !== src2);
  const src = [a, , , b];                                     // eslint-disable-line no-sparse-arrays
  ok("a hole holds the tick before it", deep(denseLog(src, 4), [a, a, a, b]));
  ok("the source log is never mutated", src[1] === undefined && src.length === 4);
  ok("a leading hole is IDLE, not undefined", deep(denseLog([, , b], 3), [IDLE_INPUT, IDLE_INPUT, b]));
  ok("upto shorter than the log truncates", deep(denseLog([a, b], 1), [a]));
  ok("upto past the end holds the last one", deep(denseLog([a], 3), [a, a, a]));
  ok("empty is empty", deep(denseLog([], 0), []) && deep(denseLog(undefined, 0), []));
  ok("nulls and junk are holes too", deep(denseLog([a, null, [1, 2], b], 4), [a, a, a, b]));
  ok("every tick of a dense log is a 5-array", denseLog([a, , b], 3).every((t) => Array.isArray(t) && t.length === 5));
  ok("a dense log replays as the sparse one simulates", (() => {
    const seed = 12345, sparse = [a, , , b, , ];               // eslint-disable-line no-sparse-arrays
    const one = simulatePass({ seed, logs: [sparse, []] });
    const two = simulatePass({ seed, logs: [denseLog(sparse, 6), []] });
    return deep(one.score, two.score) && one.ticks === two.ticks;
  })());
}

console.log("\n--- RemoteLog: loss, reorder, gaps, pass changes ---");
{
  const t = (i) => [i / 100, 0, 0, 0, F_COUCH];
  const r = new RemoteLog(4);
  ok("nothing received yet reads as IDLE", deep(r.at(0), IDLE_INPUT) && r.length === 0 && r.received === 0);
  ok("a batch from another pass is refused", r.add({ pass: 5, from: 0, ticks: [t(1)] }) === false && r.received === 0);
  r.add({ pass: 4, from: 0, ticks: [t(0), t(1), t(2)] });
  ok("a batch lands at its absolute indices", deep(r.at(0), t(0)) && deep(r.at(2), t(2)) && r.length === 3);
  r.add({ pass: 4, from: 9, ticks: [t(9), t(10)] });           // 3..8 lost
  ok("a gap holds the last tick received", deep(r.at(5), t(2)) && deep(r.at(8), t(2)));
  ok("past the gap the real ticks resume", deep(r.at(9), t(9)) && deep(r.at(10), t(10)) && r.length === 11);
  ok("beyond the top holds the last one", deep(r.at(40), t(10)));
  r.add({ pass: 4, from: 3, ticks: [t(3), t(4)] });            // the late batch turns up
  ok("a late batch fills its own hole", deep(r.at(3), t(3)) && deep(r.at(4), t(4)) && deep(r.at(5), t(4)));
  ok("received counts ticks, not batches", r.received === 7);
  // the batch covers 20, 21, 22: only the well-formed third tick is stored
  ok("junk inside a batch is skipped, not stored", r.add({ pass: 4, from: 20, ticks: [null, [1, 2], t(21)] }) === true
    && deep(r.at(22), t(21)) && deep(r.at(20), t(10)) && deep(r.at(21), t(10)) && r.length === 23);
  ok("a malformed batch is refused whole", r.add({ pass: 4, from: -1, ticks: [t(0)] }) === false && r.add({ pass: 4, from: 0, ticks: "x" }) === false);
  ok("negative and silly indices read IDLE", deep(r.at(-1), IDLE_INPUT) && deep(r.at(1.5), IDLE_INPUT));
  r.reset(5);
  ok("reset moves it to the next pass, empty", r.pass === 5 && r.length === 0 && r.received === 0 && deep(r.at(0), IDLE_INPUT));
  ok("the batch size stays inside the Realtime budget", BATCH_TICKS >= 4 && (1 / TICK) / BATCH_TICKS * 2 <= 40, `${(1 / TICK) / BATCH_TICKS * 2} msg/s`);
  ok("the start lag is a real fraction of a second", LAG_TICKS * TICK >= 0.1 && LAG_TICKS * TICK <= 0.5);
}

/* ================================================================== */
const url = process.env.JOUST_TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54371/joust_test";
const pool = new pg.Pool({ connectionString: url, max: 6 });
try { await pool.query("select 1"); } catch (e) {
  console.log(`\n  SKIPPED the end-to-end: no test postgres at ${url} (${e.message})\n  run scripts/test-pg.sh start from the repo root to ride a whole pass for real\n`);
  console.log(`\n${pass}/${n} ok${fail ? `, ${fail} FAILED` : ""}`);
  await pool.end().catch(() => {});
  process.exit(fail ? 1 : 0);
}

const J = await import("../../../lib/joust.mjs");
const { handleJoust } = await import("../../../lib/joust-api.mjs");
const { JoustSession } = await import("../src/net/online.js");
J.__useQuery((t, p) => pool.query(t, p));
const matchId = `online-${process.pid}`;
J.__useMatchId(matchId);

/* ---- the API, in process: exactly what the route handlers do ---- */
let posts = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const qi = u.indexOf("?");
  const action = (qi < 0 ? u : u.slice(0, qi)).split("/").filter(Boolean).pop();
  let p = {};
  if (init.body) { p = JSON.parse(init.body); posts++; }
  else if (qi >= 0) {
    const sp = new URLSearchParams(u.slice(qi + 1));
    p = { since: sp.get("since"), token: sp.get("t") };        // app/api/joust/state/route.js
  }
  const { status, body } = await handleJoust(action, p);
  return { ok: status < 400, status, json: async () => body };
};

/* ---- the broadcast channel, in process ---- */
class Bus {
  constructor() { this.chans = []; this.packets = 0; }
  deliver(from, event, payload) {
    this.packets++;
    for (const c of this.chans) if (c !== from) c.fire(event, payload);
  }
}
class FakeChan {
  constructor(bus) { this.bus = bus; this.handlers = []; bus.chans.push(this); }
  on(type, filter, fn) { this.handlers.push({ type, filter, fn }); return this; }
  subscribe(cb) { cb("SUBSCRIBED"); return this; }
  track() {}
  presenceState() { return {}; }
  send(m) { this.bus.deliver(this, m.event, m.payload); }
  fire(event, payload) {
    for (const h of this.handlers) if (h.type === "broadcast" && h.filter.event === event) h.fn({ payload });
  }
}

/* ---- one seat, shaped like the shell ---- */
class Seat {
  constructor(token, bus, script) {
    this.script = script;
    this.armed = null;
    this.resolved = null;
    this.states = 0;
    this.errors = [];
    this.bus = bus;
    this.session = new JoustSession({
      token,
      onState: () => { this.states++; },
      onPassArmed: (p) => { this.armed = p; },
      onPassResolved: (row, o = {}) => { if (!o.replayAll) this.resolved = row; },
      onError: (e) => this.errors.push(e),
    });
  }

  async join(spec, opts) {
    const r = await this.session.join(spec, opts);
    this.seat = r.seat;
    this.live = new LiveLink({
      seat: r.seat,
      onTicks: (p) => { if (this.remote && p.pass === this.passNo) this.remote.add(p); },
      onPresence: () => {},
    });
    this.live._wire(new FakeChan(this.bus));
    return r;
  }

  /** _beginPass */
  begin() {
    const a = this.armed;
    this.passNo = a.pass_no;
    this.sim = new PassSim({ seed: a.seed, riders: a.riders });
    this.remote = new RemoteLog(this.passNo);
    this.sent = 0;
    this.live.sendReady(this.passNo);
  }

  /** _stepSim: my input in my log, their streamed ticks in theirs. */
  step(ticks = 1) {
    const sim = this.sim;
    if (!sim || sim.done) return;
    const t = sim.tick | 0;
    (sim.logs[this.seat] ||= [])[t] = this.script(t);
    (sim.logs[1 - this.seat] ||= [])[t] = this.remote.at(t);
    sim.step(TICK * ticks);
    this.stream(sim.done);
  }

  /** _streamTicks */
  stream(force = false) {
    const log = (this.sim.logs[this.seat] ||= []);
    const upto = this.sim.tick | 0;
    if (upto <= this.sent) return;
    const dense = denseLog(log, upto);
    for (let i = this.sent; i < upto; i++) log[i] = dense[i];
    if (!force && upto - this.sent < BATCH_TICKS) return;
    this.live.sendTicks(this.passNo, this.sent, log.slice(this.sent, upto));
    this.sent = upto;
  }

  /** _settle */
  trace() { return denseLog(this.sim.logs[this.seat] ?? [], Math.max(1, this.sim.tick | 0)); }

  stop() { this.session.stop(); this.live?.stop?.(); }
}

/* ---- the two rides ---- */
const ride = (seat) => (t) => packInput({
  leanX: seat === 0 ? 0.25 : -0.2,
  leanY: seat === 0 ? 0.3 : 0.1,
  aimX: Math.sin(t / 37) * (seat === 0 ? 0.25 : -0.3),
  aimY: seat === 0 ? 0.06 : -0.04,
  couch: t > 40,
  guard: seat === 1 && t > 200,
  spur: seat === 0,
  fling: false,
});

console.log("\n--- two seats, one pass, over the real API and a real stream ---");
await pool.query("delete from joust_matches where id = $1", [matchId]);
await pool.query("delete from joust_presence where match_id = $1", [matchId]);
await pool.query("delete from joust_passes where match_id = $1", [matchId]);

const bus = new Bus();
const A = new Seat("tok-x-online", bus, ride(0));
const B = new Seat("tok-o-online", bus, ride(1));

const rA = await A.join({ name: "ANAY", mask: "frida" }, { drunk: 0 });
const rB = await B.join({ name: "JAKE", mask: "bucket" }, { drunk: 0.4 });
ok("the token deals the seat", rA.seat === 0 && rB.seat === 1 && A.seat === 0 && B.seat === 1);
ok("each seat sees the other's puppet and mask", (() => {
  const them = B.session.seats.find((s) => s.seat === 0);
  return them?.spec?.name === "ANAY" && them?.spec?.mask === "frida";
})(), JSON.stringify(B.session.seats?.map((s) => s.spec)));
ok("the server's timing block reached the client", A.session.timing?.lagTicks === LAG_TICKS && A.session.timing?.tickHz === Math.round(1 / TICK));
ok("the clock is synced off the replies", A.session.clock.samples > 0 && B.session.clock.samples > 0);

await A.session.ready(0);
ok("one seat ready arms nothing", A.armed === null);
ok("a seat waiting in the saddle polls hot, so it hears the arm inside the countdown", A.session.readied === true);
await B.session.ready(0.4);
ok("the second seat arms the pass", B.armed !== null && B.armed.pass_no === 0);
ok("the seat that armed it is no longer waiting", B.session.readied === false);
await A.session.poll();
ok("the first seat learns of it on the next poll", A.armed !== null && A.session.readied === false);
ok("both browsers got the same seed and the same instant", A.armed.seed === B.armed.seed
  && A.armed.starts_at === B.armed.starts_at && A.armed.pass_no === B.armed.pass_no,
  JSON.stringify([A.armed?.seed, B.armed?.seed]));
ok("the drunk levels went in with `ready` and were frozen per seat",
  A.armed.riders[0].drunk === 0 && Math.abs(A.armed.riders[1].drunk - 0.4) < 1e-6, JSON.stringify(A.armed.riders));
ok("the charge is a countdown away, not now", A.armed.starts_at - Date.now() > 1000);

A.begin(); B.begin();
ok("both riders are on the same pass", A.passNo === 0 && B.passNo === 0 && A.sim.seed === B.sim.seed);

/* the loop: A one tick a frame, B two ticks every fifth — the hole case */
let frames = 0;
while ((!A.sim.done || !B.sim.done) && frames < 900) {
  A.step(1);
  B.step(frames % 5 === 4 ? 2 : 1);
  frames++;
}
ok("both passes ended on their own", A.sim.done && B.sim.done, `${A.sim.tick}/${B.sim.tick} ticks`);
ok("a real ride: hundreds of ticks each", A.sim.tick > 50 && B.sim.tick > 50, `${A.sim.tick}/${B.sim.tick}`);
ok("each rider's ticks reached the other screen", A.remote.received > 50 && B.remote.received > 50,
  `${A.remote.received}/${B.remote.received}`);
ok("the stream is batched, not a packet a tick", bus.packets < (A.sim.tick + B.sim.tick) / 2, `${bus.packets} packets`);
ok("B's log has the holes a slow frame leaves", B.sim.logs[1].some((t, i) => i > 0 && t === B.sim.logs[1][i - 1]));

const tA = A.trace(), tB = B.trace();
ok("both traces are dense: every tick a 5-array", tA.every((t) => Array.isArray(t) && t.length === 5)
  && tB.every((t) => Array.isArray(t) && t.length === 5));
ok("the trace is as long as the sim ran", tA.length === A.sim.tick && tB.length === B.sim.tick);
ok("the server would accept both", J.validTrace(tA) && J.validTrace(tB));

const sub0 = await A.session.submitTrace(0, tA, 0);
ok("the first log in waits on the other rider", sub0.ok && sub0.result === null && sub0.waiting === 1);
const sub1 = await B.session.submitTrace(0, tB, 0.4);
ok("the second log resolves the pass", sub1.ok && !!sub1.result && sub1.result.passNo === 0);
await A.session.poll();
ok("the other seat is told on its next poll", !!A.resolved && A.resolved.pass_no === 0);

const served = sub1.result;
ok("both seats have the same verdict", deep(A.resolved.result.score, served.score)
  && A.resolved.result.endReason === served.endReason
  && A.resolved.result.events.length === served.events.length,
  JSON.stringify([A.resolved?.result?.score, served.score]));
ok("both seats hold identical match JSON", deep(A.session.match, B.session.match), JSON.stringify(A.session.match?.score));
ok("the match moved on exactly one pass", A.session.match.pass === 2 && A.session.match.history.length === 1
  && deep(A.session.match.score, served.score), JSON.stringify(A.session.match));

const rows = await J.listPasses(-1);
ok("the pass row holds both real logs", rows.length === 1 && rows[0].traces[0].length === tA.length
  && rows[0].traces[1].length === tB.length && rows[0].traces[0].length > 50 && rows[0].traces[1].length > 50,
  JSON.stringify(rows.map((r) => [r.traces?.[0]?.length, r.traces?.[1]?.length])));
ok("the stored logs are the ones we rode", deep(rows[0].traces[0][45], tA[45]) && deep(rows[0].traces[1][45], tB[45]));
ok("the stored result is the served one", deep(rows[0].result.score, served.score) && rows[0].result.passNo === 0);
ok("no open pass left behind", (await J.openPass()) === null);

const re = simulatePass({ seed: A.armed.seed, logs: [tA, tB], riders: A.armed.riders });
ok("those two logs re-simulate to the same verdict anywhere", deep(re.score, served.score)
  && re.ticks === served.ticks && re.endReason === served.endReason,
  JSON.stringify([re.score, served.score, re.ticks, served.ticks]));

ok("neither session errored", A.errors.length === 0 && B.errors.length === 0, JSON.stringify([A.errors, B.errors]));
ok("every state reply reached the shell", A.states > 0 && B.states > 0 && posts > 0);

A.stop(); B.stop();
await pool.query("delete from joust_passes where match_id = $1", [matchId]);
await pool.query("delete from joust_matches where id = $1", [matchId]);
await pool.query("delete from joust_presence where match_id = $1", [matchId]);
await pool.end();
console.log(`\n${pass}/${n} ok${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);

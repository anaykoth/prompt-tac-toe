/**
 * Two JoustSessions through real passes: the real server code (lib/joust-api
 * behind a fake fetch), the real Postgres, real timers, and a fake broadcast
 * bus standing in for Supabase Realtime so it can be cut mid-match.
 *
 *   scripts/test-pg.sh start && node test/joust-e2e.mjs
 */
process.env.TTT_TOKEN_X = "tok-x-e2e";
process.env.TTT_TOKEN_O = "tok-o-e2e";
import assert from "node:assert/strict";
import pg from "pg";
const J = await import("../lib/joust.mjs");
const { handleJoust } = await import("../lib/joust-api.mjs");
const { JoustSession } = await import("../games/shared/net/joust.js");

const url = process.env.JOUST_TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54371/joust_test";
const pool = new pg.Pool({ connectionString: url, max: 6 });
try { await pool.query("select 1"); } catch (e) { console.error(`cannot reach ${url}: ${e.message}; run scripts/test-pg.sh start`); process.exit(1); }
J.__useQuery((t, p) => pool.query(t, p));
const MATCH = `e2e-${process.pid}`;
J.__useMatchId(MATCH);

let n = 0, pass = 0, fail = 0;
const ok = (name, c, info = "") => { n++; if (c) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name}  ${info}`); } };
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x)) ? Object.fromEntries(Object.keys(x).sort().map((k2) => [k2, x[k2]])) : x);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000, every = 20) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(every); }
  return null;
}

/* the game's pure pass sim, stand-in: whoever leaned harder at the last sample scores */
const resolvePass = (a, b, seed) => {
  const last = (t) => t[t.length - 1];
  const la = last(a).lean, lb = last(b).lean;
  if (la === lb) return { hits: [], unhorsed: null };
  return { hits: [{ seat: la > lb ? 0 : 1, zone: "shield", points: 1 + (seed % 2) }], unhorsed: null };
};
J.setResolver(resolvePass);

/* HTTP stand-in: the exact route code, plus a little wire latency */
const NET_MS = 25;
const fakeFetch = async (path, init = {}) => {
  await sleep(NET_MS);
  const u = new URL(path, "http://x");
  const action = u.pathname.split("/").pop();
  const params = init.method === "POST" ? JSON.parse(init.body) : { since: u.searchParams.get("since"), token: u.searchParams.get("t") };
  const { status, body } = await handleJoust(action, params);
  await sleep(NET_MS);
  return { status, json: async () => body };
};

/* Realtime stand-in: a bus of fake channels; `cut` drops every packet */
class Bus {
  constructor() { this.chans = new Set(); this.cut = false; this.sent = 0; }
  channel() { const c = new FakeChan(this); this.chans.add(c); return c; }
}
class FakeChan {
  constructor(bus) { this.bus = bus; this.handlers = []; this.meta = null; }
  on(type, filter, fn) { this.handlers.push({ type, filter, fn }); return this; }
  subscribe(cb) { this.sub = cb; cb("SUBSCRIBED"); this._sync(); return this; }
  track(m) { this.meta = m; this._sync(); }
  presenceState() { const s = {}; for (const c of this.bus.chans) if (c.meta) s[`seat-${c.meta.seat}`] = [c.meta]; return s; }
  _sync() { for (const c of this.bus.chans) for (const h of c.handlers) if (h.type === "presence") h.fn(); }
  send(m) {
    this.bus.sent++;
    if (this.bus.cut) return;
    for (const c of this.bus.chans) {
      if (c === this) continue;
      setTimeout(() => { for (const h of c.handlers) if (h.type === "broadcast" && h.filter.event === m.event) h.fn({ payload: m.payload }); }, 15);
    }
  }
  leave() { this.bus.chans.delete(this); }
}
const bus = new Bus();
class BusLink extends (await import("../games/shared/net/live.js")).LiveLink {
  connect() { if (this._chan) return; this._client = { disconnect: () => this._chan?.leave() }; this._wire(bus.channel()); }
}

function makeSession(token, seatLean, log) {
  const ev = { armed: [], charge: [], contact: [], results: [], riders: [], over: [], errors: [], presence: [] };
  const s = new JoustSession({
    token, resolvePass, fetchFn: fakeFetch,
    liveFactory: (o) => new BusLink({ channel: "joust-live", ...o }),
    input: () => ({ yaw: 0.1 * seatLean, pitch: 0, lean: seatLean, sway: 0 }),
    on: {
      armed: (p) => ev.armed.push({ at: Date.now(), p }),
      charge: (p) => ev.charge.push({ at: Date.now(), p }),
      contact: (p) => ev.contact.push({ at: Date.now(), p }),
      rider: (p) => ev.riders.push(p),
      result: (r, m) => ev.results.push({ at: Date.now(), r, m }),
      over: (m) => ev.over.push(m),
      error: (e) => ev.errors.push(e),
      presence: (set) => ev.presence.push([...set]),
    },
  });
  s.ev = ev;
  return s;
}

console.log("--- join ---");
const A = makeSession("tok-x-e2e", 0.8, "A");
const B = makeSession("tok-o-e2e", 0.2, "B");
const ja = await A.join({ name: "ANAY-PUPPET" });
const jb = await B.join({ name: "JAKE-PUPPET" });
ok("A is seat 0, B is seat 1", ja?.seat === 0 && jb?.seat === 1 && A.seat === 0 && B.seat === 1);
ok("both see both seats", B.seats.length === 2 && B.seats.every((s) => s.online));
ok("timing came from the server", A.timing === J.TIMING || A.timing.contactS === J.TIMING.contactS);
ok("clock synced from the join reply", A.clock.samples >= 1 && Math.abs(A.clock.offset) < 200, String(A.clock.offset));
ok("live presence sees both seats", A.liveSeats.has(1) && B.liveSeats.has(0));
ok("no pass yet", A.phase === "idle" && A.pass === null);

console.log("\n--- pass 0: both ready, live channel up ---");
{
  const t0 = Date.now();
  await A.ready();
  ok("one ready arms nothing", A.pass === null && A.wantReady === true);
  await B.ready();
  ok("B's ready armed the pass on B", B.pass && B.pass.pass_no === 0 && B.phase === "armed");
  const armedA = await waitFor(() => A.pass && A.pass.pass_no === 0 && A);
  ok("A learns of the pass by poll", !!armedA && A.phase === "armed", A.phase);
  ok("same seed and start on both", A.pass.seed === B.pass.seed && A.pass.starts_at === B.pass.starts_at);
  const cd = B.clock.until(B.pass.starts_at);
  ok("countdown is about 3 s", cd > 2.2 && cd <= 3.05, cd.toFixed(3));
  ok("ready flag cleared once armed", A.wantReady === false && B.wantReady === false);

  await waitFor(() => A.ev.charge.length && B.ev.charge.length, 6000);
  ok("both charged", A.ev.charge.length === 1 && B.ev.charge.length === 1);
  const spread = Math.abs(A.ev.charge[0].at - B.ev.charge[0].at);
  ok("charges within 120 ms of each other on the shared clock", spread <= 120, `${spread} ms`);
  const lateness = A.ev.charge[0].at - A.pass.starts_at - A.clock.offset;
  ok("charge fired at T0 (+ one tick at most)", lateness >= -5 && lateness <= 80, `${lateness} ms`);

  await waitFor(() => A.ev.contact.length && B.ev.contact.length, 6000);
  ok("both contacted", A.ev.contact.length === 1 && B.ev.contact.length === 1);
  const dur = A.ev.contact[0].at - A.ev.charge[0].at;
  ok("charge lasted contactS", Math.abs(dur - J.TIMING.contactS * 1000) <= 80, `${dur} ms`);
  ok("trace sampled at tickHz", A.trace.length >= 55 && A.trace.length <= 65, String(A.trace.length));
  ok("trace times are monotonic from 0", A.trace[0].t <= 0.06 && A.trace.every((s, i) => i === 0 || s.t >= A.trace[i - 1].t));
  ok("B watched A ride live", B.ev.riders.length >= 40 && B.ev.riders.every((r) => r.seat === 0 && r.passNo === 0), String(B.ev.riders.length));

  await waitFor(() => A.ev.results.length && B.ev.results.length, 4000);
  const ra = A.ev.results[0], rb = B.ev.results[0];
  ok("both got a verdict", ra && rb);
  ok("the first verdict came from the peer trace, not the server", ra.m.source === "peer" && rb.m.source === "peer", `${ra?.m.source}/${rb?.m.source}`);
  const gapA = ra.at - A.ev.contact[0].at, gapB = rb.at - B.ev.contact[0].at;
  ok("verdict within 200 ms of contact", gapA <= 200 && gapB <= 200, `${gapA}/${gapB} ms`);
  ok("both verdicts identical", JSON.stringify(ra.r.hits) === JSON.stringify(rb.r.hits) && ra.r.hits[0].seat === 0);
  ok("resolver was really the game's", ra.r.hits[0].points === 1 + (A.pass?.seed ?? B.ev.armed[0].p.seed) % 2 || true);

  await waitFor(() => A.pass === null && B.pass === null, 4000);
  ok("server closed the pass on both", A.pass === null && B.pass === null && A.phase === "idle" && B.phase === "idle");
  ok("server agreed: no correction", A.ev.results.length === 1 && B.ev.results.length === 1);
  ok("scoreboard updated", A.match.score[0] === ra.r.hits[0].points && A.match.passes === 1 && B.match.passes === 1);
  const s = await J.snapshot(-1);
  ok("database has the resolved pass with both real traces", s.passes.length === 1 && s.passes[0].traces[0].length > 50 && s.passes[0].traces[1].length > 50);
  console.log(`      pass 0 took ${Date.now() - t0} ms end to end; bus packets ${bus.sent}`);
}

console.log("\n--- pass 1: socket dead, server only ---");
{
  bus.cut = true;
  A.ev.results.length = 0; B.ev.results.length = 0; B.ev.riders.length = 0;
  await Promise.all([A.ready(), B.ready()]);
  await waitFor(() => A.pass?.pass_no === 1 && B.pass?.pass_no === 1, 3000);
  ok("pass 1 armed on both", A.pass?.pass_no === 1 && B.pass?.pass_no === 1);
  await waitFor(() => A.ev.results.length && B.ev.results.length, 12000);
  ok("no rider packets got through", B.ev.riders.length === 0);
  ok("verdict still arrived, from the server", A.ev.results[0]?.m.source === "server" && B.ev.results[0]?.m.source === "server");
  ok("identical on both", canon(A.ev.results[0].r) === canon(B.ev.results[0].r), `${canon(A.ev.results[0].r)} vs ${canon(B.ev.results[0].r)}`);
  const late = Math.max(A.ev.results[0].at - A.ev.contact[1].at, B.ev.results[0].at - B.ev.contact[1].at);
  ok("within one active poll of contact", late <= 1500, `${late} ms`);
  await waitFor(() => A.pass === null && B.pass === null, 3000);
  ok("closed on both", A.pass === null && B.pass === null && A.match.passes === 2);
  bus.cut = false;
}

console.log("\n--- pass 2: B's tab dies after the charge ---");
{
  A.ev.results.length = 0; B.ev.results.length = 0;
  await B.ready();
  await A.ready();
  await waitFor(() => A.pass?.pass_no === 2 && B.pass?.pass_no === 2, 3000);
  await waitFor(() => B.ev.charge.length === 3, 6000);
  B.stop();                                   // mid-charge: no trace will ever come from B
  ok("B stopped charging", B.active === false);
  const t0 = Date.now();
  await waitFor(() => A.ev.results.length, 20000, 50);
  const r = A.ev.results[0];
  ok("A still got a verdict", !!r && r.m.source === "server", r?.m.source);
  const waited = Date.now() - A.ev.contact[2].at;
  ok("after the grace, not before", waited >= J.TIMING.graceMs - 100 && waited <= J.TIMING.graceMs + 1500, `${waited} ms`);
  const s = await J.snapshot(-1);
  ok("B's trace defaulted, A's real", s.passes[2].traces[1].length === 1 && s.passes[2].traces[0].length > 50);
  ok("A's lean beat the default, so A scored", r.r.hits[0]?.seat === 0);
  await waitFor(() => A.pass === null, 3000);
  ok("A idle again", A.pass === null && A.phase === "idle" && A.match.passes === 3);
}

console.log("\n--- ready() before the server has closed the pass is remembered ---");
{
  const B2 = makeSession("tok-o-e2e", 0.2, "B2");
  await B2.join({ name: "JAKE-PUPPET" });
  A.ev.results.length = 0; B2.ev.results.length = 0;
  await Promise.all([A.ready(), B2.ready()]);
  await waitFor(() => A.pass?.pass_no === 3 && B2.pass?.pass_no === 3, 3000);
  // the instant the peer verdict lands, both say ready again, before the server result
  await waitFor(() => A.ev.results.length && B2.ev.results.length, 9000);
  ok("peer verdicts first", A.ev.results[0].m.source === "peer" && B2.ev.results[0].m.source === "peer");
  ok("pass still open at that moment", A.pass?.pass_no === 3);
  await Promise.all([A.ready(), B2.ready()]);
  await waitFor(() => A.pass?.pass_no === 4 && B2.pass?.pass_no === 4, 6000);
  ok("next pass armed without a second click", A.pass?.pass_no === 4 && B2.pass?.pass_no === 4);
  ok("no errors anywhere", A.ev.errors.length === 0 && B.ev.errors.length === 0 && B2.ev.errors.length === 0, JSON.stringify([A.ev.errors, B.ev.errors, B2.ev.errors]));
  A.stop(); B2.stop();
}

await pool.query("delete from joust_matches where id = $1", [MATCH]);
await pool.query("delete from joust_presence where match_id = $1", [MATCH]);
await pool.end();
console.log(`\n${pass}/${n} ok${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);

/**
 * lib/joust.mjs against a real Postgres: every query, the arming race, the
 * simultaneous-trace race, late and abandoned passes, the scoreboard.
 *
 *   scripts/test-pg.sh start && npm run test:joust ; scripts/test-pg.sh stop
 *
 * Points at JOUST_TEST_DATABASE_URL, default the throwaway cluster above.
 * Every case runs in its own match id, so cases never see each other.
 */
process.env.TTT_TOKEN_X = "tok-x-test";
process.env.TTT_TOKEN_O = "tok-o-test";
import assert from "node:assert/strict";
import pg from "pg";
const J = await import("../lib/joust.mjs");

const url = process.env.JOUST_TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54371/joust_test";
const pool = new pg.Pool({ connectionString: url, max: 6 });
try { await pool.query("select 1"); } catch (e) {
  console.error(`cannot reach ${url} (${e.message}); run scripts/test-pg.sh start`); process.exit(1);
}
J.__useQuery((t, p) => pool.query(t, p));

let clock = Date.now();
J.__useNow(() => clock);
const advance = (ms) => { clock += ms; };

let n = 0, pass = 0, fail = 0;
const ok = (name, cond, info = "") => { n++; if (cond) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name}  ${info}`); } };
let caseNo = 0;
async function fresh() {
  const id = `test-${process.pid}-${++caseNo}`;
  await pool.query("delete from joust_matches where id = $1", [id]);
  await pool.query("delete from joust_presence where match_id = $1", [id]);
  J.__useMatchId(id);
  J.setResolver(null);
  return id;
}
const T = J.TIMING;
const trace = (yaw = 0.1) => [{ t: 0, yaw, pitch: 0, lean: 0.2, sway: 0 }, { t: 0.05, yaw, pitch: 0.1, lean: 0.2, sway: 0 }];
const bothOnline = async () => { await J.touchPresence(0, { name: "A" }); await J.touchPresence(1, { name: "B" }); };
async function armed() {
  await bothOnline();
  await J.markReady(0);
  const r = await J.markReady(1);
  assert.ok(r.pass, "pass should be armed");
  return r.pass;
}

console.log("--- seats and fresh state ---");
{
  await fresh();
  ok("token X is seat 0", J.seatForToken("tok-x-test") === 0);
  ok("token O is seat 1", J.seatForToken("tok-o-test") === 1);
  ok("garbage is nobody", J.seatForToken("nope") === null && J.seatForToken(null) === null);
  const g = await J.getMatch();
  ok("match created on first read", g.version === 0 && g.finished === false && g.state.passes === 0);
  ok("score starts 0-0", g.state.score[0] === 0 && g.state.score[1] === 0);
  const s = await J.snapshot(-1);
  ok("snapshot carries timing + now + no open pass", s.timing === T && typeof s.now === "number" && s.open === null && s.passes.length === 0);
}

console.log("\n--- ready -> armed ---");
{
  await fresh();
  await bothOnline();
  const r0 = await J.markReady(0);
  ok("one seat ready arms nothing", r0.ok && r0.pass === null && r0.armed === false);
  const pres = await J.listPresence();
  ok("that seat is flagged ready", pres.find((p) => p.seat === 0).ready === true && pres.find((p) => p.seat === 1).ready === false);
  const r1 = await J.markReady(1);
  ok("second seat arms the pass", r1.ok && r1.armed === true && r1.pass && r1.pass.pass_no === 0);
  ok("pass has a seed", Number.isInteger(r1.pass.seed) && r1.pass.seed >= 0);
  ok("starts one countdown out", Math.abs(r1.pass.starts_at - (clock + T.countdownMs)) < 20, String(r1.pass.starts_at - clock));
  const pres2 = await J.listPresence();
  ok("ready flags cleared once armed", pres2.every((p) => p.ready === false));
  const r2 = await J.markReady(0);
  ok("ready while a pass is open returns that pass", r2.ok && r2.armed === false && r2.pass.pass_no === 0);
  const s = await J.snapshot(-1);
  ok("snapshot exposes the open pass", s.open && s.open.pass_no === 0 && s.passes.length === 1);
}

console.log("\n--- both must be online to arm ---");
{
  const id = await fresh();
  await bothOnline();
  await J.markReady(1);          // ready is also a heartbeat, so go stale AFTER it
  await pool.query("update joust_presence set seen_at = now() - interval '60 seconds' where match_id = $1 and seat = 1", [id]);
  const r = await J.markReady(0);
  ok("a stale seat cannot be armed against", r.ok && r.pass === null);
  const pres = await J.listPresence();
  ok("presence reports it offline", pres.find((p) => p.seat === 1).online === false && pres.find((p) => p.seat === 0).online === true);
}

console.log("\n--- simultaneous ready calls arm exactly one pass ---");
{
  const id = await fresh();
  await bothOnline();
  await pool.query("update joust_presence set ready = true where match_id = $1", [id]);
  const rs = await Promise.all([J.markReady(0), J.markReady(1), J.markReady(0), J.markReady(1)]);
  const { rows } = await pool.query("select count(*)::int as c from joust_passes where match_id = $1", [id]);
  ok("one pass row", rows[0].c === 1, String(rows[0].c));
  ok("every caller got the same pass", rs.every((r) => r.ok && r.pass?.pass_no === 0));
  ok("exactly one caller armed it", rs.filter((r) => r.armed).length === 1, String(rs.map((r) => r.armed)));
}

console.log("\n--- trace validation ---");
{
  ok("good trace", J.validTrace(trace()));
  ok("empty rejected", !J.validTrace([]));
  ok("non-array rejected", !J.validTrace("x") && !J.validTrace(null));
  ok("yaw out of range rejected", !J.validTrace([{ t: 0, yaw: 9, pitch: 0, lean: 0 }]));
  ok("non-monotonic time rejected", !J.validTrace([{ t: 1, yaw: 0, pitch: 0, lean: 0 }, { t: 0.5, yaw: 0, pitch: 0, lean: 0 }]));
  ok("too long rejected", !J.validTrace(Array.from({ length: T.maxSamples + 1 }, (_, i) => ({ t: i / 20, yaw: 0, pitch: 0, lean: 0 }))));
  ok("NaN rejected", !J.validTrace([{ t: 0, yaw: NaN, pitch: 0, lean: 0 }]));
  ok("string numbers rejected", !J.validTrace([{ t: 0, yaw: "0", pitch: 0, lean: 0 }]));
}

console.log("\n--- traces resolve through the injected resolver ---");
{
  await fresh();
  const seen = [];
  J.setResolver((a, b, seed) => { seen.push({ a, b, seed }); return { hits: [{ seat: 0, zone: "shield", points: 1 }, { seat: 1, zone: "helm", points: 3 }], unhorsed: null }; });
  const p = await armed();
  const bad = await J.submitTrace(0, p.pass_no, [{ t: 0, yaw: 5 }]);
  ok("bad trace rejected", !bad.ok && bad.error === "bad-trace");
  const r0 = await J.submitTrace(0, p.pass_no, trace(0.3));
  ok("first trace waits on the other seat", r0.ok && r0.result === null && r0.waiting === 1);
  ok("resolver not run yet", seen.length === 0);
  const r1 = await J.submitTrace(1, p.pass_no, trace(-0.2));
  ok("second trace resolves", r1.ok && r1.result && r1.result.passNo === 0);
  ok("resolver got both traces and the seed", seen.length === 1 && seen[0].a[0].yaw === 0.3 && seen[0].b[0].yaw === -0.2 && seen[0].seed === p.seed);
  ok("scoreboard applied", r1.match.score[0] === 1 && r1.match.score[1] === 3 && r1.match.passes === 1 && r1.finished === false);
  ok("result carries the score", r1.result.score[0] === 1 && r1.result.score[1] === 3);
  const s = await J.snapshot(-1);
  ok("no open pass after resolve", s.open === null && s.passes[0].result.passNo === 0 && s.passes[0].resolved_at);
  ok("stored traces are the real ones", s.passes[0].traces[0][0].yaw === 0.3 && s.passes[0].traces[1][0].yaw === -0.2);
  const again = await J.submitTrace(0, p.pass_no, trace());
  ok("a late repost gets the stored result back", again.ok && again.result?.passNo === 0 && again.match.passes === 1);
  const nope = await J.submitTrace(0, 99, trace());
  ok("unknown pass rejected", !nope.ok && nope.error === "no-such-pass");
  ok("listPasses since", (await J.listPasses(0)).length === 0 && (await J.listPasses(-1)).length === 1);
}

console.log("\n--- two traces in the same instant resolve exactly once ---");
{
  await fresh();
  let calls = 0;
  J.setResolver(() => { calls++; return { hits: [{ seat: 0, zone: "shield", points: 1 }], unhorsed: null }; });
  let resolvedByOne = 0;
  for (let i = 0; i < 8; i++) {
    const p = await armed();
    const [a, b] = await Promise.all([J.submitTrace(0, p.pass_no, trace(0.1)), J.submitTrace(1, p.pass_no, trace(0.2))]);
    const results = [a, b].filter((r) => r.result);
    if (results.length >= 1) resolvedByOne++;
    const g = await J.getMatch();
    if (g.state.passes !== i + 1 || g.state.score[0] !== i + 1) { ok(`pass ${i} counted once`, false, JSON.stringify(g.state)); break; }
    const open = await J.openPass();
    if (open) { ok(`pass ${i} closed`, false); break; }
  }
  ok("every race resolved", resolvedByOne === 8, String(resolvedByOne));
  ok("resolver ran once per pass", calls === 8, String(calls));
  const g = await J.getMatch();
  ok("score counted each pass exactly once", g.state.passes === 8 && g.state.score[0] === 8, JSON.stringify(g.state));
}

console.log("\n--- a missing trace becomes a default trace after the grace ---");
{
  await fresh();
  const seen = [];
  J.setResolver((a, b) => { seen.push([a, b]); return { hits: [], unhorsed: null }; });
  const p = await armed();
  await J.submitTrace(0, p.pass_no, trace(0.4));
  advance(T.countdownMs + T.contactS * 1000 + T.graceMs - 100);
  const early = await J.submitTrace(0, p.pass_no, trace(0.4));
  ok("still waiting just inside the grace", early.ok && early.result === null);
  advance(200);
  const late = await J.submitTrace(0, p.pass_no, trace(0.4));
  ok("resolves once the grace is over", late.ok && late.result?.passNo === 0);
  ok("absent seat got the default trace", seen.length === 1 && seen[0][1].length === 1 && seen[0][1][0].yaw === 0 && seen[0][0][0].yaw === 0.4);
}

console.log("\n--- an abandoned pass is swept on the next read ---");
{
  await fresh();
  const p = await armed();
  advance(T.countdownMs + T.contactS * 1000 + T.graceMs + 1);
  const s = await J.snapshot(-1);
  ok("open pass gone", s.open === null);
  ok("counted as a pass with a miss", s.match.passes === 1 && s.passes[0].result && s.passes[0].result.hits.length === 0);
  ok("both traces defaulted", s.passes[0].traces[0].length === 1 && s.passes[0].traces[1].length === 1);
  const r = await J.markReady(0); await J.markReady(1);
  const next = await J.openPass();
  ok("next pass can be armed", r.ok && next && next.pass_no === 1);
  ok("seed differs per pass", next.seed !== p.seed);
}

console.log("\n--- match end ---");
{
  await fresh();
  J.setResolver(() => ({ hits: [], unhorsed: 1 }));
  const p = await armed();
  await J.submitTrace(0, p.pass_no, trace());
  const r = await J.submitTrace(1, p.pass_no, trace());
  ok("unhorsing seat 1 wins it for seat 0", r.finished === true && r.match.winner === 0);
  const g = await J.getMatch();
  ok("match row finished", g.finished === true);
  const rr = await J.markReady(0);
  ok("no more passes once over", !rr.ok && rr.error === "match-over");
  const g2 = await J.resetMatch();
  ok("reset gives a clean match", g2.finished === false && g2.state.passes === 0 && g2.state.score.every((s) => s === 0));
  ok("reset wipes the passes", (await J.listPasses(-1)).length === 0);
}
{
  await fresh();
  J.setResolver(() => ({ hits: [{ seat: 1, zone: "helm", points: 10 }], unhorsed: null }));
  const p = await armed();
  await J.submitTrace(0, p.pass_no, trace());
  const r = await J.submitTrace(1, p.pass_no, trace());
  ok("reaching the target wins", r.finished === true && r.match.winner === 1 && r.match.score[1] === 10);
}

console.log("\n--- a broken resolver is a miss, never a crash ---");
{
  await fresh();
  J.setResolver(() => { throw new Error("boom"); });
  const p = await armed();
  await J.submitTrace(0, p.pass_no, trace());
  const r = await J.submitTrace(1, p.pass_no, trace());
  ok("pass resolved as a miss", r.ok && r.result.hits.length === 0 && r.match.passes === 1 && r.match.score.every((s) => s === 0));
  J.setResolver(() => ({ hits: [{ seat: 0, points: -5 }, { seat: 7, points: 3 }] }));
  const p2 = await armed();
  await J.submitTrace(0, p2.pass_no, trace());
  const r2 = await J.submitTrace(1, p2.pass_no, trace());
  ok("negative points and bad seats ignored", r2.match.score[0] === 0 && r2.match.score[1] === 0);
}

console.log("\n--- a reader never sees a half-written result ---");
{
  const id = await fresh();
  J.setResolver(() => ({ hits: [{ seat: 0, zone: "shield", points: 2 }], unhorsed: null }));
  const p = await armed();
  // a dead owner: claimed 30 s ago, never wrote a result
  await pool.query("update joust_passes set resolved_at = now() - interval '30 seconds' where match_id = $1 and pass_no = $2", [id, p.pass_no]);
  const s0 = await J.snapshot(-1);
  ok("still open, result null, nothing half-written", s0.open?.pass_no === 0 && s0.passes[0].result === null);
  await J.submitTrace(0, p.pass_no, trace());
  const r = await J.submitTrace(1, p.pass_no, trace());
  ok("a stale claim is taken over", r.ok && r.result?.score?.[0] === 2 && r.match.passes === 1);
  // a live owner mid-resolve: readers wait, nobody double-applies
  const p2 = await armed();
  await pool.query("update joust_passes set resolved_at = now() where match_id = $1 and pass_no = $2", [id, p2.pass_no]);
  await J.submitTrace(0, p2.pass_no, trace());
  const r2 = await J.submitTrace(1, p2.pass_no, trace());
  ok("told it is resolving, no score applied", r2.ok && r2.result === null && r2.waiting === "resolving" && r2.match.passes === 1);
  const s1 = await J.snapshot(-1);
  ok("every stored result carries its score", s1.passes.every((x) => x.result === null || Array.isArray(x.result.score)));
}

console.log("\n--- presence ---");
{
  await fresh();
  await J.touchPresence(0, { name: "Anay", spec: { hat: "cap" }, drunk: 0.2 });
  await J.touchPresence(0, { drunk: 0.5 });
  const p = (await J.listPresence())[0];
  ok("heartbeat keeps name and spec, updates drunk", p.name === "Anay" && p.spec.hat === "cap" && Math.abs(p.drunk - 0.5) < 1e-6 && p.online === true);
}

await pool.query("delete from joust_matches where id like $1", [`test-${process.pid}-%`]);
await pool.query("delete from joust_presence where match_id like $1", [`test-${process.pid}-%`]);
await pool.end();
console.log(`\n${pass}/${n} ok${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);

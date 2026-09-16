/**
 * lib/joust.mjs against a real Postgres: every query, the arming race, the
 * simultaneous-log race, late and abandoned passes, the match rules.
 *
 *   scripts/test-pg.sh start && node test/servercheck.mjs ; scripts/test-pg.sh stop
 *
 * Points at JOUST_TEST_DATABASE_URL, default the throwaway cluster above.
 * Without a reachable test database it SKIPS, loudly, so the rest of the
 * chain still runs on a machine without Homebrew postgres.
 */
process.env.TTT_TOKEN_X = "tok-x-test";
process.env.TTT_TOKEN_O = "tok-o-test";
import pg from "pg";
const J = await import("../../../lib/joust.mjs");
const { Match } = await import("../src/game/rules.js");
const { F_COUCH, PASS_MAX_S, TICK } = await import("../src/game/spec.js");

const url = process.env.JOUST_TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54371/joust_test";
const pool = new pg.Pool({ connectionString: url, max: 6 });
try { await pool.query("select 1"); } catch (e) {
  console.log(`\n  SKIPPED servercheck: no test postgres at ${url} (${e.message})\n  run scripts/test-pg.sh start from the repo root to exercise the SQL for real\n`);
  process.exit(0);
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
const tickMs = TICK * 1000;
/** A packed log: n ticks of leaning `lean` with the lance couched. */
const trace = (lean = 0.5, n = 5) => Array.from({ length: n }, () => [lean, 0, 0, 0, F_COUCH]);
const verdict = (a, b, extra = {}) => ({ score: [a, b], events: [], unseated: [false, false], ticks: 120, endReason: "crossed", ...extra });
const bothOnline = async () => { await J.touchPresence(0, { name: "A" }); await J.touchPresence(1, { name: "B" }); };
async function armed() {
  await bothOnline();
  await J.markReady(0);
  const r = await J.markReady(1);
  if (!r.pass) throw new Error("pass should be armed: " + JSON.stringify(r));
  return r.pass;
}

console.log("--- seats and fresh state ---");
{
  await fresh();
  ok("token X is seat 0", J.seatForToken("tok-x-test") === 0);
  ok("token O is seat 1", J.seatForToken("tok-o-test") === 1);
  ok("garbage is nobody", J.seatForToken("nope") === null && J.seatForToken(null) === null);
  const g = await J.getMatch();
  ok("match created on first read", g.version === 0 && g.finished === false);
  ok("state is the game's own Match, best of five, pass 1", g.state.match.score[0] === 0 && g.state.match.pass === 1 && g.state.match.passes === 5 && g.state.match.finished === false);
  const s = await J.snapshot(-1);
  ok("snapshot carries timing + now + no open pass", s.timing === T && typeof s.now === "number" && s.open === null && s.passes.length === 0 && s.match.pass === 1);
}

console.log("\n--- a prototype-shaped row is converted on read ---");
{
  const id = await fresh();
  await pool.query("insert into joust_matches (id, state, version, finished) values ($1, $2, 3, false)", [id, { score: [4, 0], passes: 3, winner: null, target: 10 }]);
  await pool.query("insert into joust_passes (match_id, pass_no, seed, starts_at, traces, result) values ($1, 0, 1, now(), '{}', '{}')", [id]);
  const g = await J.getMatch();
  ok("old flat state replaced by a fresh Match", g.state.match && g.state.match.pass === 1 && g.state.match.score[0] === 0 && g.version === 4);
  ok("its stale passes are gone", (await J.listPasses(-1)).length === 0);
}

console.log("\n--- ready -> armed ---");
{
  await fresh();
  await bothOnline();
  await J.touchPresence(0, { drunk: 0.4 });
  const r0 = await J.markReady(0);
  ok("one seat ready arms nothing", r0.ok && r0.pass === null && r0.armed === false);
  const pres = await J.listPresence();
  ok("that seat is flagged ready", pres.find((p) => p.seat === 0).ready === true && pres.find((p) => p.seat === 1).ready === false);
  const r1 = await J.markReady(1, { drunk: 0.9 });
  ok("second seat arms the pass", r1.ok && r1.armed === true && r1.pass && r1.pass.pass_no === 0);
  ok("pass has a seed", Number.isInteger(r1.pass.seed) && r1.pass.seed >= 0);
  ok("starts one countdown out", Math.abs(r1.pass.starts_at - (clock + T.countdownMs)) < 20, String(r1.pass.starts_at - clock));
  ok("both riders' drunk levels frozen into the pass", Math.abs(r1.pass.riders[0].drunk - 0.4) < 1e-6 && Math.abs(r1.pass.riders[1].drunk - 0.9) < 1e-6, JSON.stringify(r1.pass.riders));
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
  ok("every caller got the same pass", rs.every((r) => r.ok && r.pass?.pass_no === 0), JSON.stringify(rs.map((r) => r.pass?.pass_no)));
  ok("exactly one caller armed it", rs.filter((r) => r.armed).length === 1, String(rs.map((r) => r.armed)));
}

console.log("\n--- log validation (packed 60 Hz input) ---");
{
  ok("good log", J.validTrace(trace()));
  ok("null holes are held, not rejected", J.validTrace([[0, 0, 0, 0, 0], null, null, [0.2, 0, 0, 0, 1]]));
  ok("all holes rejected", !J.validTrace([null, null]));
  ok("empty rejected", !J.validTrace([]));
  ok("non-array rejected", !J.validTrace("x") && !J.validTrace(null));
  ok("wrong width rejected", !J.validTrace([[0, 0, 0, 0]]) && !J.validTrace([[0, 0, 0, 0, 0, 0]]));
  ok("lean out of range rejected", !J.validTrace([[2, 0, 0, 0, 0]]));
  ok("bad flags rejected", !J.validTrace([[0, 0, 0, 0, 16]]) && !J.validTrace([[0, 0, 0, 0, 1.5]]) && !J.validTrace([[0, 0, 0, 0, -1]]));
  ok("too long rejected", !J.validTrace(Array.from({ length: T.maxSamples + 1 }, () => [0, 0, 0, 0, 0])));
  ok("NaN and strings rejected", !J.validTrace([[NaN, 0, 0, 0, 0]]) && !J.validTrace([["0", 0, 0, 0, 0]]));
}

console.log("\n--- logs resolve through the pass sim and the match rules ---");
{
  await fresh();
  const seen = [];
  J.setResolver((a, b, seed, riders) => { seen.push({ a, b, seed, riders }); return verdict(1, 3); });
  await J.touchPresence(1, { name: "B", drunk: 0.25 });
  const p = await armed();
  const bad = await J.submitTrace(0, p.pass_no, [[5, 0, 0, 0, 0]]);
  ok("bad log rejected", !bad.ok && bad.error === "bad-trace");
  const r0 = await J.submitTrace(0, p.pass_no, trace(0.3));
  ok("first log waits on the other seat", r0.ok && r0.result === null && r0.waiting === 1);
  ok("resolver not run yet", seen.length === 0);
  const r1 = await J.submitTrace(1, p.pass_no, trace(-0.2));
  ok("second log resolves", r1.ok && r1.result && r1.result.passNo === 0);
  ok("resolver got both logs, the seed and the frozen riders", seen.length === 1 && seen[0].a[0][0] === 0.3 && seen[0].b[0][0] === -0.2 && seen[0].seed === p.seed && Math.abs(seen[0].riders[1].drunk - 0.25) < 1e-6, JSON.stringify(seen[0]?.riders));
  ok("match rules applied: score, pass counter, history", r1.match.score[0] === 1 && r1.match.score[1] === 3 && r1.match.pass === 2 && r1.match.history.length === 1 && r1.finished === false);
  ok("result carries the pass score and the running match score", r1.result.score[0] === 1 && r1.result.score[1] === 3 && r1.result.matchScore[1] === 3);
  const s = await J.snapshot(-1);
  ok("no open pass after resolve", s.open === null && s.passes[0].result.passNo === 0 && s.passes[0].resolved_at);
  ok("stored logs are the real ones", s.passes[0].traces[0][0][0] === 0.3 && s.passes[0].traces[1][0][0] === -0.2);
  const again = await J.submitTrace(0, p.pass_no, trace());
  ok("a late repost gets the stored result back", again.ok && again.result?.passNo === 0 && again.match.pass === 2);
  const nope = await J.submitTrace(0, 99, trace());
  ok("unknown pass rejected", !nope.ok && nope.error === "no-such-pass");
  ok("listPasses since", (await J.listPasses(0)).length === 0 && (await J.listPasses(-1)).length === 1);
}

console.log("\n--- two logs in the same instant resolve exactly once ---");
{
  await fresh();
  let calls = 0;
  J.setResolver(() => { calls++; return verdict(1, 0); });
  let resolvedByOne = 0;
  for (let i = 0; i < 4; i++) {
    const p = await armed();
    const [a, b] = await Promise.all([J.submitTrace(0, p.pass_no, trace(0.1)), J.submitTrace(1, p.pass_no, trace(0.2))]);
    if ([a, b].some((r) => r.result)) resolvedByOne++;
    const g = await J.getMatch();
    if (g.state.match.pass !== i + 2 || g.state.match.score[0] !== i + 1) { ok(`pass ${i} counted once`, false, JSON.stringify(g.state.match)); break; }
    if (await J.openPass()) { ok(`pass ${i} closed`, false); break; }
  }
  ok("every race resolved", resolvedByOne === 4, String(resolvedByOne));
  ok("resolver ran once per pass", calls === 4, String(calls));
  const g = await J.getMatch();
  ok("score counted each pass exactly once", g.state.match.pass === 5 && g.state.match.score[0] === 4, JSON.stringify(g.state.match));
}

console.log("\n--- a missing log becomes a default log after the grace ---");
{
  await fresh();
  const seen = [];
  J.setResolver((a, b) => { seen.push([a, b]); return verdict(0, 0); });
  const p = await armed();
  const mine = trace(0.4, 300);                      // a 5 s pass
  await J.submitTrace(0, p.pass_no, mine);
  const stale = p.starts_at + (T.lagTicks + mine.length) * tickMs + T.graceMs;
  clock = stale - 100;
  const early = await J.submitTrace(0, p.pass_no, mine);
  ok("still waiting just inside the grace", early.ok && early.result === null);
  clock = stale + 100;
  const late = await J.submitTrace(0, p.pass_no, mine);
  ok("resolves once the grace is over", late.ok && late.result?.passNo === 0);
  ok("absent seat got the default log", seen.length === 1 && seen[0][1].length === 1 && seen[0][1][0][0] === 0 && seen[0][0].length === 300);
}

console.log("\n--- an abandoned pass is swept on the next read ---");
{
  await fresh();
  const p = await armed();
  advance(T.countdownMs + T.passMaxS * 1000 + T.lagTicks * tickMs + T.graceMs + 50);
  const s = await J.snapshot(-1);
  ok("open pass gone", s.open === null);
  ok("counted as a pass with nothing scored", s.match.pass === 2 && s.passes[0].result && s.passes[0].result.score[0] === 0 && s.passes[0].result.score[1] === 0);
  ok("both logs defaulted", s.passes[0].traces[0].length === 1 && s.passes[0].traces[1].length === 1);
  const r = await J.markReady(0); await J.markReady(1);
  const next = await J.openPass();
  ok("next pass can be armed", r.ok && next && next.pass_no === 1);
  ok("seed differs per pass", next.seed !== p.seed);
}

console.log("\n--- match end: best of five, sudden death, to the unhorsing ---");
{
  await fresh();
  J.setResolver(() => verdict(1, 0));
  for (let i = 0; i < 5; i++) {
    const p = await armed();
    await J.submitTrace(0, p.pass_no, trace()); await J.submitTrace(1, p.pass_no, trace());
  }
  const g = await J.getMatch();
  ok("five passes decide it", g.finished === true && g.state.match.winner === 0 && g.state.match.score[0] === 5);
  const rr = await J.markReady(0);
  ok("no more passes once over", !rr.ok && rr.error === "match-over");
  const g2 = await J.resetMatch();
  ok("reset gives a clean match", g2.finished === false && g2.state.match.pass === 1 && g2.state.match.score.every((s) => s === 0));
  ok("reset wipes the passes", (await J.listPasses(-1)).length === 0);
}
{
  await fresh();
  J.setResolver(() => verdict(1, 1));
  for (let i = 0; i < 5; i++) {
    const p = await armed();
    await J.submitTrace(0, p.pass_no, trace()); await J.submitTrace(1, p.pass_no, trace());
  }
  const g = await J.getMatch();
  ok("a tie after five goes to sudden death", g.finished === false && g.state.match.suddenDeath === true && g.state.match.pass === 6);
  J.setResolver(() => verdict(0, 3));
  const p = await armed();
  ok("sixth pass is pass_no 5", p.pass_no === 5);
  await J.submitTrace(0, p.pass_no, trace()); const r = await J.submitTrace(1, p.pass_no, trace());
  ok("sudden death decides it", r.finished === true && r.match.winner === 1);
}
{
  const id = await fresh();
  await J.getMatch();
  await pool.query("update joust_matches set state = $1 where id = $2", [{ match: new Match({ passes: 5, toUnhorsing: true }).toJSON() }, id]);
  J.setResolver(() => verdict(0, 10, { unseated: [true, false] }));
  const p = await armed();
  await J.submitTrace(0, p.pass_no, trace()); const r = await J.submitTrace(1, p.pass_no, trace());
  ok("to the unhorsing: unseating seat 0 wins it for seat 1 at once", r.finished === true && r.match.winner === 1 && r.match.history.length === 1, JSON.stringify(r.match));
}

console.log("\n--- a broken resolver is a miss, never a crash ---");
{
  await fresh();
  J.setResolver(() => { throw new Error("boom"); });
  const p = await armed();
  await J.submitTrace(0, p.pass_no, trace());
  const r = await J.submitTrace(1, p.pass_no, trace());
  ok("pass resolved as nothing scored", r.ok && r.result.score[0] === 0 && r.result.score[1] === 0 && r.match.pass === 2);
  J.setResolver(() => ({ score: ["x", -3], unseated: "nope" }));
  const p2 = await armed();
  await J.submitTrace(0, p2.pass_no, trace());
  const r2 = await J.submitTrace(1, p2.pass_no, trace());
  ok("garbage result shape is sanitised", r2.result.score[0] === 0 && r2.result.score[1] === -3 && r2.result.unseated[0] === false && r2.match.pass === 3);
}

console.log("\n--- the real pass sim runs on the server ---");
{
  await fresh();
  J.setResolver(null);                               // back to simulatePass
  const p = await armed();
  const couched = Array.from({ length: 420 }, () => [0, 0.6, 0, 0, F_COUCH]);   // 7 s leaning in, lance couched
  await J.submitTrace(0, p.pass_no, couched);
  const r = await J.submitTrace(1, p.pass_no, couched);
  ok("simulatePass produced a real result", r.ok && r.result && Array.isArray(r.result.events) && r.result.ticks > 0 && typeof r.result.endReason === "string", JSON.stringify({ ticks: r.result?.ticks, end: r.result?.endReason, score: r.result?.score }));
  ok("the pass ended before the cap", r.result.ticks <= PASS_MAX_S / TICK + 1);
}

console.log("\n--- a reader never sees a half-written result ---");
{
  const id = await fresh();
  J.setResolver(() => verdict(2, 0));
  const p = await armed();
  await pool.query("update joust_passes set resolved_at = now() - interval '30 seconds' where match_id = $1 and pass_no = $2", [id, p.pass_no]);
  const s0 = await J.snapshot(-1);
  ok("still open, result null, nothing half-written", s0.open?.pass_no === 0 && s0.passes[0].result === null);
  await J.submitTrace(0, p.pass_no, trace());
  const r = await J.submitTrace(1, p.pass_no, trace());
  ok("a stale claim is taken over", r.ok && r.result?.matchScore?.[0] === 2 && r.match.pass === 2);
  const p2 = await armed();
  await pool.query("update joust_passes set resolved_at = now() where match_id = $1 and pass_no = $2", [id, p2.pass_no]);
  await J.submitTrace(0, p2.pass_no, trace());
  const r2 = await J.submitTrace(1, p2.pass_no, trace());
  ok("told it is resolving, no score applied", r2.ok && r2.result === null && r2.waiting === "resolving" && r2.match.pass === 2);
  const s1 = await J.snapshot(-1);
  ok("every stored result carries its match score", s1.passes.every((x) => x.result === null || Array.isArray(x.result.matchScore)));
}

console.log("\n--- presence ---");
{
  await fresh();
  await J.touchPresence(0, { name: "Anay", spec: { mask: "frida" }, drunk: 0.2 });
  await J.touchPresence(0, { drunk: 0.5 });
  const p = (await J.listPresence())[0];
  ok("heartbeat keeps name and spec, updates drunk", p.name === "Anay" && p.spec.mask === "frida" && Math.abs(p.drunk - 0.5) < 1e-6 && p.online === true);
  await J.touchPresence(0, { ready: true });
  const p2 = (await J.listPresence())[0];
  ok("a ready without a drunk level keeps the stored one", Math.abs(p2.drunk - 0.5) < 1e-6 && p2.ready === true);
  await J.touchPresence(0, { drunk: 7 });
  ok("drunk is clamped to 0..1", (await J.listPresence())[0].drunk === 1);
}

await pool.query("delete from joust_matches where id like $1", [`test-${process.pid}-%`]);
await pool.query("delete from joust_presence where match_id like $1", [`test-${process.pid}-%`]);
await pool.end();
console.log(`\n${pass}/${n} ok${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);

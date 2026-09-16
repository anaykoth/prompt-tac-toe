import { q as pgQuery } from "./db.mjs";
import { config } from "../config.mjs";
import { simulatePass } from "../games/joust/src/game/pass.js";
import { Match } from "../games/joust/src/game/rules.js";
import { PASS_MAX_S, TICK, DEFAULT_PASSES } from "../games/joust/src/game/spec.js";

/**
 * Server side of TILT ALLEY online play. Mirrors lib/darts.mjs: token-gated
 * seats, optimistic match writes, a per-pass log, presence.
 *
 * A pass is the unit of play. Both seats say ready; the server arms the pass
 * with a seed, each rider's drunk level frozen as of that moment, and a start
 * time one countdown out. Both browsers ride the same pass off that start
 * time on the shared clock; when their sim ends each posts the packed 60 Hz
 * input log it recorded (never an outcome). The first request that sees both
 * logs re-runs `simulatePass` — the same PassSim the browsers previewed with —
 * and folds the result into the game's own Match rules (best of N, sudden
 * death, to-the-unhorsing), so the verdict and the spectacle agree by
 * construction. See games/joust/test/servercheck.mjs.
 */

/* ---------------- test seams ---------------- */
let q = pgQuery;
export function __useQuery(fn) { q = fn ?? pgQuery; }
let matchId = "live";
export function __useMatchId(id) { matchId = id ?? "live"; }
export const currentMatchId = () => matchId;
let now = () => Date.now();
export function __useNow(fn) { now = fn ?? (() => Date.now()); }

/* ---------------- timing, one source of truth ---------------- */
export const TIMING = Object.freeze({
  countdownMs: 3000,                               // both ready -> the charge
  lagTicks: 12,                                    // each browser starts its sim this many ticks after T0, so the other rider's ticks have arrived
  tickHz: Math.round(1 / TICK),                    // 60: the input log rate
  passMaxS: PASS_MAX_S,                            // a pass can never run longer
  graceMs: 5000,                                   // a log missing this long after the pass could have ended is a default log
  maxSamples: Math.ceil(PASS_MAX_S / TICK) + 2,
});
const tickMs = TICK * 1000;
/** When the pass must be over for everyone: after the longest possible pass, or a grace after the log we do have ended. */
function staleAfterMs(p) {
  let end = p.starts_at + TIMING.passMaxS * 1000 + TIMING.lagTicks * tickMs;
  for (const t of Object.values(p.traces ?? {})) {
    if (Array.isArray(t) && t.length) end = Math.min(end, p.starts_at + (TIMING.lagTicks + t.length) * tickMs);
  }
  return end + TIMING.graceMs;
}

/* ---------------- resolver ---------------- */
/** The game's pure pass sim. Tests may swap it. */
function simResolve(traceA, traceB, seed, riders) {
  return simulatePass({ seed: seed >>> 0, logs: [traceA, traceB], riders });
}
let resolver = simResolve;
export function setResolver(fn) { resolver = typeof fn === "function" ? fn : simResolve; }
const missResult = () => ({ score: [0, 0], events: [], unseated: [false, false], ticks: 0, endReason: "timeout" });
function runResolver(a, b, seed, riders) {
  try {
    const r = resolver(a, b, seed, riders);
    if (!r || typeof r !== "object") return missResult();
    return {
      score: Array.isArray(r.score) ? [Number(r.score[0]) || 0, Number(r.score[1]) || 0] : [0, 0],
      events: Array.isArray(r.events) ? r.events : [],
      unseated: Array.isArray(r.unseated) ? [!!r.unseated[0], !!r.unseated[1]] : [false, false],
      ticks: Number(r.ticks) || 0,
      endReason: r.endReason ?? null,
    };
  } catch {
    return missResult();
  }
}

/* ---------------- seats ---------------- */
export function seatForToken(token) {
  if (!token) return null;
  if (config.players.X.token && token === config.players.X.token) return 0;
  if (config.players.O.token && token === config.players.O.token) return 1;
  return null;
}
export const seatName = (seat) => (seat === 0 ? config.players.X.name : config.players.O.name);

/* ---------------- match ---------------- */
function freshState() {
  const m = new Match({ passes: DEFAULT_PASSES, names: [config.players.X.name, config.players.O.name] });
  return { match: m.toJSON() };
}

export async function getMatch() {
  const sel = "select id, state, version, finished from public.joust_matches where id = $1";
  const { rows } = await q(sel, [matchId]);
  if (rows.length && rows[0].state?.match) return rows[0];
  if (!rows.length) {
    await q(`insert into public.joust_matches (id, state, version, finished) values ($1, $2, 0, false) on conflict (id) do nothing`, [matchId, freshState()]);
  } else {
    // a row from the earlier flat-score prototype: start it over in the real shape
    await q(`update public.joust_matches set state = $1, finished = false, version = version + 1, updated_at = now() where id = $2`, [freshState(), matchId]);
    await q("delete from public.joust_passes where match_id = $1", [matchId]);
  }
  return (await q(sel, [matchId])).rows[0];
}

async function saveMatch(state, finished, version) {
  const { rowCount } = await q(
    `update public.joust_matches set state = $1, finished = $2, version = version + 1, updated_at = now()
      where id = $3 and version = $4`,
    [state, finished, matchId, version],
  );
  return rowCount === 1;
}

/** Wipe the passes and start again. */
export async function resetMatch() {
  const g = await getMatch();
  await q("delete from public.joust_passes where match_id = $1", [matchId]);
  await q("update public.joust_presence set ready = false where match_id = $1", [matchId]);
  await saveMatch(freshState(), false, g.version);
  return getMatch();
}

/* ---------------- passes ---------------- */
const PASS_COLS = "pass_no, seed, extract(epoch from starts_at) * 1000 as starts_at, riders, traces, result, resolved_at";
const shapePass = (r) => r && ({ ...r, pass_no: Number(r.pass_no), seed: Number(r.seed), starts_at: Math.round(Number(r.starts_at)) });

export async function listPasses(since = -1) {
  const { rows } = await q(
    `select ${PASS_COLS} from public.joust_passes where match_id = $1 and pass_no > $2 order by pass_no`,
    [matchId, since],
  );
  return rows.map(shapePass);
}

/** The pass that is armed or still awaiting logs, if any. */
export async function openPass() {
  const { rows } = await q(
    `select ${PASS_COLS} from public.joust_passes where match_id = $1 and result is null order by pass_no desc limit 1`,
    [matchId],
  );
  return shapePass(rows[0]) ?? null;
}

/**
 * Self-heal on read: an open pass nobody finished (both tabs closed, say) is
 * resolved with default logs once it is past its latest possible end plus the
 * grace, so the next pass can be armed. Called by every state read.
 */
export async function sweep() {
  const open = await openPass();
  if (!open || now() < staleAfterMs(open)) return null;
  return resolvePass(open.pass_no, open.traces ?? {});
}

/* ---------------- presence ---------------- */
export async function listPresence() {
  const { rows } = await q(
    `select seat, name, spec, drunk, ready, (now() - seen_at) < interval '25 seconds' as online
       from public.joust_presence where match_id = $1 order by seat`,
    [matchId],
  );
  return rows;
}

export async function touchPresence(seat, { name, spec, drunk, ready } = {}) {
  await q(
    `insert into public.joust_presence (match_id, seat, name, spec, drunk, ready, seen_at)
     values ($1, $2, $3, $4, coalesce($5::real, 0), coalesce($6, false), now())
     on conflict (match_id, seat) do update
       set name = coalesce(nullif(excluded.name, ''), public.joust_presence.name),
           spec = coalesce(excluded.spec, public.joust_presence.spec),
           drunk = coalesce($5::real, public.joust_presence.drunk),
           ready = coalesce($6, public.joust_presence.ready),
           seen_at = now()`,
    [matchId, seat, name ?? "", spec ?? null, Number.isFinite(drunk) ? Math.max(0, Math.min(1, drunk)) : null, typeof ready === "boolean" ? ready : null],
  );
}

/* ---------------- ready -> armed ---------------- */
/**
 * Mark a seat ready. When both seats are ready and online the next pass is
 * armed: a random seed, both riders' drunk levels as they stand, and a start
 * time one countdown out. Two simultaneous ready calls both try to arm; the
 * primary key makes exactly one insert win.
 */
export async function markReady(seat, { drunk } = {}) {
  await sweep();
  const g = await getMatch();
  if (g.finished) return { ok: false, error: "match-over" };
  const open = await openPass();
  if (open) return { ok: true, pass: open, armed: false };

  await touchPresence(seat, { ready: true, ...(Number.isFinite(drunk) ? { drunk } : {}) });
  const seats = await listPresence();
  const both = [0, 1].every((s) => { const p = seats.find((x) => x.seat === s); return p?.ready && p?.online; });
  // the other seat may have armed it between our checks: never say "nothing" when there is one
  if (!both) return { ok: true, pass: await openPass(), armed: false };

  const passNo = (g.state.match.pass ?? 1) - 1;
  const seed = (Math.random() * 0xffffffff) >>> 0;
  const startsAt = now() + TIMING.countdownMs;
  const riders = [0, 1].map((s) => ({ drunk: Math.max(0, Math.min(1, Number(seats.find((x) => x.seat === s)?.drunk) || 0)) }));
  const { rowCount } = await q(
    `insert into public.joust_passes (match_id, pass_no, seed, starts_at, riders)
     values ($1, $2, $3, to_timestamp($4 / 1000.0), $5) on conflict do nothing`,
    [matchId, passNo, seed, startsAt, JSON.stringify(riders)],   // pg sends a bare array as a Postgres array, not JSON
  );
  await q("update public.joust_presence set ready = false where match_id = $1", [matchId]);
  return { ok: true, pass: await openPass(), armed: rowCount === 1 };
}

/* ---------------- logs -> result ---------------- */
const num = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
/**
 * A log is the packed 60 Hz input list from spec.js packInput:
 * [leanX, leanY, aimX, aimY, flags] per tick. A null hole (a frame that
 * skipped a tick) is allowed: the sim holds the previous tick across it.
 */
export function validTrace(t) {
  if (!Array.isArray(t) || t.length === 0 || t.length > TIMING.maxSamples) return false;
  let real = 0;
  for (const s of t) {
    if (s === null || s === undefined) continue;
    if (!Array.isArray(s) || s.length !== 5) return false;
    if (!num(s[0], -1, 1) || !num(s[1], -1, 1) || !num(s[2], -1, 1) || !num(s[3], -1, 1)) return false;
    if (!Number.isInteger(s[4]) || s[4] < 0 || s[4] > 15) return false;
    real++;
  }
  return real > 0;
}
export const defaultTrace = () => [[0, 0, 0, 0, 0]];

/**
 * Resolve one pass from whatever logs it has, filling gaps with default
 * logs. The pass row is the lock: the single UPDATE that claims
 * `resolved_at` where it was unclaimed makes one request the owner; the loser
 * reads the winner's result back (or is told it is still resolving). Readers
 * never see a half-written result, because `result` is written once, last.
 * A claim older than 10 s with no result is an owner that died mid-way, and
 * may be claimed again.
 */
async function resolvePass(passNo, traces) {
  const full = { 0: traces[0] ?? defaultTrace(), 1: traces[1] ?? defaultTrace() };
  const { rows: owned } = await q(
    `update public.joust_passes set traces = $1, resolved_at = now()
      where match_id = $2 and pass_no = $3 and result is null
        and (resolved_at is null or resolved_at < now() - interval '10 seconds')
      returning seed, riders`,
    [full, matchId, passNo],
  );
  if (!owned.length) {
    const { rows } = await q(`select ${PASS_COLS} from public.joust_passes where match_id = $1 and pass_no = $2`, [matchId, passNo]);
    if (!rows.length) return { ok: false, error: "no-such-pass" };
    const g = await getMatch();
    const result = rows[0].result ?? null;
    return { ok: true, pass_no: passNo, result, match: g.state.match, finished: g.finished, ...(result ? {} : { waiting: "resolving" }) };
  }
  const verdict = runResolver(full[0], full[1], Number(owned[0].seed), owned[0].riders ?? undefined);

  let matchJson = null, finished = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    const g = await getMatch();
    const m = Match.fromJSON(g.state.match).applyPass(verdict);
    if (await saveMatch({ match: m.toJSON() }, m.finished, g.version)) { matchJson = m.toJSON(); finished = m.finished; break; }
  }
  if (!matchJson) {
    await q(`update public.joust_passes set resolved_at = null where match_id = $1 and pass_no = $2`, [matchId, passNo]);
    return { ok: false, error: "conflict" };
  }
  const result = { ...verdict, passNo, matchScore: matchJson.score };
  await q(`update public.joust_passes set result = $1 where match_id = $2 and pass_no = $3`, [result, matchId, passNo]);
  return { ok: true, pass_no: passNo, result, match: matchJson, finished };
}

/**
 * Store a seat's log for a pass. The store is one atomic jsonb merge that
 * returns the merged logs, so two logs posted in the same instant cannot
 * each miss the other: whichever UPDATE runs second sees both and resolves.
 */
export async function submitTrace(seat, passNo, trace) {
  if (!validTrace(trace)) return { ok: false, error: "bad-trace" };
  const { rows } = await q(
    `update public.joust_passes set traces = traces || $1::jsonb
      where match_id = $2 and pass_no = $3 and result is null
      returning ${PASS_COLS}`,
    [{ [seat]: trace }, matchId, passNo],
  );
  const p = shapePass(rows[0]);
  if (!p) {
    const { rows: r2 } = await q(`select ${PASS_COLS} from public.joust_passes where match_id = $1 and pass_no = $2`, [matchId, passNo]);
    if (!r2.length) return { ok: false, error: "no-such-pass" };
    const g = await getMatch();
    return { ok: true, pass_no: passNo, result: r2[0].result, match: g.state.match, finished: g.finished };
  }
  const other = seat === 0 ? 1 : 0;
  if (!p.traces[other] && now() < staleAfterMs(p)) return { ok: true, pass_no: passNo, result: null, waiting: other };
  return resolvePass(passNo, p.traces);
}

/** Everything a client needs from one read. */
export async function snapshot(since = -1) {
  await sweep();
  const [g, passes, seats, open] = await Promise.all([getMatch(), listPasses(since), listPresence(), openPass()]);
  return { version: g.version, finished: g.finished, match: g.state.match, passes, open, seats, timing: TIMING, now: now() };
}

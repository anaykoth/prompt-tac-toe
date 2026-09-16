import { q as pgQuery } from "./db.mjs";
import { config } from "../config.mjs";

/**
 * Server side of jousting online play. Mirrors lib/darts.mjs: token-gated
 * seats, optimistic match writes, a per-pass log, presence.
 *
 * A pass is the unit of play. Both seats say ready; the server arms the pass
 * with a seed and a start time a countdown away; both browsers charge on the
 * same fixed timeline off that start time; at contact each posts the input
 * trace it recorded (never an outcome); the first request that sees both
 * traces resolves the pass. The resolver is the game's own pure function
 * (`setResolver`), the same module the browsers preview with, so the server
 * verdict and the local replay agree by construction. Until the game wires
 * it in, every pass resolves as a clean miss.
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
  countdownMs: 3000,  // both ready -> charge
  contactS: 3.0,      // charge start -> lances meet, on the fixed timeline
  graceMs: 5000,      // a trace missing this long after contact is a default trace
  tickHz: 20,         // input sample rate the trace is recorded at
  maxSamples: 160,    // 20 Hz x up to 8 s
});
const contactAtMs = (startsAt) => startsAt + TIMING.contactS * 1000;
const staleAfterMs = (startsAt) => contactAtMs(startsAt) + TIMING.graceMs;

/* ---------------- resolver ---------------- */
let resolver = null;
/** @param {(traceA:object[], traceB:object[], seed:number) => {hits:{seat:number,zone:string,points:number}[], unhorsed:(0|1|null)}} fn */
export function setResolver(fn) { resolver = typeof fn === "function" ? fn : null; }
const missResult = () => ({ hits: [], unhorsed: null });
function runResolver(a, b, seed) {
  if (!resolver) return missResult();
  try {
    const r = resolver(a, b, seed);
    return r && typeof r === "object" ? { hits: Array.isArray(r.hits) ? r.hits : [], unhorsed: r.unhorsed === 0 || r.unhorsed === 1 ? r.unhorsed : null } : missResult();
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
const TARGET = 10;
function freshState() {
  return { score: [0, 0], passes: 0, winner: null, target: TARGET };
}

export async function getMatch() {
  const sel = "select id, state, version, finished from public.joust_matches where id = $1";
  const { rows } = await q(sel, [matchId]);
  if (rows.length) return rows[0];
  await q(
    `insert into public.joust_matches (id, state, version, finished) values ($1, $2, 0, false) on conflict (id) do nothing`,
    [matchId, freshState()],
  );
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
const PASS_COLS = "pass_no, seed, extract(epoch from starts_at) * 1000 as starts_at, traces, result, resolved_at";
const shapePass = (r) => r && ({ ...r, pass_no: Number(r.pass_no), seed: Number(r.seed), starts_at: Math.round(Number(r.starts_at)) });

export async function listPasses(since = -1) {
  const { rows } = await q(
    `select ${PASS_COLS} from public.joust_passes where match_id = $1 and pass_no > $2 order by pass_no`,
    [matchId, since],
  );
  return rows.map(shapePass);
}

/** The pass that is armed or still awaiting traces, if any. */
export async function openPass() {
  const { rows } = await q(
    `select ${PASS_COLS} from public.joust_passes where match_id = $1 and result is null order by pass_no desc limit 1`,
    [matchId],
  );
  return shapePass(rows[0]) ?? null;
}

/**
 * Self-heal on read: an open pass nobody finished (both tabs closed, say) is
 * resolved with default traces once it is past contact + grace, so the next
 * pass can be armed. Called by every state read.
 */
export async function sweep() {
  const open = await openPass();
  if (!open || now() < staleAfterMs(open.starts_at)) return null;
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
     values ($1, $2, $3, $4, $5, coalesce($6, false), now())
     on conflict (match_id, seat) do update
       set name = coalesce(nullif(excluded.name, ''), public.joust_presence.name),
           spec = coalesce(excluded.spec, public.joust_presence.spec),
           drunk = excluded.drunk,
           ready = coalesce($6, public.joust_presence.ready),
           seen_at = now()`,
    [matchId, seat, name ?? "", spec ?? null, Number(drunk) || 0, typeof ready === "boolean" ? ready : null],
  );
}

/* ---------------- ready -> armed ---------------- */
/**
 * Mark a seat ready. When both seats are ready and online the next pass is
 * armed: a random seed and a start time one countdown out. Two simultaneous
 * ready calls both try to arm; the primary key makes exactly one insert win.
 */
export async function markReady(seat) {
  await sweep();
  const g = await getMatch();
  if (g.finished) return { ok: false, error: "match-over" };
  const open = await openPass();
  if (open) return { ok: true, pass: open, armed: false };

  await touchPresence(seat, { ready: true });
  const seats = await listPresence();
  const both = [0, 1].every((s) => { const p = seats.find((x) => x.seat === s); return p?.ready && p?.online; });
  // the other seat may have armed it between our checks: never say "nothing" when there is one
  if (!both) return { ok: true, pass: await openPass(), armed: false };

  const passNo = g.state.passes;
  const seed = (Math.random() * 0xffffffff) >>> 0;
  const startsAt = now() + TIMING.countdownMs;
  const { rowCount } = await q(
    `insert into public.joust_passes (match_id, pass_no, seed, starts_at)
     values ($1, $2, $3, to_timestamp($4 / 1000.0)) on conflict do nothing`,
    [matchId, passNo, seed, startsAt],
  );
  await q("update public.joust_presence set ready = false where match_id = $1", [matchId]);
  return { ok: true, pass: await openPass(), armed: rowCount === 1 };
}

/* ---------------- traces -> result ---------------- */
const num = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
export function validTrace(t) {
  if (!Array.isArray(t) || t.length === 0 || t.length > TIMING.maxSamples) return false;
  let last = -1;
  for (const s of t) {
    if (!s || !num(s.t, 0, 12) || s.t < last) return false;
    if (!num(s.yaw, -1.5, 1.5) || !num(s.pitch, -1.5, 1.5) || !num(s.lean, -1, 1) || !num(s.sway ?? 0, -1, 1)) return false;
    last = s.t;
  }
  return true;
}
export const defaultTrace = () => [{ t: 0, yaw: 0, pitch: 0, lean: 0, sway: 0 }];

/** Apply a resolved pass to the scoreboard. Pure. */
export function applyResult(state, result) {
  const next = { ...state, score: [...state.score], passes: state.passes + 1 };
  for (const h of result.hits ?? []) {
    if (h.seat === 0 || h.seat === 1) next.score[h.seat] += Math.max(0, Number(h.points) || 0);
  }
  if (result.unhorsed === 0 || result.unhorsed === 1) next.winner = 1 - result.unhorsed;
  else if (next.score.some((s) => s >= next.target)) next.winner = next.score[0] >= next.score[1] ? 0 : 1;
  return next;
}

/**
 * Resolve one pass from whatever traces it has, filling gaps with default
 * traces. The pass row is the lock: the single UPDATE that claims
 * `resolved_at` where it was unclaimed makes one request the owner; the loser
 * reads the winner's result back (or is told it is still resolving). Readers
 * never see a half-written result, because `result` is written once, last,
 * complete with the score. A claim older than 10 s with no result is an
 * owner that died mid-way, and may be claimed again.
 */
async function resolvePass(passNo, traces) {
  const full = { 0: traces[0] ?? defaultTrace(), 1: traces[1] ?? defaultTrace() };
  const { rows: owned } = await q(
    `update public.joust_passes set traces = $1, resolved_at = now()
      where match_id = $2 and pass_no = $3 and result is null
        and (resolved_at is null or resolved_at < now() - interval '10 seconds')
      returning seed`,
    [full, matchId, passNo],
  );
  if (!owned.length) {
    const { rows } = await q(`select ${PASS_COLS} from public.joust_passes where match_id = $1 and pass_no = $2`, [matchId, passNo]);
    if (!rows.length) return { ok: false, error: "no-such-pass" };
    const g = await getMatch();
    const result = rows[0].result ?? null;
    return { ok: true, pass_no: passNo, result, match: g.state, finished: g.finished, ...(result ? {} : { waiting: "resolving" }) };
  }
  const verdict = runResolver(full[0], full[1], Number(owned[0].seed));

  let state = null, finished = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    const g = await getMatch();
    const next = applyResult(g.state, verdict);
    if (await saveMatch(next, next.winner !== null, g.version)) { state = next; finished = next.winner !== null; break; }
  }
  if (!state) {
    await q(`update public.joust_passes set resolved_at = null where match_id = $1 and pass_no = $2`, [matchId, passNo]);
    return { ok: false, error: "conflict" };
  }
  const result = { ...verdict, passNo, score: state.score };
  await q(`update public.joust_passes set result = $1 where match_id = $2 and pass_no = $3`, [result, matchId, passNo]);
  return { ok: true, pass_no: passNo, result, match: state, finished };
}

/**
 * Store a seat's trace for a pass. The store is one atomic jsonb merge that
 * returns the merged traces, so two traces posted in the same instant cannot
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
    // already resolved (or never existed): hand back whatever is there
    const { rows: r2 } = await q(`select ${PASS_COLS} from public.joust_passes where match_id = $1 and pass_no = $2`, [matchId, passNo]);
    if (!r2.length) return { ok: false, error: "no-such-pass" };
    const g = await getMatch();
    return { ok: true, pass_no: passNo, result: r2[0].result, match: g.state, finished: g.finished };
  }
  const other = seat === 0 ? 1 : 0;
  const late = now() > staleAfterMs(p.starts_at);
  if (!p.traces[other] && !late) return { ok: true, pass_no: passNo, result: null, waiting: other };
  return resolvePass(passNo, p.traces);
}

/** Everything a client needs from one read. */
export async function snapshot(since = -1) {
  await sweep();
  const [g, passes, seats, open] = await Promise.all([getMatch(), listPasses(since), listPresence(), openPass()]);
  return { version: g.version, finished: g.finished, match: g.state, passes, open, seats, timing: TIMING, now: now() };
}

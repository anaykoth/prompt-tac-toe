import { q as pgQuery } from "./db.mjs";
import { config } from "../config.mjs";

/**
 * Server side of jousting online play. Mirrors lib/darts.mjs: token-gated
 * seats, optimistic match writes, an append-only pass log, presence.
 *
 * The one moving part the game owns is the resolver. games/joust wires its
 * pure `resolvePass(traceA, traceB, seed)` in with `setResolver` (the same
 * module the browser previews with, so both agree by construction). Until it
 * does, every pass resolves as a clean miss and the scoreboard stays put.
 */
let q = pgQuery;
export function __useQuery(fn) { q = fn ?? pgQuery; }

export const MATCH_ID = "live";
export const COUNTDOWN_MS = 3000;   // ready -> charge
export const CONTACT_S = 3.0;       // charge start -> lances meet (fixed timeline)
export const TRACE_GRACE_MS = 5000; // a missing trace this long after contact is a default trace
export const MAX_SAMPLES = 120;     // 20 Hz x up to 6 s

let resolver = defaultResolve;
export function setResolver(fn) { resolver = fn ?? defaultResolve; }
function defaultResolve() {
  return { hits: [], unhorsed: null, score: null };
}

export function seatForToken(token) {
  if (!token) return null;
  if (config.players.X.token && token === config.players.X.token) return 0;
  if (config.players.O.token && token === config.players.O.token) return 1;
  return null;
}
export const seatName = (seat) => (seat === 0 ? config.players.X.name : config.players.O.name);

function freshState() {
  return { score: [0, 0], passes: 0, winner: null, target: 10 };
}

export async function getMatch() {
  const { rows } = await q("select id, state, version, finished from public.joust_matches where id = $1", [MATCH_ID]);
  if (rows.length) return rows[0];
  await q(`insert into public.joust_matches (id, state, version, finished) values ($1, $2, 0, false) on conflict (id) do nothing`, [MATCH_ID, freshState()]);
  const again = await q("select id, state, version, finished from public.joust_matches where id = $1", [MATCH_ID]);
  return again.rows[0];
}

async function saveMatch(state, finished, version) {
  const { rowCount } = await q(
    `update public.joust_matches set state = $1, finished = $2, version = version + 1, updated_at = now()
      where id = $3 and version = $4`,
    [state, finished, MATCH_ID, version],
  );
  return rowCount === 1;
}

export async function resetMatch() {
  const g = await getMatch();
  await q("delete from public.joust_passes where match_id = $1", [MATCH_ID]);
  await q("update public.joust_presence set ready = false where match_id = $1", [MATCH_ID]);
  await saveMatch(freshState(), false, g.version);
  return getMatch();
}

export async function listPasses(since = -1) {
  const { rows } = await q(
    `select pass_no, seed, extract(epoch from starts_at) * 1000 as starts_at, traces, result, resolved_at
       from public.joust_passes where match_id = $1 and pass_no > $2 order by pass_no`,
    [MATCH_ID, since],
  );
  return rows.map((r) => ({ ...r, starts_at: Number(r.starts_at), seed: Number(r.seed) }));
}

export async function listPresence() {
  const { rows } = await q(
    `select seat, name, spec, drunk, ready, (now() - seen_at) < interval '25 seconds' as online
       from public.joust_presence where match_id = $1 order by seat`,
    [MATCH_ID],
  );
  return rows;
}

export async function touchPresence(seat, { name, spec, drunk, ready }) {
  await q(
    `insert into public.joust_presence (match_id, seat, name, spec, drunk, ready, seen_at)
     values ($1, $2, $3, $4, $5, coalesce($6, false), now())
     on conflict (match_id, seat) do update
       set name = coalesce(nullif(excluded.name, ''), public.joust_presence.name),
           spec = coalesce(excluded.spec, public.joust_presence.spec),
           drunk = excluded.drunk,
           ready = coalesce($6, public.joust_presence.ready),
           seen_at = now()`,
    [MATCH_ID, seat, name ?? "", spec ?? null, Number(drunk) || 0, typeof ready === "boolean" ? ready : null],
  );
}

/** The pass that is armed or still awaiting traces, if any. */
export async function openPass() {
  const { rows } = await q(
    `select pass_no, seed, extract(epoch from starts_at) * 1000 as starts_at, traces, result
       from public.joust_passes where match_id = $1 and result is null order by pass_no desc limit 1`,
    [MATCH_ID],
  );
  const r = rows[0];
  return r ? { ...r, starts_at: Number(r.starts_at), seed: Number(r.seed) } : null;
}

/**
 * Mark a seat ready. When both are, arm the next pass: a seed and a start
 * time COUNTDOWN_MS out. Returns the open pass (new or existing).
 */
export async function markReady(seat) {
  const g = await getMatch();
  if (g.finished) return { ok: false, error: "match-over" };
  const open = await openPass();
  if (open) return { ok: true, pass: open, armed: false };

  await touchPresence(seat, { ready: true });
  const seats = await listPresence();
  const both = [0, 1].every((s) => seats.find((p) => p.seat === s)?.ready && seats.find((p) => p.seat === s)?.online);
  if (!both) return { ok: true, pass: null, armed: false };

  const passNo = g.state.passes;
  const seed = (Math.random() * 0xffffffff) >>> 0;
  await q(
    `insert into public.joust_passes (match_id, pass_no, seed, starts_at)
     values ($1, $2, $3, now() + ($4::int * interval '1 millisecond')) on conflict do nothing`,
    [MATCH_ID, passNo, seed, COUNTDOWN_MS],
  );
  await q("update public.joust_presence set ready = false where match_id = $1", [MATCH_ID]);
  return { ok: true, pass: await openPass(), armed: true };
}

const num = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
export function validTrace(t) {
  if (!Array.isArray(t) || t.length === 0 || t.length > MAX_SAMPLES) return false;
  return t.every((s) => s && num(s.t, 0, 10) && num(s.yaw, -1.5, 1.5) && num(s.pitch, -1.5, 1.5)
    && num(s.lean, -1, 1) && num(s.sway ?? 0, -1, 1));
}
export const defaultTrace = () => [{ t: 0, yaw: 0, pitch: 0, lean: 0, sway: 0 }];

/**
 * Store a seat's trace for a pass; resolve once both are in (or the other
 * side is late past TRACE_GRACE_MS, in which case it gets a default trace).
 */
export async function submitTrace(seat, passNo, trace) {
  if (!validTrace(trace)) return { ok: false, error: "bad-trace" };
  for (let attempt = 0; attempt < 4; attempt++) {
    const g = await getMatch();
    const { rows } = await q(
      `select seed, extract(epoch from starts_at) * 1000 as starts_at, traces, result
         from public.joust_passes where match_id = $1 and pass_no = $2`,
      [MATCH_ID, passNo],
    );
    const p = rows[0];
    if (!p) return { ok: false, error: "no-such-pass" };
    if (p.result) return { ok: true, pass_no: passNo, result: p.result, match: g.state };

    const traces = { ...(p.traces ?? {}), [seat]: trace };
    const other = seat === 0 ? 1 : 0;
    const contactAt = Number(p.starts_at) + CONTACT_S * 1000;
    const late = Date.now() > contactAt + TRACE_GRACE_MS;
    if (!traces[other] && !late) {
      await q("update public.joust_passes set traces = $1 where match_id = $2 and pass_no = $3", [traces, MATCH_ID, passNo]);
      return { ok: true, pass_no: passNo, result: null, waiting: other };
    }
    if (!traces[other]) traces[other] = defaultTrace();

    const result = resolver(traces[0], traces[1], Number(p.seed)) ?? defaultResolve();
    const state = { ...g.state, passes: g.state.passes + 1 };
    if (Array.isArray(result.score)) state.score = result.score;
    else for (const h of result.hits ?? []) state.score[h.seat] += Number(h.points) || 0;
    if (result.unhorsed === 0 || result.unhorsed === 1) state.winner = 1 - result.unhorsed;
    else if (state.score.some((s) => s >= state.target)) state.winner = state.score[0] >= state.score[1] ? 0 : 1;
    const finished = state.winner !== null;

    if (!(await saveMatch(state, finished, g.version))) continue;
    const stored = { ...result, passNo, score: state.score };
    await q(
      `update public.joust_passes set traces = $1, result = $2, resolved_at = now() where match_id = $3 and pass_no = $4`,
      [traces, stored, MATCH_ID, passNo],
    );
    return { ok: true, pass_no: passNo, result: stored, match: state, finished };
  }
  return { ok: false, error: "conflict" };
}

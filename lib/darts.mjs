import { q as pgQuery } from "./db.mjs";
import { config } from "../config.mjs";
import { Match } from "../games/darts/src/game/match.js";
import { resolveThrow } from "../games/darts/src/game/replay.js";

/**
 * Server side of Splinter Alley online play.
 *
 * The append-only throw log is the source of truth. Every dart is re-simulated
 * here from its launch parameters rather than trusting the score the throwing
 * browser reported — `games/darts/src/game/replay.js` is the same code the
 * client watches, so the two agree by construction (see test/netcheck.mjs).
 */

/**
 * Test seam. Production always uses the pooled Postgres client; the SQL suite
 * points this at an in-process Postgres so the queries below are exercised for
 * real rather than only reviewed.
 */
let q = pgQuery;
export function __useQuery(fn) { q = fn ?? pgQuery; }

export const MATCH_ID = "live";
const START = 501;
const DOUBLE_OUT = true;

/** Seat 0 is X, seat 1 is O — the same tokens that gate tic-tac-toe. */
export function seatForToken(token) {
  if (!token) return null;
  if (config.players.X.token && token === config.players.X.token) return 0;
  if (config.players.O.token && token === config.players.O.token) return 1;
  return null;
}

export const seatName = (seat) => (seat === 0 ? config.players.X.name : config.players.O.name);

function freshState() {
  return { match: new Match({ start: START, doubleOut: DOUBLE_OUT }).toJSON() };
}

export async function getMatch() {
  const { rows } = await q(
    "select id, state, version, finished from public.darts_matches where id = $1",
    [MATCH_ID],
  );
  if (rows.length) return rows[0];
  await q(
    `insert into public.darts_matches (id, state, version, finished)
     values ($1, $2, 0, false) on conflict (id) do nothing`,
    [MATCH_ID, freshState()],
  );
  const again = await q(
    "select id, state, version, finished from public.darts_matches where id = $1",
    [MATCH_ID],
  );
  return again.rows[0];
}

/** Optimistic write. Returns false when someone else moved first. */
async function saveMatch(state, finished, version) {
  const { rowCount } = await q(
    `update public.darts_matches
        set state = $1, finished = $2, version = version + 1, updated_at = now()
      where id = $3 and version = $4`,
    [state, finished, MATCH_ID, version],
  );
  return rowCount === 1;
}

export async function listThrows(since = -1) {
  const { rows } = await q(
    `select seq, seat, launch, result from public.darts_throws
      where match_id = $1 and seq > $2 order by seq`,
    [MATCH_ID, since],
  );
  return rows;
}

/** 25s tolerance: browsers throttle timers hard once a tab loses focus. */
export async function listPresence() {
  const { rows } = await q(
    `select seat, name, spec, drunk,
            (now() - seen_at) < interval '25 seconds' as online
       from public.darts_presence where match_id = $1 order by seat`,
    [MATCH_ID],
  );
  return rows;
}

/**
 * Upsert a seat's presence. A heartbeat sends only the drunk level, so name
 * and spec must survive being omitted — hence nullif/coalesce rather than a
 * plain overwrite (the column is NOT NULL, so absent arrives as '').
 */
export async function touchPresence(seat, { name, spec, drunk }) {
  await q(
    `insert into public.darts_presence (match_id, seat, name, spec, drunk, seen_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (match_id, seat) do update
       set name = coalesce(nullif(excluded.name, ''), public.darts_presence.name),
           spec = coalesce(excluded.spec, public.darts_presence.spec),
           drunk = excluded.drunk,
           seen_at = now()`,
    [MATCH_ID, seat, name ?? "", spec ?? null, Number(drunk) || 0],
  );
}

/** Wipe the leg and start again. */
export async function resetMatch() {
  const g = await getMatch();
  await q("delete from public.darts_throws where match_id = $1", [MATCH_ID]);
  await saveMatch(freshState(), false, g.version);
  return getMatch();
}

/**
 * Tips of the darts still in the board this visit — a re-simulation needs them
 * to reproduce a deflection off an earlier dart.
 */
function liveTips(rows, visitStartSeq) {
  return rows
    .filter((r) => r.seq >= visitStartSeq && r.result?.type === "stick" && r.result?.surface === "board")
    .map((r) => r.result.point);
}

/**
 * Score a dart and advance the leg.
 * @returns {{ok: true, ...}|{ok: false, error: string}}
 */
export async function applyThrow(seat, launch) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const g = await getMatch();
    const match = Match.fromJSON(g.state.match);

    if (match.finished) return { ok: false, error: "match-over" };
    if (match.current !== seat) return { ok: false, error: "not-your-turn" };

    const rows = await listThrows(-1);
    const nextSeq = rows.length ? rows[rows.length - 1].seq + 1 : 0;
    // darts already in the board from this visit can be hit
    const visitStartSeq = nextSeq - (3 - match.dartsLeft);
    const result = resolveThrow(launch, liveTips(rows, visitStartSeq));

    const outcome = match.applyDart(result.score && result.value > 0 ? result.score : null);
    if (outcome.visitOver && !outcome.win) match.endVisit();

    const state = { match: match.toJSON() };
    if (!(await saveMatch(state, match.finished, g.version))) continue;   // lost the race, retry

    await q(
      `insert into public.darts_throws (match_id, seq, seat, launch, result)
       values ($1, $2, $3, $4, $5) on conflict do nothing`,
      [MATCH_ID, nextSeq, seat, launch, result],
    );

    return { ok: true, seq: nextSeq, result, outcome, match: state.match };
  }
  return { ok: false, error: "conflict" };
}

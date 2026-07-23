import pg from "pg";
import { config } from "../config.mjs";
import { newGame, finalizeByBoards } from "./engine.mjs";

// One pool per warm serverless instance. Supabase free tier is reached via the
// Supavisor pooler (the direct db.* host is IPv6-only, unreachable from Vercel).
const pool = (globalThis.__tttPool ??= new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: false },
  max: 3,
}));

export const q = (text, params) => pool.query(text, params);

export function etToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone }).format(new Date());
}

export function playerForToken(token) {
  if (!token) return null;
  for (const sym of ["X", "O"]) {
    const t = config.players[sym].token;
    if (t && t === token) return sym;
  }
  return null;
}

export async function listResults() {
  const { rows } = await q(
    "select date, winner, x_boards, o_boards, reason, moves from ttt_results order by date desc limit 365"
  );
  return rows;
}

export async function recordResult(date, st) {
  const res = finalizeByBoards(st);
  await q(
    `insert into ttt_results (date, winner, x_boards, o_boards, reason, moves)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (date) do update set winner = excluded.winner,
       x_boards = excluded.x_boards, o_boards = excluded.o_boards,
       reason = excluded.reason, moves = excluded.moves`,
    [date, res.winner, res.xBoards, res.oBoards, res.reason, st.moves.length]
  );
}

async function pickStarter(today) {
  // Yesterday's loser starts; after a draw (or on day one) alternate by date.
  const { rows } = await q(
    "select winner from ttt_results where date < $1 order by date desc limit 1",
    [today]
  );
  const prev = rows[0];
  if (prev?.winner === "X") return "O";
  if (prev?.winner === "O") return "X";
  return parseInt(today.replaceAll("-", ""), 10) % 2 === 0 ? "X" : "O";
}

// Returns today's game row {date, state, version, finished}, creating it (and
// finalizing any unfinished earlier day) on first touch after midnight ET.
export async function getOrCreateToday() {
  const today = etToday();
  const { rows: existing } = await q("select * from ttt_games where date = $1", [today]);
  if (existing.length) return existing[0];

  const { rows: openGames } = await q(
    "select * from ttt_games where finished = false and date < $1",
    [today]
  );
  for (const g of openGames) {
    const st = { ...g.state, winner: finalizeByBoards(g.state).winner, finishedAt: new Date().toISOString() };
    await q(
      "update ttt_games set state = $1, finished = true, version = $2 where date = $3 and version = $4",
      [st, g.version + 1, g.date, g.version]
    );
    if (st.moves.length > 0) await recordResult(g.date, g.state);
  }

  const state = newGame(await pickStarter(today));
  const { rows: inserted } = await q(
    "insert into ttt_games (date, state, version, finished) values ($1, $2, 0, false) on conflict (date) do nothing returning *",
    [today, state]
  );
  if (inserted.length) return inserted[0];
  // Lost the race to the other player's first request of the day.
  const { rows: again } = await q("select * from ttt_games where date = $1", [today]);
  return again[0];
}

// Optimistic write; true if we won the version race.
export async function saveGame(date, state, finished, prevVersion) {
  const { rowCount } = await q(
    "update ttt_games set state = $1, finished = $2, version = $3 where date = $4 and version = $5",
    [state, finished, prevVersion + 1, date, prevVersion]
  );
  return rowCount > 0;
}

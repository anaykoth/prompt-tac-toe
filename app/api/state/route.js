import { config } from "@/config.mjs";
import { getOrCreateToday, listResults, playerForToken } from "@/lib/db.mjs";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const url = new URL(req.url);
  const you = playerForToken(url.searchParams.get("token"));
  const g = await getOrCreateToday();

  const results = await listResults();
  const tally = { X: 0, O: 0, D: 0 };
  for (const r of results) tally[r.winner] = (tally[r.winner] ?? 0) + 1;

  return Response.json({
    you,
    names: { X: config.players.X.name, O: config.players.O.name },
    creditCap: config.creditCap,
    date: g.date,
    game: g.state,
    results: results.slice(0, 14),
    tally,
  });
}

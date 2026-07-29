import { getMatch, listThrows, listPresence, seatForToken } from "@/lib/darts.mjs";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const url = new URL(req.url);
  const since = Number(url.searchParams.get("since") ?? -1);
  const seat = seatForToken(url.searchParams.get("t"));
  const [g, throws, seats] = await Promise.all([getMatch(), listThrows(since), listPresence()]);
  return Response.json({
    ok: true, seat, version: g.version, finished: g.finished,
    match: g.state.match, throws, seats,
  });
}

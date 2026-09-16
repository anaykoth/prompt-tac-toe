import { getMatch, listPasses, listPresence, openPass, seatForToken } from "@/lib/joust.mjs";
export const dynamic = "force-dynamic";
export async function GET(req) {
  const url = new URL(req.url);
  const since = Number(url.searchParams.get("since") ?? -1);
  const seat = seatForToken(url.searchParams.get("t"));
  const [g, passes, seats, open] = await Promise.all([getMatch(), listPasses(since), listPresence(), openPass()]);
  return Response.json({ ok: true, seat, version: g.version, finished: g.finished, match: g.state, passes, open, seats, now: Date.now() });
}

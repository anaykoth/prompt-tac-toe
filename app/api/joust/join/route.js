import { getMatch, listPasses, listPresence, openPass, resetMatch, seatForToken, seatName, touchPresence } from "@/lib/joust.mjs";
export const dynamic = "force-dynamic";
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const seat = seatForToken(body.token ?? null);
  if (seat === null) return Response.json({ ok: false, error: "bad-token" }, { status: 401 });
  await touchPresence(seat, { name: seatName(seat), spec: body.spec ?? null, drunk: body.drunk ?? 0, ready: false });
  let g = await getMatch();
  if (body.newMatch && g.finished) g = await resetMatch();
  const [passes, seats, open] = await Promise.all([listPasses(-1), listPresence(), openPass()]);
  return Response.json({ ok: true, seat, name: seatName(seat), version: g.version, finished: g.finished,
    match: g.state, passes, open, seats, now: Date.now() });
}

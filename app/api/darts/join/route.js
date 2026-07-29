import { getMatch, listThrows, listPresence, resetMatch, seatForToken, seatName, touchPresence } from "@/lib/darts.mjs";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const seat = seatForToken(body.token ?? null);
  if (seat === null) return Response.json({ ok: false, error: "bad-token" }, { status: 401 });

  await touchPresence(seat, { name: seatName(seat), spec: body.spec ?? null, drunk: body.drunk ?? 0 });

  let g = await getMatch();
  // finished legs stay on screen until somebody asks for another
  if (body.newLeg && g.finished) g = await resetMatch();

  const [throws, seats] = await Promise.all([listThrows(-1), listPresence()]);
  return Response.json({
    ok: true, seat, name: seatName(seat), version: g.version,
    finished: g.finished, match: g.state.match, throws, seats,
  });
}

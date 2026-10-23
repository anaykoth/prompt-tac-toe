import { matchRequest } from "@/lib/match-context.mjs";
import { listPresence, seatForToken, touchPresence } from "@/lib/darts.mjs";

export const dynamic = "force-dynamic";

async function handle(req) {
  const body = await req.json().catch(() => ({}));
  const seat = seatForToken(body.token ?? null);
  if (seat === null) return Response.json({ ok: false, error: "bad-token" }, { status: 401 });
  await touchPresence(seat, { spec: body.spec ?? null, drunk: body.drunk ?? 0 });
  return Response.json({ ok: true, seats: await listPresence() });
}

export const POST = req => matchRequest(req,handle);

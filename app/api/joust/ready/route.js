import { markReady, seatForToken } from "@/lib/joust.mjs";
export const dynamic = "force-dynamic";
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const seat = seatForToken(body.token ?? null);
  if (seat === null) return Response.json({ ok: false, error: "bad-token" }, { status: 401 });
  const r = await markReady(seat);
  return Response.json({ ...r, now: Date.now() }, { status: r.ok ? 200 : 400 });
}

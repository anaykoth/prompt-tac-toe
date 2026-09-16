import { seatForToken, submitTrace, touchPresence } from "@/lib/joust.mjs";
export const dynamic = "force-dynamic";
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const seat = seatForToken(body.token ?? null);
  if (seat === null) return Response.json({ ok: false, error: "bad-token" }, { status: 401 });
  if (!Number.isInteger(body.pass_no)) return Response.json({ ok: false, error: "bad-pass" }, { status: 400 });
  const r = await submitTrace(seat, body.pass_no, body.trace);
  if (r.ok && Number.isFinite(body.drunk)) await touchPresence(seat, { drunk: body.drunk }).catch(() => {});
  return Response.json({ ...r, now: Date.now() }, { status: r.ok ? 200 : r.error === "conflict" ? 409 : 400 });
}

import { applyThrow, seatForToken, touchPresence } from "@/lib/darts.mjs";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const seat = seatForToken(body.token ?? null);
  if (seat === null) return Response.json({ ok: false, error: "bad-token" }, { status: 401 });

  const L = body.launch;
  const ok3 = (a) => Array.isArray(a) && a.length === 3 && a.every((n) => Number.isFinite(n));
  if (!L || !ok3(L.from) || !ok3(L.vel) || !Number.isFinite(L.seed)) {
    return Response.json({ ok: false, error: "bad-launch" }, { status: 400 });
  }
  // a launch is only ever a throw: keep speeds and origins inside the room
  const speed = Math.hypot(...L.vel);
  if (speed > 25 || L.from[2] < -1 || L.from[2] > 6 || Math.abs(L.from[0]) > 3) {
    return Response.json({ ok: false, error: "bad-launch" }, { status: 400 });
  }

  const res = await applyThrow(seat, {
    from: L.from, vel: L.vel,
    wobble: Number(L.wobble) || 0, roll: Number(L.roll) || 0,
    magnus: Number(L.magnus) || 0, seed: L.seed >>> 0,
  });
  if (!res.ok) return Response.json(res, { status: res.error === "conflict" ? 409 : 400 });

  if (Number.isFinite(body.drunk)) {
    await touchPresence(seat, { drunk: body.drunk }).catch(() => {});
  }
  return Response.json(res);
}

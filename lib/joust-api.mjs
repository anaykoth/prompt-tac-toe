import { TIMING, getMatch, markReady, resetMatch, seatForToken, seatName, snapshot, submitTrace, touchPresence } from "./joust.mjs";

/**
 * The five jousting endpoints as one function, so the route handlers and the
 * in-process end-to-end test run the exact same code. Returns {status, body}.
 */
export async function handleJoust(action, p = {}) {
  const seat = seatForToken(p.token ?? null);
  if (action === "state") {
    const since = Number(p.since ?? -1);
    return { status: 200, body: { ok: true, seat, ...(await snapshot(Number.isFinite(since) ? since : -1)) } };
  }
  if (seat === null) return { status: 401, body: { ok: false, error: "bad-token" } };

  switch (action) {
    case "join": {
      await touchPresence(seat, { name: seatName(seat), spec: p.spec ?? null, drunk: p.drunk ?? 0, ready: false });
      const g = await getMatch();
      if (p.newMatch && g.finished) await resetMatch();
      return { status: 200, body: { ok: true, seat, name: seatName(seat), ...(await snapshot(-1)) } };
    }
    case "ready": {
      const r = await markReady(seat);
      return { status: r.ok ? 200 : 400, body: { ...r, timing: TIMING, now: Date.now() } };
    }
    case "trace": {
      if (!Number.isInteger(p.pass_no)) return { status: 400, body: { ok: false, error: "bad-pass" } };
      const r = await submitTrace(seat, p.pass_no, p.trace);
      if (r.ok && Number.isFinite(p.drunk)) await touchPresence(seat, { drunk: p.drunk }).catch(() => {});
      return { status: r.ok ? 200 : r.error === "conflict" ? 409 : 400, body: { ...r, now: Date.now() } };
    }
    case "presence": {
      await touchPresence(seat, { spec: p.spec ?? null, drunk: p.drunk ?? 0 });
      const s = await snapshot(-1);
      return { status: 200, body: { ok: true, seats: s.seats, now: s.now } };
    }
    default:
      return { status: 404, body: { ok: false, error: "no-such-action" } };
  }
}

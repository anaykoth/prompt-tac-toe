import { applyMove } from "@/lib/engine.mjs";
import { getOrCreateToday, playerForToken, recordResult, saveGame } from "@/lib/db.mjs";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const p = playerForToken(body.token ?? null);
  if (!p) return Response.json({ ok: false, error: "bad-token" }, { status: 401 });
  const b = Number(body.board);
  const c = Number(body.cell);

  for (let i = 0; i < 4; i++) {
    const g = await getOrCreateToday();
    const st = structuredClone(g.state);
    const res = applyMove(st, p, b, c, new Date().toISOString());
    if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 400 });
    const finished = !!st.winner;
    if (await saveGame(g.date, st, finished, g.version)) {
      if (finished) await recordResult(g.date, st);
      return Response.json({ ok: true, game: st });
    }
  }
  return Response.json({ ok: false, error: "conflict" }, { status: 409 });
}

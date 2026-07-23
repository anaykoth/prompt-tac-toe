import { config } from "@/config.mjs";
import { getOrCreateToday, playerForToken, saveGame } from "@/lib/db.mjs";

export const dynamic = "force-dynamic";

// Called by each player's Claude Code UserPromptSubmit hook. Banks one move
// credit (up to the cap) and counts the prompt.
export async function POST(req) {
  let token = null;
  try {
    const body = await req.json();
    token = body?.token ?? null;
  } catch {}
  token ??= new URL(req.url).searchParams.get("token");
  const p = playerForToken(token);
  if (!p) return Response.json({ ok: false, error: "bad-token" }, { status: 401 });

  for (let i = 0; i < 4; i++) {
    const g = await getOrCreateToday();
    const st = structuredClone(g.state);
    st.prompts[p] = (st.prompts[p] ?? 0) + 1;
    const before = st.credits[p] ?? 0;
    if (!st.winner) st.credits[p] = Math.min(config.creditCap, before + 1);
    if (await saveGame(g.date, st, g.finished, g.version)) {
      return Response.json({
        ok: true,
        player: p,
        credits: st.credits[p],
        banked: st.credits[p] - before,
      });
    }
  }
  return Response.json({ ok: false, error: "conflict" }, { status: 409 });
}

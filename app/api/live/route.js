import { seatForToken } from '@/lib/darts.mjs';
import { signTicket } from '@/games/shared/server/tickets.js';
export const dynamic = 'force-dynamic';
export async function POST(req) {
  const p = await req.json().catch(() => ({})),
    seat = seatForToken(p.token);
  if (seat === null) return Response.json({ ok: false, error: 'bad-token' }, { status: 401 });
  const room = p.room ?? 'live';
  if (!['darts', 'joust'].includes(p.game) || !/^[a-zA-Z0-9_-]{1,48}$/.test(room))
    return Response.json({ ok: false, error: 'bad-room' }, { status: 400 });
  const url = process.env.GAME_LIVE_URL;
  if (!url || !process.env.GAME_LIVE_SECRET)
    return Response.json({ ok: false, error: 'Live game server is not configured' }, { status: 503 });
  try {
    return Response.json(
      { ok: true, url, ticket: signTicket({ game: p.game, room, seat }, process.env.GAME_LIVE_SECRET) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json({ ok: false, error: 'Live game server is not configured' }, { status: 503 });
  }
}

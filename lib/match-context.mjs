import { AsyncLocalStorage } from 'node:async_hooks';
const context = new AsyncLocalStorage();
export const currentMatchId = (fallback = 'live') => context.getStore() ?? fallback;
export function inMatch(room, fn) {
  const id = room ?? 'live';
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,48}$/.test(id)) throw Error('bad-room');
  return context.run(id, fn);
}
export async function matchRequest(req, handler) {
  const p =
    req.method === 'GET'
      ? Object.fromEntries(new URL(req.url).searchParams)
      : await req
          .clone()
          .json()
          .catch(() => ({}));
  try {
    return await inMatch(p.room, () => handler(req));
  } catch (e) {
    if (e.message === 'bad-room') return Response.json({ ok: false, error: 'bad-room' }, { status: 400 });
    throw e;
  }
}

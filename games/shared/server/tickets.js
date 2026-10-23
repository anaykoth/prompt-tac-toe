import { createHmac, timingSafeEqual } from 'node:crypto';

export function signTicket(claims, secret, now = Date.now()) {
  if (!secret || secret.length < 32) throw Error('GAME_LIVE_SECRET must contain at least 32 characters');
  const body = Buffer.from(JSON.stringify({ ...claims, expires: now + 60_000 })).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export function verifyTicket(ticket, secret, now = Date.now()) {
  if (!secret || typeof ticket !== 'string' || ticket.length > 2048) return null;
  try {
    const [body, sig, ...extra] = ticket.split('.');
    if (extra.length) return null;
    const actual = Buffer.from(sig, 'base64url'),
      expected = createHmac('sha256', secret).update(body).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (
      !['darts', 'joust'].includes(p.game) ||
      ![0, 1].includes(p.seat) ||
      !/^[a-zA-Z0-9_-]{1,48}$/.test(p.room) ||
      !Number.isFinite(p.expires) ||
      p.expires < now
    )
      return null;
    return p;
  } catch {
    return null;
  }
}

/**
 * Stand-in pass sim used by the wire harness and, until games/joust lands,
 * by the server (see lib/joust-resolver.mjs). Whoever leaned harder at the
 * last sample scores; the seed decides 1 or 2 points. Pure, no randomness.
 */
export function resolvePass(traceA, traceB, seed) {
  const la = traceA[traceA.length - 1]?.lean ?? 0;
  const lb = traceB[traceB.length - 1]?.lean ?? 0;
  if (la === lb) return { hits: [], unhorsed: null };
  return { hits: [{ seat: la > lb ? 0 : 1, zone: 'shield', points: 1 + ((seed >>> 0) % 2) }], unhorsed: null };
}

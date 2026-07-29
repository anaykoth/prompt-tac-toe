/**
 * Deterministic randomness for anything that decides where a dart ends up.
 *
 * Online play sends a throw as launch parameters plus a seed and lets both
 * clients — and the server — run the identical simulation. That only works if
 * every random draw in the flight path comes from here in the same order.
 * Cosmetic randomness (crowd, arena, audio) deliberately still uses
 * Math.random(); those are allowed to differ between screens.
 */

/** Small, fast, well-distributed 32-bit PRNG. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed you can put in JSON and hand to the other end of the wire. */
export function newSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

/** Box–Muller normal draw from a given uniform source. */
export function gaussFrom(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

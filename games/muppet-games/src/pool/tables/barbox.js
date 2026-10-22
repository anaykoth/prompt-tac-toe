/**
 * The house table: a 7-foot bar box, as built through all the earlier rounds.
 * This is the reference implementation of the design contract — the other
 * designs are variations on it, and it is the one to copy from.
 */
import { TABLE, buildTableGeometry, rackEight } from '../physics.js';
import { buildTable } from '../table.js';

export default {
  meta: {
    id: 'barbox',
    name: 'THE HOUSE TABLE',
    blurb: '7-foot bar box. Slow cloth, heavy rails, a cigarette burn near the spot.',
  },
  bounds: { halfLen: TABLE.halfLen, halfWid: TABLE.halfWid },
  height: TABLE.height,
  buildGeometry: () => buildTableGeometry(),
  buildMesh: () => buildTable().group,
  rack: (rng) => rackEight(rng),
  cueSpot: { x: -TABLE.halfLen * 0.5, z: 0 },
  terrain: null,
};

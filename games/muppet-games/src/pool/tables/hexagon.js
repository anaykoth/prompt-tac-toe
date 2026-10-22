import { TABLE, BALL_R, makeBall } from '../physics.js';
import { polygonGeometry, polygonMesh, inPolygon, distToEdge } from './polygon.js';

/**
 * A hexagonal table.
 *
 * Six cushions, a pocket at every vertex. The thing someone commissioned in
 * 1974 for a games room and regretted within the month: it plays surprisingly
 * well, but every angle you have ever learned is wrong on it, because a hexagon
 * has 120° corners and a ball off two cushions comes back where a rectangle
 * says it should not.
 */

/* Circumradius. A regular hexagon of side R has area (3√3/2)R², so R = 1.06 m
   gives about 2.9 m² — near enough a 7-foot table's 1.96 m², a shade larger to
   keep the middle from feeling cramped with six pockets pulling at it. */
const R = 1.06;

const OUTLINE = Array.from({ length: 6 }, (_, i) => {
  const a = (i / 6) * Math.PI * 2 + Math.PI / 6;   // flat sides top and bottom
  return { x: Math.cos(a) * R, z: Math.sin(a) * R };
});

/* A hexagon's corners are 120°, so a mouth of a given width eats less of each
   edge than a rectangle's 90° corner does — which leaves plenty of cushion and
   is why six pockets fit at all. */
const MOUTH = 0.125;

export default {
  meta: {
    id: 'hexagon',
    name: 'THE HEXAGON',
    blurb: 'Six cushions, six pockets, and every angle you know is wrong.',
  },

  // exposed so the containment tests can ask what 'inside' means
  outline: OUTLINE,
  // ball-in-hand has to respect the actual shape, not a bounding rectangle
  inBounds: (x, z, r) => inPolygon(OUTLINE, x, z) && distToEdge(OUTLINE, x, z) > r * 1.6,
  bounds: { halfLen: R, halfWid: R * Math.sin(Math.PI / 3) },
  height: TABLE.height,

  buildGeometry: () => polygonGeometry(OUTLINE, [0, 1, 2, 3, 4, 5], {
    mouth: () => MOUTH,
    kind: () => 'corner',
  }),

  buildMesh: (geo) => polygonMesh(geo, OUTLINE, {
    feltBase: [26, 74, 92],          // a municipal teal, because of course
    woodColour: '#7a5b3a',
    legCount: 6,
  }),

  /* A triangle is a rectangle's shape, not a hexagon's. Fifteen balls sit
     naturally as a centred hexagonal cluster — one in the middle, a ring of
     six, then eight of the next ring — which racks tight and breaks outward in
     every direction instead of down a table. */
  rack(rng = Math.random) {
    const gap = BALL_R * 2 + 0.0004;
    const spots = [{ q: 0, r: 0 }];
    for (let ring = 1; ring <= 2 && spots.length < 15; ring++) {
      for (let side = 0; side < 6 && spots.length < 15; side++) {
        for (let step = 0; step < ring && spots.length < 15; step++) {
          const a = (side / 6) * Math.PI * 2;
          const b = ((side + 2) / 6) * Math.PI * 2;
          spots.push({
            q: Math.cos(a) * ring + Math.cos(b) * step,
            r: Math.sin(a) * ring + Math.sin(b) * step,
          });
        }
      }
    }

    const nums = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
    for (let i = nums.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [nums[i], nums[j]] = [nums[j], nums[i]];
    }
    // the 8 goes in the middle, as it does everywhere else
    const order = [8, ...nums];

    // the cluster sits towards one flat side, leaving a clean break line
    const cx = R * 0.34, cz = 0;
    return [
      makeBall(0, -R * 0.5, 0),
      ...spots.map((s, i) => makeBall(order[i], cx + s.q * gap, cz + s.r * gap)),
    ];
  },

  cueSpot: { x: -R * 0.5, z: 0 },
  terrain: null,
};

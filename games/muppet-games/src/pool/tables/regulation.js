import * as THREE from 'three';
import { TABLE, BALL_R, buildTableGeometry, makeBall } from '../physics.js';
import { buildTable } from '../table.js';

/**
 * A regulation nine-foot table, built to the WPA/BCA equipment spec.
 *
 * Everything here is the published figure rather than something chosen to look
 * right — the point of this design is that it is the real thing, and the bar
 * box next to it is visibly not. The one number worth watching is the cushion
 * nose: the sim strikes at CFG.railNose radii above centre, so the rubber has
 * to be built to that same height or the picture would be lying about the
 * physics.
 */

const IN = 0.0254;

export const REGULATION = {
  ...TABLE,

  // 100" x 50" nose to nose, exactly 2:1, which is what nine-foot means
  halfLen: 50 * IN,
  halfWid: 25 * IN,
  height: 0.79,                          // 29.25", the middle of the legal band

  // 4.5" corners and 5" sides: the tight end of the spec, as a tournament table
  cornerMouth: 4.5 * IN,
  sideMouth: 5.0 * IN,
  cornerShelf: 1.625 * IN,               // a real shelf, so corners can hang
  sideShelf: 0.35 * IN,
  cornerBack: 0.150,
  sideBack: 0.150,

  noseHeight: BALL_R * 2 * 0.635,        // 63.5% of ball diameter, mid-spec
  cushionTop: 0.0415,
  cushionDepth: 0.048,
  railWidth: 0.178,                      // 7", inside the 4"-7.5" allowed
  railTop: 0.044,
  slate: 25.4 / 1000,                    // 1" slate, as a nine-footer carries
};

/** The standard triangle, apex on the foot spot, 8 in the middle. */
function rackNine(rng = Math.random) {
  const gap = BALL_R * 2 + 0.0004;
  const apexX = REGULATION.halfLen * 0.5;      // the foot spot
  const rowDx = (gap * Math.sqrt(3)) / 2;

  const solids = [1, 2, 3, 4, 5, 6, 7];
  const stripes = [9, 10, 11, 12, 13, 14, 15];
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  shuffle(solids); shuffle(stripes);

  const order = new Array(15).fill(0);
  order[0] = solids.pop();                     // apex
  order[4] = 8;                                // centre of the third row
  order[10] = solids.pop();                    // back corners, one of each
  order[14] = stripes.pop();
  const rest = shuffle(solids.concat(stripes));
  for (let i = 0; i < 15; i++) if (!order[i]) order[i] = rest.pop();

  const balls = [makeBall(0, -REGULATION.halfLen * 0.5, 0)];
  let i = 0;
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k <= row; k++) {
      balls.push(makeBall(order[i++], apexX + row * rowDx, (k - row / 2) * gap));
    }
  }
  return balls;
}

export default {
  meta: {
    id: 'regulation',
    name: 'THE NINE FOOTER',
    blurb: '100" x 50", tight pockets, fast cloth. Somebody has looked after this one.',
  },

  bounds: { halfLen: REGULATION.halfLen, halfWid: REGULATION.halfWid },
  height: REGULATION.height,
  spec: REGULATION,

  buildGeometry: () => buildTableGeometry(REGULATION),

  buildMesh(geo) {
    const group = buildTable(REGULATION).group;

    /* Dress it as the room's one good table: a fitted cover folded over the end
       rail, and a brass plate nobody has polished since the tournament. */
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const cover = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.06, 0.30),
      std({ color: '#2b2f3a', roughness: 0.95 }),
    );
    cover.position.set(
      -REGULATION.halfLen - REGULATION.railWidth * 0.4,
      REGULATION.height + REGULATION.cushionTop + 0.03,
      REGULATION.halfWid * 0.45,
    );
    cover.rotation.y = 0.12;
    cover.castShadow = true;
    group.add(cover);

    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.004, 0.05),
      std({ color: '#b9922f', roughness: 0.35, metalness: 0.85 }),
    );
    plate.position.set(
      0,
      REGULATION.height + REGULATION.cushionTop - 0.001,
      -REGULATION.halfWid - REGULATION.railWidth * 0.72,
    );
    group.add(plate);

    return group;
  },

  rack: (rng) => rackNine(rng),
  cueSpot: { x: -REGULATION.halfLen * 0.5, z: 0 },
  terrain: null,
};

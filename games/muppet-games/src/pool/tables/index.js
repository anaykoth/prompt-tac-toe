/**
 * Table designs.
 *
 * The sim does not assume a rectangle. Cushions are already line segments with
 * an inward normal, jaws are circles, pockets are built from a mouth by
 * `makePocket`, and the bed can carry a height field — so a design is mostly
 * data, and anything from a regulation nine-footer to a hexagon to a lunatic
 * polygon with islands in it plugs into the same physics.
 *
 * ---------------------------------------------------------------------------
 * THE CONTRACT
 *
 * A design module default-exports an object:
 *
 *   {
 *     meta: { id, name, blurb },
 *
 *     // Half-extents of the playing surface, for cameras, racking and
 *     // ball-in-hand. Even a non-rectangular table needs a bounding box.
 *     bounds: { halfLen, halfWid },
 *
 *     height: 0.78,                    // cloth height above the floor
 *
 *     // The physics geometry. Must return the same shape buildTableGeometry
 *     // does: every field is used by the sim and the renderer.
 *     buildGeometry() => {
 *       cushions: [{ ax, az, bx, bz, nx, nz }],   // nx,nz points INTO the table
 *       jaws:     [{ x, z, r }],                  // rounded cushion ends
 *       pockets:  [ makePocket(...) ],            // use the shared helper
 *       facings:  [{ ax, az, bx, bz, nx, nz, pocket, len, awayX, awayZ }],
 *     },
 *
 *     // The 3D table. Free-form: build whatever suits the design, using the
 *     // geometry above so the picture matches the physics.
 *     buildMesh(geo) => THREE.Group,
 *
 *     // Starting ball layout. Ball 0 is the cue ball.
 *     rack(rng) => [ makeBall(...) ],
 *
 *     // Where the cue ball goes for a break / ball in hand.
 *     cueSpot: { x, z },
 *
 *     // Optional. Bed height and slope under a point, for non-flat tables:
 *     //   terrain(x, z) => { h, gx, gz }
 *     // h is metres above the nominal bed; gx/gz are dh/dx and dh/dz. A rolling
 *     // ball accelerates downhill at (5/7)·g·slope, which the sim applies.
 *     terrain: null,
 *   }
 *
 * INVARIANTS every design must hold — these are the ones that have actually
 * bitten, so they are worth stating:
 *
 *  - A cushion's normal points into the playing area, and the pocket mouths are
 *    the gaps between cushion ends. Nothing else may be open, or balls escape.
 *  - Nothing drawn may cross a cushion nose line into the playing area.
 *  - The visible hole should agree with where the ball is actually captured.
 *  - Shapes extruded with rotateX(-90°) grow UPWARD from their translate point.
 *  - THREE.Shape outlines must be counter-clockwise or the solid is inside-out
 *    and you can see through it.
 * ---------------------------------------------------------------------------
 */

import barbox from './barbox.js';
import regulation from './regulation.js';
import hexagon from './hexagon.js';
import chaos from './chaos.js';
import terrain from './terrain.js';

/* Imported statically, not lazily.
   The game asks for its design synchronously while it is building the world, so
   a registry that fills in later is a registry that is always empty when it
   matters — every lookup falls back to the house table and every design looks
   identical. Anything that must be ready before the first frame has to be a
   plain import. */
const ALL = [barbox, regulation, hexagon, chaos, terrain];

/* A design that cannot build is dropped here rather than at the first frame, so
   one bad table cannot take the game down with it. */
const DESIGNS = ALL.filter((d) => {
  try {
    if (!d?.meta?.id || typeof d.buildGeometry !== 'function') throw new Error('bad shape');
    const geo = d.buildGeometry();
    if (!geo.cushions?.length || !geo.pockets?.length) throw new Error('no cushions or pockets');
    return true;
  } catch (err) {
    console.warn(`[tables] "${d?.meta?.id ?? '?'}" failed to build and was skipped:`, err?.message ?? err);
    return false;
  }
});

/** Kept async so callers that already await it do not have to change. */
export async function loadDesigns() { return DESIGNS; }

export const designs = () => DESIGNS;

export const getDesign = (id) => DESIGNS.find((d) => d.meta.id === id) ?? DESIGNS[0];

export default DESIGNS;

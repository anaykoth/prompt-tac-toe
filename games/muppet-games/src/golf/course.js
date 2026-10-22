// One shared surface for rendering, ball collisions, lies and the yardage map.
export const COURSES = {
  bramble: { id:'bramble', name:'Bramble Rise', subtitle:'ROLLING HILLS', par:4, length:315, seed:721, theme:'parkland',
    tee:{x:0,z:0},cup:{x:14,z:-315},green:{x:18,z:-310,rx:20,rz:26},greenHeight:9,greenSlope:[.013,.006],
    bunkers:[{x:34,z:-170,rx:9,rz:17,angle:-.35},{x:-13,z:-286,rx:9,rz:13,angle:-.6},{x:41,z:-319,rx:8,rz:15,angle:.3}] },
  saltwind: { id:'saltwind', name:'Saltwind Links', subtitle:'COASTAL DUNES', par:3, length:185, seed:1947, theme:'coast',
    tee:{x:0,z:0},cup:{x:-12,z:-185},green:{x:-8,z:-182,rx:19,rz:24},greenHeight:6,greenSlope:[-.014,.009],
    bunkers:[{x:17,z:-114,rx:11,rz:17,angle:.45},{x:-35,z:-168,rx:8,rz:15,angle:-.2},{x:17,z:-193,rx:9,rz:12,angle:.4}] },
  pine: { id:'pine', name:'Pine Hollow', subtitle:'WOODLAND VALLEY', par:5, length:390, seed:3719, theme:'woodland',
    tee:{x:0,z:0},cup:{x:24,z:-390},green:{x:20,z:-387,rx:21,rz:26},greenHeight:12,greenSlope:[.008,-.015],
    bunkers:[{x:-29,z:-160,rx:8,rz:18,angle:-.4},{x:39,z:-270,rx:8,rz:20,angle:.5},{x:-8,z:-364,rx:10,rz:14,angle:-.6},{x:45,z:-404,rx:8,rz:12,angle:.3}] },
};
// A room plays one shared course. Switching courses resets every player's round.
export let HOLE = COURSES.bramble;
export let BUNKERS = HOLE.bunkers;
export function selectCourse(id){if(!Object.hasOwn(COURSES,id))return false;HOLE=COURSES[id];BUNKERS=HOLE.bunkers;return true;}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const fairwayX = z => HOLE.id==='bramble'?16*Math.sin(-z/48)+12*smooth(230,310,-z):HOLE.id==='saltwind'?9*Math.sin(-z/42)-12*smooth(70,185,-z):19*Math.sin(-z/65)+24*smooth(230,390,-z);
export const fairwayWidth = z => (HOLE.id==='pine'?12:HOLE.id==='saltwind'?18:15) + 5 * Math.sin(z / 65) ** 2 + 3 * Math.exp(-(((z + 155) / 42) ** 2));
export function ellipse(x, z, e) {
  const dx = x - e.x, dz = z - e.z, c = Math.cos(e.angle || 0), s = Math.sin(e.angle || 0);
  return Math.hypot((dx * c + dz * s) / e.rx, (dz * c - dx * s) / e.rz);
}
export function bunkerDistance(x, z, b) {
  return ellipse(x, z, b) + .07 * Math.sin((x - b.x) * .5) * Math.cos((z - b.z) * .35);
}
export function heightAt(x, z) {
  const sideways = x - fairwayX(z);
  const centre = HOLE.id==='bramble'?6+3*Math.cos((z+8)/47)+9*Math.exp(-(((z+172)/42)**2)):HOLE.id==='saltwind'?4+2*Math.cos(z/35)+3*Math.exp(-(((z+90)/35)**2)):8+4*Math.cos(z/67)+7*Math.exp(-(((z+245)/48)**2));
  const edge = smooth(20, 80, Math.abs(sideways));
  let h = centre + .012 * sideways + .6 * Math.sin(x / 19 + z / 33)
    + edge * (5 + 7 * Math.sin(x / 36 + z / 90) ** 2 + 5 * Math.cos(z / 40) ** 2);
  const g = HOLE.green, dx = x - g.x, dz = z - g.z;
  const green = HOLE.greenHeight + HOLE.greenSlope[0] * dx + HOLE.greenSlope[1] * dz + .0006 * dx * dx + .0003 * dz * dz;
  h += (green - h) * (1 - smooth(.9, 1.45, ellipse(x, z, g)));
  h += (9 - h) * (1 - smooth(1, 1.6, ellipse(x, z, { x: 0, z: 1, rx: 6, rz: 9 })));
  for (const b of BUNKERS) h -= .8 * (1 - smooth(.4, 1.2, bunkerDistance(x, z, b)));
  if(HOLE.theme==='coast')h+=(.2-h)*smooth(90,153,-x);
  return h;
}
export function slopeAt(x, z) {
  const d = .15;
  return { x: (heightAt(x + d, z) - heightAt(x - d, z)) / (2 * d), z: (heightAt(x, z + d) - heightAt(x, z - d)) / (2 * d) };
}
export function surfaceAt(x, z) {
  if (BUNKERS.some(b => bunkerDistance(x, z, b) < 1)) return 'bunker';
  const g = ellipse(x, z, HOLE.green);
  if (g < 1) return 'green';
  if (g < 1.14) return 'fringe';
  if (ellipse(x, z, { x: 0, z: 1, rx: 6, rz: 9 }) < 1) return 'tee';
  if (z < -4 && z > -HOLE.length-5 && Math.abs(x - fairwayX(z)) < fairwayWidth(z)) return 'fairway';
  return 'rough';
}
export const distanceToPin = p => Math.hypot(p.x - HOLE.cup.x, p.z - HOLE.cup.z);
export const headingToPin = p => Math.atan2(HOLE.cup.x - p.x, p.z - HOLE.cup.z);
export const outOfBounds = p => Math.abs(p.x) > 140 || p.z < -HOLE.length-90 || p.z > 40;
export const PUTTING_DRILLS = {
  tap: { label: '1 m · tap-in', distance: 1, heading: 0 },
  short: { label: '3 m · short putt', distance: 3, heading: 0 },
  medium: { label: '6 m · read the break', distance: 6, heading: 0 },
  standard: { label: '8 m · original green', distance: 8, heading: 0 },
  long: { label: '12 m · lag putting', distance: 12, heading: 0 },
  reverse: { label: '6 m · opposite break', distance: 6, heading: Math.PI },
};
export const puttingStart = (drill = 'standard') => {
  const d=PUTTING_DRILLS[drill]||PUTTING_DRILLS.standard;
  return { x: HOLE.cup.x-Math.sin(d.heading)*d.distance, z: HOLE.cup.z+Math.cos(d.heading)*d.distance };
};
export function recommendedClub(p) {
  const d = distanceToPin(p), lie = surfaceAt(p.x, p.z);
  if (lie === 'green' || (lie === 'fringe' && d < 22)) return 'putter';
  if (lie === 'bunker' || d < 60) return 'sand';
  if (d < 105) return 'wedge';
  if (d < 170) return 'iron';
  return lie === 'tee' ? 'driver' : 'wood';
}

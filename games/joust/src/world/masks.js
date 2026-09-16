import * as THREE from 'three';

/**
 * Masks bolted to a rider's great helm. Everything is procedural.
 *
 * The returned group is positioned in the puppet's HEAD-PIVOT local space:
 * the head sphere has radius 0.24 and the pivot origin is the head centre, so
 * y = 0.24 is the crown and z = +0.24 is the face.
 */

export const MASKS = {
  none: { label: 'BARE HELM', cost: 0 },
  jester: { label: 'JESTER', cost: 80 },
  plague: { label: 'PLAGUE DOCTOR', cost: 120 },
  horsehead: { label: 'HORSE HEAD', cost: 160 },
  bucket: { label: 'BUCKET', cost: 40 },
  frida: { label: 'FRIDA', cost: 200 },
};

const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0, ...o });

const BLOOMS = ['#ff3d6e', '#ffd23d', '#ff7a1a', '#f4f1e6', '#d84fff', '#ff5b4a', '#4fd0ff'];

/**
 * @param key   one of MASKS
 * @param opts  { accent, fur } — the rider's accent colour and fur colour
 */
export function buildMask(key, { accent = '#ffe14a', fur = '#7ee06a' } = {}) {
  const g = new THREE.Group();
  g.name = 'mask:' + key;
  const add = (geo, mat, pos, rot, shadow = false) => {
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    m.castShadow = shadow;
    g.add(m);
    return m;
  };
  if (!key || key === 'none' || !MASKS[key]) return g;

  const contrast = new THREE.Color(accent).offsetHSL(0.45, 0, 0).getStyle();

  switch (key) {
    case 'jester': {
      const a = std(accent), b = std(contrast);
      const brim = add(new THREE.TorusGeometry(0.24, 0.035, 8, 18), b, [0, 0.19, 0], [Math.PI / 2, 0, 0]);
      brim.castShadow = true;
      // three points, alternating colours, each with a bell
      const dirs = [[0, 0.42, 0.24], [-0.34, 0.34, -0.1], [0.34, 0.34, -0.1]];
      for (let i = 0; i < 3; i++) {
        const [dx, dy, dz] = dirs[i];
        const len = 0.34;
        const cone = add(new THREE.ConeGeometry(0.1, len, 8).translate(0, len / 2, 0), i % 2 ? b : a,
          [dx * 0.55, 0.2, dz * 0.55], [dz * 1.5, 0, -dx * 1.5], true);
        const bell = add(new THREE.SphereGeometry(0.048, 10, 8), std('#e8c34a', { metalness: 0.6, roughness: 0.3 }),
          [dx, 0.2 + dy * 0.62, dz]);
        bell.castShadow = false;
      }
      add(new THREE.SphereGeometry(0.25, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2.2), a, [0, 0.03, 0], null, true);
      break;
    }

    case 'plague': {
      const black = std('#141218', { roughness: 0.7 });
      const leather = std('#2b2119', { roughness: 0.75 });
      // hood
      add(new THREE.SphereGeometry(0.29, 18, 14, 0, Math.PI * 2, 0, Math.PI / 1.75), black, [0, 0.0, -0.02], null, true);
      // long beak
      const beak = add(new THREE.ConeGeometry(0.11, 0.5, 10).rotateX(Math.PI / 2).translate(0, 0, 0.25), leather,
        [0, -0.01, 0.18], [0.25, 0, 0], true);
      // round glass eyes
      const glass = std('#cfe6d8', { roughness: 0.1, metalness: 0.4 });
      const rim = std('#4a3320', { roughness: 0.6 });
      for (const sx of [-1, 1]) {
        add(new THREE.SphereGeometry(0.072, 14, 12).scale(1, 1, 0.55), glass, [sx * 0.11, 0.1, 0.22]);
        add(new THREE.TorusGeometry(0.075, 0.018, 8, 16), rim, [sx * 0.11, 0.1, 0.24]);
      }
      // brim
      add(new THREE.CylinderGeometry(0.34, 0.34, 0.022, 20), black, [0, 0.2, -0.01], null, true);
      break;
    }

    case 'horsehead': {
      const coat = std('#c9c3b2'), dark = std('#2b1a0e');
      const skull = add(new THREE.SphereGeometry(0.2, 16, 14), coat, [0, 0.14, 0.06], null, true);
      skull.scale.set(0.85, 1, 0.95);
      add(new THREE.BoxGeometry(0.19, 0.17, 0.32), coat, [0, 0.1, 0.3], [0.12, 0, 0], true);
      for (const sx of [-1, 1]) {
        add(new THREE.SphereGeometry(0.03, 8, 6), dark, [sx * 0.05, 0.06, 0.44]);
        add(new THREE.ConeGeometry(0.052, 0.19, 8).translate(0, 0.095, 0), coat,
          [sx * 0.1, 0.3, 0.0], [0, 0, -sx * 0.3]);
        add(new THREE.SphereGeometry(0.06, 12, 10), std('#fdfbf4', { roughness: 0.2 }), [sx * 0.15, 0.24, 0.14]);
        add(new THREE.SphereGeometry(0.03, 10, 8), std('#0a090c', { roughness: 0.15 }), [sx * 0.18, 0.24, 0.17]);
      }
      for (let i = 0; i < 6; i++) {
        add(new THREE.ConeGeometry(0.045, 0.16, 6).translate(0, 0.08, 0), dark,
          [0, 0.28 - i * 0.035, -0.02 - i * 0.05], [1.2 + i * 0.1, 0, (i % 2 ? 1 : -1) * 0.2]);
      }
      break;
    }

    case 'bucket': {
      const tin = std('#9aa2a8', { metalness: 0.7, roughness: 0.38 });
      add(new THREE.CylinderGeometry(0.27, 0.22, 0.42, 18, 1, true), tin, [0, 0.1, 0], null, true);
      add(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 18), tin, [0, 0.31, 0]);   // the base, on top
      add(new THREE.TorusGeometry(0.272, 0.016, 7, 20), tin, [0, -0.1, 0], [Math.PI / 2, 0, 0]);
      // handle, up
      const handle = add(new THREE.TorusGeometry(0.26, 0.016, 6, 16, Math.PI), tin, [0, 0.31, 0], [0, Math.PI / 2, 0]);
      handle.castShadow = true;
      break;
    }

    case 'frida': {
      const hairMat = std('#14100f', { roughness: 0.9 });
      const skinBrow = std('#241b14', { roughness: 0.9 });
      const gold = std('#e8c34a', { metalness: 0.75, roughness: 0.25 });
      // centre-parted hair cap
      const cap = add(new THREE.SphereGeometry(0.262, 18, 14, 0, Math.PI * 2, 0, Math.PI / 1.9), hairMat, [0, 0.02, 0], null, true);
      cap.scale.set(1, 0.9, 1);
      add(new THREE.BoxGeometry(0.02, 0.02, 0.28), std('#3a2c22'), [0, 0.245, 0.06]);   // the part
      // braids coiled over the crown + two hanging
      for (const sx of [-1, 1]) {
        add(new THREE.TorusGeometry(0.15, 0.042, 8, 18, Math.PI * 1.2), hairMat,
          [sx * 0.04, 0.26, -0.02], [Math.PI / 2 - 0.25, 0, sx * 0.4]);
        for (let i = 0; i < 3; i++) {
          add(new THREE.SphereGeometry(0.052 - i * 0.008, 10, 8), hairMat,
            [sx * 0.24, 0.08 - i * 0.085, -0.06]);
        }
      }
      // flower crown of 7 blooms
      for (let i = 0; i < 7; i++) {
        const a = -0.9 + (i / 6) * 2.6;
        const cx = Math.sin(a) * 0.24, cz = Math.cos(a) * 0.19;
        const cy = 0.24 - Math.abs(a) * 0.035;
        const petal = std(BLOOMS[i % BLOOMS.length]);
        for (let p = 0; p < 5; p++) {
          const pa = (p / 5) * Math.PI * 2;
          add(new THREE.SphereGeometry(0.036, 9, 7).scale(1, 0.55, 1), petal,
            [cx + Math.cos(pa) * 0.04, cy + Math.sin(pa) * 0.04 * 0.6, cz + 0.02], [a * 0.3, 0, 0]);
        }
        add(new THREE.SphereGeometry(0.024, 9, 7), std('#ffd23d'), [cx, cy, cz + 0.035]);
        add(new THREE.SphereGeometry(0.03, 8, 6).scale(1.6, 0.4, 0.8), std('#3f7a34'),
          [cx * 1.1, cy - 0.05, cz], [0, 0, a]);
      }
      // the unibrow
      add(new THREE.BoxGeometry(0.3, 0.032, 0.03), skinBrow, [0, 0.135, 0.225], [0, 0, 0]);
      for (const sx of [-1, 1]) {
        add(new THREE.ConeGeometry(0.026, 0.09, 6).rotateZ(-sx * 1.35), skinBrow, [sx * 0.165, 0.145, 0.22]);
      }
      // gold hoop earrings
      for (const sx of [-1, 1]) {
        add(new THREE.TorusGeometry(0.055, 0.011, 7, 16), gold, [sx * 0.225, -0.07, 0.02], [0, Math.PI / 2, 0]);
      }
      break;
    }
  }
  return g;
}

import * as THREE from 'three';
import { Puppet, randomSpec } from '../world/puppet.js';
import { OCHE_DIST } from '../world/dartboard.js';

/**
 * The two players as visible characters: they stand about, walk to the oche
 * when it's their turn, throw with a real arm, and react to what lands.
 */

/** Fixed looks for the named CPUs, so BARRY is always BARRY. */
export const CHARACTERS = {
  'ai-pub': {
    name: 'BARRY (PUB)',
    spec: {
      name: 'BARRY', fur: '#c9a06a', hair: '#8a6a3a', hairStyle: 'shaggy',
      nose: '#e0604f', noseShape: 'round', accessory: 'cap', accent: '#5d6b4a',
      build: 'round', height: 1.44, eyeSize: 0.92, pupilSize: 1.15,
    },
  },
  'ai-shark': {
    name: 'THE SHARK',
    spec: {
      name: 'SHARK', fur: '#7f95a8', hair: '#c8203c', hairStyle: 'mohawk',
      nose: '#5a6a78', noseShape: 'beak', accessory: 'shades', accent: '#c8203c',
      build: 'lanky', height: 1.78, eyeSize: 0.85, pupilSize: 0.8,
    },
  },
  'ai-robot': {
    name: 'UNIT 180',
    spec: {
      name: 'UNIT 180', fur: '#d8dde4', hair: '#9fb3c8', hairStyle: 'antennae',
      nose: '#7f8996', noseShape: 'button', accessory: 'bowtie', accent: '#2fd4ff',
      build: 'average', height: 1.66, eyeSize: 1.15, pupilSize: 0.55,
    },
  },
};

const STAGE_Y = 0.17;

/**
 * Where each seat stands while it isn't their turn. Kept wide and well back so
 * the broadcast camera (which sits off the thrower's right shoulder) never
 * ends up inside somebody's head.
 */
export const WAIT = [
  new THREE.Vector3(-1.42, STAGE_Y, 4.08),
  new THREE.Vector3(1.42, STAGE_Y, 4.08),
];
/** The oche itself, a shoulder-width apart so nobody clips. */
export const OCHE = [
  new THREE.Vector3(-0.16, STAGE_Y, OCHE_DIST + 0.22),
  new THREE.Vector3(0.16, STAGE_Y, OCHE_DIST + 0.22),
];

const _v = new THREE.Vector3();

export class Cast {
  constructor(scene, boardPos) {
    this.scene = scene;
    this.boardPos = boardPos;
    this.members = [];
    this.active = 0;
    // which seat the local player occupies — online this can be either one
    this.stanceSeat = 0;
  }

  /** (Re)build a seat's puppet from a spec. */
  set(i, spec) {
    this.members[i]?.puppet.dispose();
    const puppet = new Puppet(spec);
    this.scene.add(puppet.group);
    const m = {
      puppet,
      home: WAIT[i].clone(),
      oche: OCHE[i].clone(),
      target: WAIT[i].clone(),
      pos: (this.members[i]?.pos ?? WAIT[i]).clone(),
      seat: i,
      stance: null,       // player 0 follows the live walk stance when throwing
    };
    puppet.group.position.copy(m.pos);
    this.members[i] = m;
    this._face(m, this.boardPos);
    return puppet;
  }

  get(i) { return this.members[i]?.puppet; }

  /** Whose turn it is — they walk up, the other one backs off. */
  setActive(i) {
    this.active = i;
    for (const m of this.members) {
      if (!m) continue;
      m.target.copy(m.seat === i ? m.oche : m.home);
    }
  }

  /** The local player throws from wherever they walked to. */
  followStance(v) {
    const m = this.members[this.stanceSeat];
    if (m) m.stance = v;
  }

  react(i, amount) { this.members[i]?.puppet.react(amount); }
  reactAll(amount) { for (const m of this.members) m?.puppet.react(amount); }

  lookAt(v) { for (const m of this.members) m?.puppet.setLook(v); }

  _face(m, at) {
    const dx = at.x - m.pos.x, dz = at.z - m.pos.z;
    m.puppet.group.rotation.y = Math.atan2(dx, dz);
  }

  update(dt, t) {
    for (const m of this.members) {
      if (!m) continue;
      const p = m.puppet;

      // player 0 at the oche stands exactly where the camera does
      const goal = (m.seat === this.stanceSeat && m.seat === this.active && m.stance)
        ? _v.set(m.stance.x, m.stance.y, m.stance.z)
        : m.target;

      const dist = m.pos.distanceTo(goal);
      if (dist > 0.012) {
        const step = Math.min(dist, 1.55 * dt);
        _v.copy(goal).sub(m.pos).normalize();
        m.pos.addScaledVector(_v, step);
        p.speed = THREE.MathUtils.clamp(step / dt / 1.55, 0, 1);
        // face where you're walking, but never turn your back on the board
        const wantYaw = Math.atan2(_v.x, _v.z);
        const boardYaw = Math.atan2(this.boardPos.x - m.pos.x, this.boardPos.z - m.pos.z);
        let d = wantYaw - boardYaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const yaw = Math.abs(d) > Math.PI / 2 ? boardYaw : wantYaw;
        p.group.rotation.y = approachAngle(p.group.rotation.y, yaw, dt * 6);
      } else {
        p.speed += (0 - p.speed) * Math.min(1, dt * 8);
        const boardYaw = Math.atan2(this.boardPos.x - m.pos.x, this.boardPos.z - m.pos.z);
        p.group.rotation.y = approachAngle(p.group.rotation.y, boardYaw, dt * 5);
      }

      p.group.position.copy(m.pos);
      p.update(dt, t);
    }
  }

  setVisible(i, on) {
    const m = this.members[i];
    if (m) m.puppet.group.visible = on;
  }

  dispose() {
    for (const m of this.members) m?.puppet.dispose();
    this.members = [];
  }
}

function approachAngle(from, to, k) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + d * Math.min(1, k);
}

export function opponentSpec(opponentKey) {
  const c = CHARACTERS[opponentKey];
  return c ? { ...c.spec } : randomSpec('PLAYER TWO');
}

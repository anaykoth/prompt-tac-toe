import * as THREE from 'three';
import {
  Puppet, randomSpec, defaultSpec,
  FUR, HAIR, NOSE, BUILDS, HAIR_STYLES, NOSE_SHAPES, ACCESSORIES,
} from '../world/puppet.js';

const STORE_KEY = 'splinter-alley.puppet';

export function loadSpec() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && typeof s === 'object' ? { ...defaultSpec(), ...s } : null;
  } catch { return null; }
}

export function saveSpec(spec) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(spec)); } catch { /* private mode */ }
}

/**
 * Build-a-puppet. Lives in the main scene on a podium rather than a separate
 * WebGL context, so the preview is lit and post-processed exactly as it will
 * look at the oche.
 */
export class Maker {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.onDone = opts.onDone ?? (() => {});
    this.onChange = opts.onChange ?? (() => {});
    this.spec = loadSpec() ?? defaultSpec();
    this.open = false;
    this.turn = Math.PI;   // camera looks down +Z, so face it

    this.stand = new THREE.Group();
    this.stand.position.copy(opts.podium ?? new THREE.Vector3(0, 0.17, 3.5));
    this.stand.visible = false;
    scene.add(this.stand);

    const podium = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.7, 0.16, 32),
      new THREE.MeshStandardMaterial({ color: '#2a2530', roughness: 0.5, metalness: 0.2 }),
    );
    podium.position.y = 0.08;
    podium.receiveShadow = true;
    this.stand.add(podium);
    const trim = new THREE.Mesh(
      new THREE.TorusGeometry(0.63, 0.018, 8, 40),
      new THREE.MeshStandardMaterial({ color: '#c8a13c', roughness: 0.3, metalness: 0.8, emissive: '#3a2c08' }),
    );
    trim.position.y = 0.16;
    trim.rotation.x = Math.PI / 2;
    this.stand.add(trim);

    this.turntable = new THREE.Group();
    this.turntable.position.y = 0.16;
    this.stand.add(this.turntable);

    // lights live in the stand's local space; -Z is toward the preview camera
    this.key = new THREE.SpotLight(0xfff2dc, 9, 7, 0.62, 0.6, 2);
    this.key.position.set(0.85, 2.3, -1.75);
    this.key.target = this.turntable;
    this.fill = new THREE.PointLight(0x9fc4ff, 4.5, 6, 2);
    this.fill.position.set(-1.5, 1.5, -1.1);
    this.rim = new THREE.PointLight(0xff8a4a, 5, 6, 2);
    this.rim.position.set(0.2, 1.7, 1.6);
    this.stand.add(this.key, this.key.target, this.fill, this.rim);

    this.puppet = null;
    this._rebuild();
    this._buildUI();
  }

  _rebuild() {
    this.puppet?.dispose();
    this.puppet = new Puppet(this.spec);
    this.puppet.crazy = 1;
    this.turntable.add(this.puppet.group);
    this.onChange(this.spec);
  }

  /* ---------------- UI ---------------- */

  _buildUI() {
    const root = document.querySelector('#maker-body');
    root.innerHTML = '';
    this.rows = [];

    const swatches = (label, key, list) => {
      const row = document.createElement('div');
      row.className = 'mk-row';
      row.innerHTML = `<span class="mk-label">${label}</span>`;
      const wrap = document.createElement('div');
      wrap.className = 'mk-swatches';
      const btns = list.map((c) => {
        const b = document.createElement('button');
        b.className = 'mk-sw';
        b.style.background = c;
        b.title = c;
        b.onclick = () => { this.spec[key] = c; this._rebuild(); this._sync(); };
        wrap.appendChild(b);
        return { b, c };
      });
      row.appendChild(wrap);
      root.appendChild(row);
      this.rows.push(() => btns.forEach(({ b, c }) => b.classList.toggle('on', this.spec[key] === c)));
    };

    const choices = (label, key, map) => {
      const row = document.createElement('div');
      row.className = 'mk-row';
      row.innerHTML = `<span class="mk-label">${label}</span>`;
      const wrap = document.createElement('div');
      wrap.className = 'mk-choices';
      const btns = Object.entries(map).map(([k, txt]) => {
        const b = document.createElement('button');
        b.className = 'mk-ch';
        b.textContent = typeof txt === 'string' ? txt : txt.label;
        b.onclick = () => { this.spec[key] = k; this._rebuild(); this._sync(); };
        wrap.appendChild(b);
        return { b, k };
      });
      row.appendChild(wrap);
      root.appendChild(row);
      this.rows.push(() => btns.forEach(({ b, k }) => b.classList.toggle('on', this.spec[key] === k)));
    };

    const slider = (label, key, min, max, step) => {
      const row = document.createElement('div');
      row.className = 'mk-row';
      row.innerHTML = `<span class="mk-label">${label}</span>`;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = min; input.max = max; input.step = step;
      input.className = 'mk-slider';
      input.oninput = () => { this.spec[key] = +input.value; this._rebuild(); };
      row.appendChild(input);
      root.appendChild(row);
      this.rows.push(() => { input.value = this.spec[key]; });
    };

    const name = document.createElement('div');
    name.className = 'mk-row';
    name.innerHTML = '<span class="mk-label">NAME</span>';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 12;
    nameInput.className = 'mk-name';
    nameInput.oninput = () => { this.spec.name = nameInput.value.toUpperCase() || 'YOU'; };
    name.appendChild(nameInput);
    root.appendChild(name);
    this.rows.push(() => { if (document.activeElement !== nameInput) nameInput.value = this.spec.name; });

    choices('BUILD', 'build', BUILDS);
    slider('HEIGHT', 'height', 1.15, 1.95, 0.01);
    swatches('FUR', 'fur', FUR);
    choices('HAIR', 'hairStyle', HAIR_STYLES);
    swatches('HAIR DYE', 'hair', HAIR);
    choices('NOSE', 'noseShape', NOSE_SHAPES);
    swatches('NOSE HUE', 'nose', NOSE);
    slider('EYES', 'eyeSize', 0.7, 1.6, 0.01);
    slider('PUPILS', 'pupilSize', 0.5, 1.6, 0.01);
    choices('EXTRAS', 'accessory', ACCESSORIES);
    swatches('TRIM', 'accent', HAIR);

    document.querySelector('#mk-random').onclick = () => {
      const keep = this.spec.name;
      this.spec = randomSpec(keep);
      this._rebuild();
      this._sync();
    };
    document.querySelector('#mk-done').onclick = () => {
      saveSpec(this.spec);
      this.onDone(this.spec);
    };
    this._sync();
  }

  _sync() { for (const f of this.rows) f(); }

  show(on) {
    this.open = on;
    this.stand.visible = on;
    document.querySelector('#maker').classList.toggle('gone', !on);
    if (on) this._sync();
  }

  update(dt, t) {
    if (!this.open) return;
    this.turn += dt * 0.42;
    this.turntable.rotation.y = this.turn;
    // keep it lively so you can see how the thing actually moves
    this.puppet.hype = 0.28 + Math.sin(t * 0.8) * 0.22;
    this.puppet.update(dt, t);
  }
}

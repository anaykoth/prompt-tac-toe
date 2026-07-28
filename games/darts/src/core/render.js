import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/* ------------------------------------------------------------------ */
/* G-buffer: view normals in RGB, linear depth in A                    */
/* ------------------------------------------------------------------ */

const NORMAL_DEPTH_MATERIAL = new THREE.ShaderMaterial({
  uniforms: { uFar: { value: 40 } },
  vertexShader: /* glsl */`
    #include <common>
    varying vec3 vN;
    varying float vD;
    void main() {
      #include <beginnormal_vertex>
      #include <defaultnormal_vertex>
      vN = normalize( transformedNormal );
      #include <begin_vertex>
      #include <project_vertex>
      vD = -mvPosition.z;
    }
  `,
  fragmentShader: /* glsl */`
    uniform float uFar;
    varying vec3 vN;
    varying float vD;
    void main() {
      gl_FragColor = vec4( normalize( vN ) * 0.5 + 0.5, clamp( vD / uFar, 0.0, 1.0 ) );
    }
  `,
});

/* ------------------------------------------------------------------ */
/* The uber stylisation pass                                           */
/* ------------------------------------------------------------------ */

const UberShader = {
  uniforms: {
    tDiffuse: { value: null },
    tND: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uCssRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uHype: { value: 0 },

    uOutline: { value: 0 },
    uOutlineColor: { value: new THREE.Color(0x0b0a10) },
    uPoster: { value: 0 },
    uScan: { value: 0 },
    uBarrel: { value: 0 },
    uChroma: { value: 0 },
    uVignette: { value: 0.5 },
    uGrain: { value: 0.05 },
    uHalftone: { value: 0 },
    uSat: { value: 1 },
    uContrast: { value: 1 },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uWarp: { value: 0 },
    uBleach: { value: 0 },
    uDouble: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tND;
    uniform vec2 uRes, uCssRes;
    uniform float uTime, uHype;
    uniform float uOutline, uPoster, uScan, uBarrel, uChroma, uVignette, uGrain, uHalftone;
    uniform float uSat, uContrast, uWarp, uBleach, uDouble;
    uniform vec3 uLift, uGain, uOutlineColor;
    varying vec2 vUv;

    float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }

    float luma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }

    vec2 barrel( vec2 uv, float k ) {
      vec2 c = uv - 0.5;
      float r2 = dot( c, c );
      return 0.5 + c * ( 1.0 + k * r2 + k * 0.42 * r2 * r2 );
    }

    float edge( vec2 uv ) {
      vec2 px = 1.0 / uRes;
      vec4 c  = texture2D( tND, uv );
      vec4 l  = texture2D( tND, uv - vec2( px.x, 0.0 ) );
      vec4 r  = texture2D( tND, uv + vec2( px.x, 0.0 ) );
      vec4 u  = texture2D( tND, uv + vec2( 0.0, px.y ) );
      vec4 d  = texture2D( tND, uv - vec2( 0.0, px.y ) );
      vec4 l2 = texture2D( tND, uv - vec2( px.x, 0.0 ) * 2.0 );
      vec4 r2 = texture2D( tND, uv + vec2( px.x, 0.0 ) * 2.0 );
      vec4 u2 = texture2D( tND, uv + vec2( 0.0, px.y ) * 2.0 );
      vec4 d2 = texture2D( tND, uv - vec2( 0.0, px.y ) * 2.0 );

      // depth discontinuity, scaled so distant silhouettes still register
      float dz = abs( l.a + r.a + u.a + d.a - 4.0 * c.a )
               + 0.5 * abs( l2.a + r2.a + u2.a + d2.a - 4.0 * c.a );
      float depthEdge = smoothstep( 0.0015, 0.006 + c.a * 0.05, dz );

      // normal discontinuity for interior creases
      vec3 nc = c.rgb * 2.0 - 1.0;
      float dn = 0.0;
      dn += 1.0 - dot( nc, l.rgb * 2.0 - 1.0 );
      dn += 1.0 - dot( nc, r.rgb * 2.0 - 1.0 );
      dn += 1.0 - dot( nc, u.rgb * 2.0 - 1.0 );
      dn += 1.0 - dot( nc, d.rgb * 2.0 - 1.0 );
      float normEdge = smoothstep( 0.55, 1.5, dn ) * ( 1.0 - smoothstep( 0.4, 0.95, c.a ) );

      return clamp( max( depthEdge, normEdge ), 0.0, 1.0 );
    }

    void main() {
      vec2 uv = vUv;

      // wobbling lens
      if ( uWarp > 0.0 ) {
        uv += vec2(
          sin( uv.y * 14.0 + uTime * 1.7 ) * 0.0016,
          cos( uv.x * 11.0 + uTime * 1.3 ) * 0.0016
        ) * uWarp * ( 1.0 + uHype * 5.0 );
      }
      if ( uBarrel > 0.0 ) uv = barrel( uv, uBarrel );

      vec3 col;
      float ca = uChroma * ( 0.0016 + uHype * 0.004 );
      if ( ca > 0.0 ) {
        vec2 dir = normalize( uv - 0.5 + 1e-6 ) * ca;
        col.r = texture2D( tDiffuse, uv + dir ).r;
        col.g = texture2D( tDiffuse, uv ).g;
        col.b = texture2D( tDiffuse, uv - dir ).b;
      } else {
        col = texture2D( tDiffuse, uv ).rgb;
      }

      // double vision: a second, drifting image that never darkens the first
      if ( uDouble > 0.0 ) {
        vec2 off = vec2( sin( uTime * 0.53 ) * 0.017, cos( uTime * 0.37 ) * 0.010 ) * uDouble;
        vec3 ghost = texture2D( tDiffuse, clamp( uv + off, 0.0, 1.0 ) ).rgb;
        col = mix( col, max( col, ghost ), 0.55 * min( 1.0, uDouble ) );
      }

      if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) col = vec3( 0.0 );

      // grade
      col = ( col - 0.5 ) * uContrast + 0.5;
      col = col * uGain + uLift;
      float lg = luma( col );
      col = mix( vec3( lg ), col, uSat );
      if ( uBleach > 0.0 ) {
        vec3 b = 1.0 - ( 1.0 - col ) * ( 1.0 - col );
        col = mix( col, mix( vec3( lg ), b, 0.7 ), uBleach );
      }

      // posterise
      if ( uPoster > 0.0 ) {
        vec3 hsvish = col;
        col = floor( hsvish * uPoster + 0.5 ) / uPoster;
      }

      // halftone dots on the shadows
      if ( uHalftone > 0.0 ) {
        vec2 g = uv * uCssRes / 3.6;
        float a = 0.5235988;
        vec2 rg = vec2( g.x * cos( a ) - g.y * sin( a ), g.x * sin( a ) + g.y * cos( a ) );
        float dot_ = length( fract( rg ) - 0.5 );
        float lum = luma( col );
        float mask = smoothstep( 0.18, 0.5, dot_ + lum * 0.62 );
        col = mix( col * 0.42, col, mix( 1.0, mask, uHalftone ) );
      }

      // ink outline
      if ( uOutline > 0.0 ) {
        float e = edge( uv );
        col = mix( col, uOutlineColor, clamp( e * uOutline, 0.0, 1.0 ) );
      }

      // scanlines + phosphor grille
      if ( uScan > 0.0 ) {
        float sl = 0.5 + 0.5 * sin( uv.y * uCssRes.y * 1.55 + uTime * 3.0 );
        col *= mix( 1.0, 0.72 + 0.28 * sl, uScan );
        float ph = mod( floor( uv.x * uCssRes.x * 0.85 ), 3.0 );
        vec3 mask = vec3( ph == 0.0 ? 1.12 : 0.9, ph == 1.0 ? 1.12 : 0.9, ph == 2.0 ? 1.12 : 0.9 );
        col *= mix( vec3( 1.0 ), mask, uScan * 0.55 );
        // rolling bar
        float roll = smoothstep( 0.0, 0.06, abs( fract( uv.y + uTime * 0.11 ) - 0.5 ) );
        col *= mix( 1.0, 0.86 + 0.14 * roll, uScan * 0.5 );
      }

      // vignette
      vec2 vc = ( uv - 0.5 ) * 2.0;
      float vig = 1.0 - dot( vc, vc ) * 0.30 * uVignette;
      col *= clamp( vig, 0.0, 1.0 );

      // grain
      if ( uGrain > 0.0 ) {
        float n = hash( gl_FragCoord.xy + fract( uTime ) * 137.0 );
        col += ( n - 0.5 ) * uGrain;
      }

      gl_FragColor = vec4( max( col, 0.0 ), 1.0 );
    }
  `,
};

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

export const STYLES = {
  alley: {
    label: 'Alley',
    bloom: { strength: 0.55, radius: 0.6, threshold: 1.7 },
    exposure: 1.06,
    tone: THREE.ACESFilmicToneMapping,
    fog: { color: 0x141119, near: 6, far: 22 },
    uniforms: { uVignette: 0.7, uGrain: 0.045, uContrast: 1.05, uSat: 1.06, uOutline: 0, uPoster: 0 },
  },
  ink: {
    label: 'Ink',
    bloom: { strength: 0.3, radius: 0.5, threshold: 2.1 },
    exposure: 1.22,
    tone: THREE.ACESFilmicToneMapping,
    fog: { color: 0x1a1720, near: 8, far: 26 },
    needsND: true,
    uniforms: {
      uOutline: 1.15, uPoster: 6.0, uHalftone: 0.5, uVignette: 0.5,
      uGrain: 0.03, uContrast: 1.1, uSat: 1.06,
      uOutlineColor: new THREE.Color(0x120d16),
    },
  },
  cathode: {
    label: 'Cathode',
    bloom: { strength: 0.5, radius: 0.85, threshold: 1.9 },
    exposure: 1.1,
    tone: THREE.ACESFilmicToneMapping,
    fog: { color: 0x0d1410, near: 5, far: 20 },
    uniforms: {
      uScan: 0.85, uBarrel: 0.14, uChroma: 0.6, uVignette: 1.35, uGrain: 0.09,
      uContrast: 1.16, uSat: 0.92,
      uGain: new THREE.Vector3(0.92, 1.06, 0.96), uLift: new THREE.Vector3(0.004, 0.014, 0.006),
    },
  },
  neon: {
    label: 'Neon',
    bloom: { strength: 0.9, radius: 0.9, threshold: 1.5 },
    exposure: 1.0,
    tone: THREE.ACESFilmicToneMapping,
    fog: { color: 0x120a20, near: 5, far: 20 },
    uniforms: {
      uVignette: 1.1, uGrain: 0.035, uChroma: 0.7, uContrast: 1.16, uSat: 1.5,
      uGain: new THREE.Vector3(1.06, 0.92, 1.14), uLift: new THREE.Vector3(0.014, 0.0, 0.03),
    },
    lights: { rimBoost: 2.2, hemi: 0.32 },
  },
  felt: {
    label: 'Feltvision',
    bloom: { strength: 0.6, radius: 1.0, threshold: 1.6 },
    exposure: 1.16,
    tone: THREE.ACESFilmicToneMapping,
    fog: { color: 0x241a2c, near: 7, far: 24 },
    uniforms: {
      uWarp: 1.0, uChroma: 0.9, uVignette: 0.85, uGrain: 0.1, uBleach: 0.45,
      uContrast: 1.02, uSat: 1.34, uGain: new THREE.Vector3(1.08, 1.0, 1.02),
      uLift: new THREE.Vector3(0.02, 0.008, 0.024),
    },
  },
};

export const STYLE_KEYS = Object.keys(STYLES);

/* ------------------------------------------------------------------ */

export class Renderer {
  constructor(canvas, scene, camera) {
    this.scene = scene;
    this.camera = camera;

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance', stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const dpr = this.renderer.getPixelRatio();

    const rt = new THREE.WebGLRenderTarget(size.x * dpr, size.y * dpr, {
      type: THREE.HalfFloatType, samples: 4,
      colorSpace: THREE.LinearSRGBColorSpace,
    });

    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    // NB: runs pre-OutputPass, so thresholds are LINEAR HDR luminance (~1.7 is
    // roughly 'brighter than a well-lit white surface'), not 0..1 display values.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.6, 1.7);
    this.output = new OutputPass();
    this.uber = new ShaderPass(UberShader);

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.uber);

    // normal+depth target for the ink outline
    this.ndTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    this.uber.uniforms.tND.value = this.ndTarget.texture;

    this.style = null;
    this.setStyle('alley');
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const dpr = Math.min(devicePixelRatio, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.ndTarget.setSize(Math.round(w * dpr), Math.round(h * dpr));
    this.uber.uniforms.uRes.value.set(w * dpr, h * dpr);
    this.uber.uniforms.uCssRes.value.set(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setStyle(key) {
    const s = STYLES[key];
    if (!s) return;
    this.styleKey = key;
    this.style = s;

    // reset every uniform to its default, then apply the style
    const u = this.uber.uniforms;
    const defaults = {
      uOutline: 0, uPoster: 0, uScan: 0, uBarrel: 0, uChroma: 0, uVignette: 0.5,
      uGrain: 0.05, uHalftone: 0, uSat: 1, uContrast: 1, uWarp: 0, uBleach: 0,
    };
    for (const k in defaults) u[k].value = defaults[k];
    u.uLift.value.set(0, 0, 0);
    u.uGain.value.set(1, 1, 1);
    u.uOutlineColor.value.set(0x0b0a10);
    for (const k in s.uniforms) {
      const v = s.uniforms[k];
      if (v && v.isColor) u[k].value.copy(v);
      else if (v && v.isVector3) u[k].value.copy(v);
      else u[k].value = v;
    }

    this.bloom.strength = s.bloom.strength;
    this.bloom.radius = s.bloom.radius;
    this.bloom.threshold = s.bloom.threshold;
    this.renderer.toneMapping = s.tone;
    this.renderer.toneMappingExposure = s.exposure;

    if (s.fog) {
      this.scene.fog = new THREE.Fog(s.fog.color, s.fog.near, s.fog.far);
      this.scene.background = new THREE.Color(s.fog.color);
    }
    this.needsND = !!s.needsND;
    // snapshot so setDrunk() can layer on top of whichever style is active
    this.styleBase = {
      uWarp: u.uWarp.value, uChroma: u.uChroma.value, uSat: u.uSat.value,
      uVignette: u.uVignette.value, uGrain: u.uGrain.value,
    };
    this.setDrunk(this.drunk ?? 0);
    return s;
  }

  /**
   * Layer the drunk wobble over the current style. Additive on top of
   * `styleBase` so switching styles mid-session doesn't accumulate.
   */
  setDrunk(v) {
    this.drunk = v;
    const u = this.uber.uniforms, b = this.styleBase;
    if (!b) return;
    u.uWarp.value = b.uWarp + v * 2.6;
    u.uChroma.value = b.uChroma + v * 1.5;
    u.uSat.value = b.uSat * (1 + v * 0.28);
    u.uVignette.value = b.uVignette + v * 0.85;
    u.uGrain.value = b.uGrain + v * 0.03;
    u.uDouble.value = Math.max(0, v - 0.18) * 1.25;
  }

  render(dt, time, hype) {
    this.uber.uniforms.uTime.value = time;
    this.uber.uniforms.uHype.value = hype;

    if (this.needsND) {
      const prevBg = this.scene.background;
      const prevFog = this.scene.fog;
      this.scene.background = null;
      this.scene.fog = null;

      // an override ShaderMaterial can't draw Points/Lines (no gl_PointSize),
      // and sprites/trails shouldn't produce outlines anyway
      const hidden = [];
      this.scene.traverse((o) => {
        if ((o.isPoints || o.isLine) && o.visible) { o.visible = false; hidden.push(o); }
      });

      this.scene.overrideMaterial = NORMAL_DEPTH_MATERIAL;
      this.renderer.setRenderTarget(this.ndTarget);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      this.scene.overrideMaterial = null;

      for (const o of hidden) o.visible = true;
      this.scene.background = prevBg;
      this.scene.fog = prevFog;
      this.renderer.setRenderTarget(null);
    }

    this.composer.render(dt);
  }
}

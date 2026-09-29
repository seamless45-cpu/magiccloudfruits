import * as THREE from 'three';
import type { Effect } from './types';

const VS = `
attribute vec3 aDir; attribute float aSide; attribute float aTaper;
uniform float uWidth; uniform float uFlat;
varying float vSide;
void main(){
  vec4 wp = modelMatrix * vec4(position,1.0);
  vec3 toCam = normalize(cameraPosition - wp.xyz);
  vec3 n = mix(toCam, vec3(0.0,1.0,0.0), uFlat);
  vec3 s = cross(aDir, n); float l = length(s);
  s = l > 1e-4 ? s / l : vec3(1.0,0.0,0.0);
  wp.xyz += s * aSide * uWidth * aTaper;
  vSide = aSide;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FS = `
uniform vec3 uColor; uniform float uOpacity; uniform float uSharp;
varying float vSide;
void main(){
  // hot core fading into a soft halo; the halo is what makes it read as plasma
  float a = pow(1.0 - abs(vSide), uSharp);
  gl_FragColor = vec4(uColor * (1.0 + a * 1.7), a * uOpacity);
}`;

export interface BoltOpts {
  color?: number; core?: number; width?: number; life?: number; segs?: number; jag?: number;
  branches?: number; flat?: boolean; opacity?: number; follow?: () => [THREE.Vector3, THREE.Vector3] | null;
  /** taper the channel from full width at the top to this fraction at the bottom */
  taper?: number;
}

let active = 0;
export const boltStats = { get active() { return active; } };

const _d = new THREE.Vector3(), _u = new THREE.Vector3(), _v = new THREE.Vector3(), _t = new THREE.Vector3();
const _bStart = new THREE.Vector3(), _bEnd = new THREE.Vector3(), _bDir = new THREE.Vector3(), _bSide = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Cloud-to-ground lightning, built the way real channels look:
 *
 *  - a single bright trunk with fractal (midpoint-displacement) kinks instead of uniform noise,
 *  - displacement concentrated near the ground, where a descending stepped leader wanders,
 *  - a channel that tapers from the cloud to a fine point at the strike,
 *  - a few downward-angled branches, never upward ones,
 *  - strobe flicker and a halo around a white-hot core.
 *
 * Performance is unchanged: one shared geometry, one static index buffer, ribbon expansion on
 * the GPU, and the CPU only rewrites the centreline (every 10 ms).
 */
export class Bolt implements Effect {
  geo: THREE.BufferGeometry; core: THREE.Mesh; glow: THREE.Mesh; group = new THREE.Group();
  a: THREE.Vector3; b: THREE.Vector3; o: Required<Omit<BoltOpts, 'follow'>> & { follow?: BoltOpts['follow'] };
  pts: Float32Array; dirs: Float32Array; strips: number[] = []; t = 0; acc = 1; life: number; bsegs: number;
  constructor(scene: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, opts: BoltOpts = {}) {
    active++;
    this.a = a.clone(); this.b = b.clone();
    // Fewer, longer segments with a gentler jag: a plausible trunk rather than a scribble.
    this.o = { color: 0x9db8ff, core: 0xffffff, width: 0.5, life: 0.42, segs: 14, jag: 0.05, branches: 2, flat: false, opacity: 1, taper: 0.42, ...opts } as any;
    this.life = this.o.life;
    const segs = this.o.segs; this.bsegs = Math.max(2, Math.floor(segs / 3));
    const nPts = segs + 1 + this.o.branches * (this.bsegs + 1);
    this.strips = [segs + 1]; for (let i = 0; i < this.o.branches; i++) this.strips.push(this.bsegs + 1);
    const vcount = nPts * 2;
    const pos = new Float32Array(vcount * 3), dir = new Float32Array(vcount * 3), side = new Float32Array(vcount), taper = new Float32Array(vcount);
    const idx: number[] = []; let base = 0;
    this.strips.forEach((n, si) => {
      for (let j = 0; j < n; j++) {
        const v = (base + j) * 2; side[v] = -1; side[v + 1] = 1;
        const f = j / (n - 1);
        // main channel: full width at the cloud, tapering to o.taper on contact
        const tp = si === 0 ? 1 - (1 - this.o.taper) * f : 0.4 * (1 - f * 0.95);
        taper[v] = tp; taper[v + 1] = tp;
        if (j < n - 1) { const a0 = v, a1 = v + 1, b0 = v + 2, b1 = v + 3; idx.push(a0, b0, a1, a1, b0, b1); }
      }
      base += n;
    });
    this.pts = pos; this.dirs = dir;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aDir', new THREE.BufferAttribute(dir, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    this.geo.setAttribute('aTaper', new THREE.BufferAttribute(taper, 1));
    this.geo.setIndex(idx);
    const mk = (w: number, col: number, op: number, sharp: number) => new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uWidth: { value: w }, uFlat: { value: this.o.flat ? 1 : 0 }, uColor: { value: new THREE.Color(col) }, uOpacity: { value: op }, uSharp: { value: sharp } },
    });
    this.glow = new THREE.Mesh(this.geo, mk(this.o.width * 5.5, this.o.color, 0.3 * this.o.opacity, 1.7));
    this.core = new THREE.Mesh(this.geo, mk(this.o.width, this.o.core, this.o.opacity, 0.45));
    this.glow.frustumCulled = false; this.core.frustumCulled = false;
    this.group.add(this.glow, this.core);
    scene.add(this.group);
    this.regen();
  }

  /** One strip of the channel: fractal midpoint displacement, biased near the ground. */
  private writeStrip(start: number, n: number, a: THREE.Vector3, b: THREE.Vector3, jag: number) {
    const P = this.pts, D = this.dirs;
    _d.subVectors(b, a); const len = _d.length(); _d.normalize();
    _u.set(0, 1, 0); if (Math.abs(_d.y) > 0.9) _u.set(1, 0, 0);
    _u.cross(_d).normalize(); _v.crossVectors(_d, _u).normalize();

    // midpoint displacement: start from the two ends and split, halving the offset each pass
    const px = new Float32Array(n), py = new Float32Array(n);
    let step = n - 1;
    let amp = len * jag * 2.4;
    while (step > 1) {
      const half = step >> 1;
      for (let i = half; i < n - 1; i += step) {
        const t = i / (n - 1);
        // a stepped leader wanders most in its lower half, and less right at the strike point
        const wander = (0.35 + 0.65 * t) * (1 - Math.pow(t, 6));
        px[i] = (px[i - half] + px[i + half]) * 0.5 + (Math.random() - 0.5) * 2 * amp * wander;
        py[i] = (py[i - half] + py[i + half]) * 0.5 + (Math.random() - 0.5) * 2 * amp * 0.35 * wander;
      }
      step = half; amp *= 0.58;
    }

    for (let j = 0; j < n; j++) {
      const t = j / (n - 1);
      _t.copy(a).addScaledVector(_d, len * t).addScaledVector(_u, px[j]).addScaledVector(_v, py[j]);
      const v = (start + j) * 6;
      P[v] = _t.x; P[v + 1] = _t.y; P[v + 2] = _t.z;
      P[v + 3] = _t.x; P[v + 4] = _t.y; P[v + 5] = _t.z;
      D[v] = 0; D[v + 1] = 1; D[v + 2] = 0; D[v + 3] = 0; D[v + 4] = 1; D[v + 5] = 0;
    }
    for (let j = 0; j < n; j++) {
      const j0 = Math.max(0, j - 1), j1 = Math.min(n - 1, j + 1);
      const v0 = (start + j0) * 6, v1 = (start + j1) * 6, v = (start + j) * 6;
      let dx = P[v1] - P[v0], dy = P[v1 + 1] - P[v0 + 1], dz = P[v1 + 2] - P[v0 + 2];
      const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      D[v] = dx; D[v + 1] = dy; D[v + 2] = dz;
      D[v + 3] = dx; D[v + 4] = dy; D[v + 5] = dz;
    }
  }

  regen() {
    if (this.o.follow) { const r = this.o.follow(); if (r) { this.a.copy(r[0]); this.b.copy(r[1]); } }
    const segs = this.o.segs;
    this.writeStrip(0, segs + 1, this.a, this.b, this.o.jag);
    const len = this.a.distanceTo(this.b);
    let start = segs + 1;
    for (let i = 0; i < this.o.branches; i++) {
      // branches leave the trunk in its lower half and always fork downwards
      const k = Math.max(2, Math.floor(branchAt(this.o.branches, i) * (segs - 2)));
      const v = k * 6;
      _bStart.set(this.pts[v], this.pts[v + 1], this.pts[v + 2]);
      _bDir.subVectors(this.b, this.a).normalize();
      _bSide.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      const drop = -(0.25 + Math.random() * 0.45);
      const reach = len * (0.08 + Math.random() * 0.14);
      _bEnd.copy(_bSide).multiplyScalar(0.85).addScaledVector(_bDir, 0.5).addScaledVector(_up, drop).normalize()
        .multiplyScalar(reach).add(_bStart);
      if (_bEnd.y < 0.15) _bEnd.y = 0.15;
      if (this.o.flat) _bEnd.y = _bStart.y;
      this.writeStrip(start, this.bsegs + 1, _bStart, _bEnd, this.o.jag * 1.5);
      start += this.bsegs + 1;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aDir as THREE.BufferAttribute).needsUpdate = true;
  }

  update(dt: number) {
    this.t += dt; this.acc += dt;
    if (this.acc >= 0.01) {
      this.acc = 0; this.regen(); // the channel re-forms every 10 ms, as a real one restrikes
      // stroboscopic flicker: bright strike, quick dips - reads as a discharge, not a glow fade
      const f = 0.45 + Math.random() * 0.55;
      const k = Math.max(0, 1 - this.t / this.life);
      const fade = Math.min(1, k * 3.2);
      (this.core.material as THREE.ShaderMaterial).uniforms.uOpacity.value = this.o.opacity * f * fade;
      (this.glow.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.3 * this.o.opacity * f * fade;
    }
    return this.t < this.life;
  }
  dispose() {
    active--;
    this.group.parent?.remove(this.group);
    this.geo.dispose(); (this.core.material as THREE.Material).dispose(); (this.glow.material as THREE.Material).dispose();
  }
}

/** Branch attachment points spread over the lower half of the trunk. */
function branchAt(branches: number, i: number): number {
  return 0.45 + (i + Math.random() * 0.6) / Math.max(1, branches * 1.6);
}

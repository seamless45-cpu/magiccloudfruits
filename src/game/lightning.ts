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
  float a = pow(1.0 - abs(vSide), uSharp);
  gl_FragColor = vec4(uColor * (1.0 + a * 1.5), a * uOpacity);
}`;

export interface BoltOpts {
  color?: number; core?: number; width?: number; life?: number; segs?: number; jag?: number;
  branches?: number; jitter?: number; flat?: boolean; opacity?: number; follow?: () => [THREE.Vector3, THREE.Vector3] | null;
}

let active = 0;
export const boltStats = { get active() { return active; } };

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _u = new THREE.Vector3(), _v = new THREE.Vector3(), _t = new THREE.Vector3();

/**
 * Jagged ribbon lightning. Low-lag approach: one static index buffer + one shared geometry for
 * core & glow; ribbon expansion is done on the GPU; CPU only rewrites the centerline points
 * every 0.01s (segment re-rotation) into a preallocated Float32Array.
 */
export class Bolt implements Effect {
  geo: THREE.BufferGeometry; core: THREE.Mesh; glow: THREE.Mesh; group = new THREE.Group();
  a: THREE.Vector3; b: THREE.Vector3; o: Required<Omit<BoltOpts, 'follow'>> & { follow?: BoltOpts['follow'] };
  pts: Float32Array; dirs: Float32Array; strips: number[] = []; t = 0; acc = 1; life: number; bsegs: number;
  constructor(scene: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, opts: BoltOpts = {}) {
    active++;
    this.a = a.clone(); this.b = b.clone();
    this.o = { color: 0x88aaff, core: 0xffffff, width: 0.6, life: 0.35, segs: 18, jag: 0.07, branches: 2, jitter: 1, flat: false, opacity: 1, ...opts } as any;
    this.life = this.o.life;
    const segs = this.o.segs; this.bsegs = Math.max(3, Math.floor(segs / 2.5));
    const nPts = segs + 1 + this.o.branches * (this.bsegs + 1);
    this.strips = [segs + 1]; for (let i = 0; i < this.o.branches; i++) this.strips.push(this.bsegs + 1);
    const vcount = nPts * 2;
    const pos = new Float32Array(vcount * 3), dir = new Float32Array(vcount * 3), side = new Float32Array(vcount), taper = new Float32Array(vcount);
    const idx: number[] = []; let base = 0;
    this.strips.forEach((n, si) => {
      for (let j = 0; j < n; j++) {
        const v = (base + j) * 2; side[v] = -1; side[v + 1] = 1;
        const tp = (si === 0 ? 1 : 0.5) * (1 - (j / (n - 1)) * (si === 0 ? 0.35 : 0.9));
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
    this.glow = new THREE.Mesh(this.geo, mk(this.o.width * 4.5, this.o.color, 0.45 * this.o.opacity, 1.8));
    this.core = new THREE.Mesh(this.geo, mk(this.o.width, this.o.core, this.o.opacity, 0.6));
    this.glow.frustumCulled = false; this.core.frustumCulled = false;
    this.group.add(this.glow, this.core);
    scene.add(this.group);
    this.regen();
  }
  private writeStrip(start: number, n: number, a: THREE.Vector3, b: THREE.Vector3, jag: number) {
    _d.subVectors(b, a); const len = _d.length(); _d.normalize();
    _u.set(0, 1, 0); if (Math.abs(_d.y) > 0.9) _u.set(1, 0, 0);
    _u.cross(_d).normalize(); _v.crossVectors(_d, _u).normalize();
    const amp = len * jag;
    const P = this.pts;
    let px = 0, py = 0;
    for (let j = 0; j < n; j++) {
      const t = j / (n - 1);
      const env = j === 0 || (j === n - 1 && start === 0) ? 0 : 1;
      px = (px * 0.35 + (Math.random() - 0.5) * 2 * this.o.jitter) * env; py = (py * 0.35 + (Math.random() - 0.5) * 2 * this.o.jitter) * env;
      _t.copy(a).addScaledVector(_d, len * t).addScaledVector(_u, px * amp).addScaledVector(_v, py * amp);
      const v = (start + j) * 2 * 3;
      P[v] = _t.x; P[v + 1] = _t.y; P[v + 2] = _t.z; P[v + 3] = _t.x; P[v + 4] = _t.y; P[v + 5] = _t.z;
    }
    const D = this.dirs;
    for (let j = 0; j < n; j++) {
      const j0 = Math.max(0, j - 1), j1 = Math.min(n - 1, j + 1);
      const v0 = (start + j0) * 6, v1 = (start + j1) * 6, v = (start + j) * 6;
      let dx = P[v1] - P[v0], dy = P[v1 + 1] - P[v0 + 1], dz = P[v1 + 2] - P[v0 + 2];
      const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      D[v] = dx; D[v + 1] = dy; D[v + 2] = dz; D[v + 3] = dx; D[v + 4] = dy; D[v + 5] = dz;
    }
  }
  regen() {
    if (this.o.follow) { const r = this.o.follow(); if (r) { this.a.copy(r[0]); this.b.copy(r[1]); } }
    const segs = this.o.segs;
    this.writeStrip(0, segs + 1, this.a, this.b, this.o.jag);
    const len = this.a.distanceTo(this.b);
    let start = segs + 1;
    for (let i = 0; i < this.o.branches; i++) {
      const k = 2 + Math.floor(Math.random() * (segs - 4));
      const v = k * 6;
      _a.set(this.pts[v], this.pts[v + 1], this.pts[v + 2]);
      _d.subVectors(this.b, this.a).normalize();
      _b.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.4 * this.o.jitter).add(_d).normalize()
        .multiplyScalar(len * (0.12 + Math.random() * 0.25)).add(_a);
      if (!this.o.flat && _b.y < 0.2) _b.y = 0.2;
      if (this.o.flat) _b.y = _a.y;
      this.writeStrip(start, this.bsegs + 1, _a, _b, this.o.jag * 1.6);
      start += this.bsegs + 1;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aDir as THREE.BufferAttribute).needsUpdate = true;
  }
  update(dt: number) {
    this.t += dt; this.acc += dt;
    if (this.acc >= 0.01) { this.acc = 0; this.regen(); // re-rotate every 0.01s
      const f = 0.65 + Math.random() * 0.35;
      const k = Math.max(0, 1 - this.t / this.life);
      const fade = Math.min(1, k * 3);
      (this.core.material as THREE.ShaderMaterial).uniforms.uOpacity.value = this.o.opacity * f * fade;
      (this.glow.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.45 * this.o.opacity * f * fade;
    }
    return this.t < this.life;
  }
  dispose() {
    active--;
    this.group.parent?.remove(this.group);
    this.geo.dispose(); (this.core.material as THREE.Material).dispose(); (this.glow.material as THREE.Material).dispose();
  }
}

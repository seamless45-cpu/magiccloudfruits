import * as THREE from 'three';
import type { Effect } from './types';
import { rnd, V, addMat, explosion, GEO } from './effects';
import { ParticleSystem } from './particles';

const PUFF_GEO = new THREE.IcosahedronGeometry(1, 2);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();

interface Puff { x: number; y: number; z: number; r: number; fy: number; stage: number; shade: number }
export type CloudKind = 'cumulus' | 'cell' | 'stratus' | 'nimbo' | 'squall' | 'derecho' | 'supercell' | 'hail';

export interface CloudOpts {
  pos: THREE.Vector3; kind: CloudKind; size: number; life: number; vel?: THREE.Vector3; grow?: number;
  rain?: number; rainDmg?: number; hail?: number; hailDmg?: number; hailShatter?: number; hailShatterDmg?: number;
  bolts?: number; boltDmg?: number; superChance?: number; superMul?: number; superName?: string;
  tornado?: boolean; tornadoRate?: number; wind?: number; windDmg?: number; supercellChance?: number;
  length?: number; depth?: number; bow?: number; shade?: number; rainColor?: number; dmgMul?: number; spin?: number;
}

/** Dynamic-growing volumetric-ish cloud built from instanced puffs, with rainshafts, hail, lightning, tornadoes. */
export class StormCloud implements Effect {
  t = 0; o: CloudOpts & Required<Pick<CloudOpts, 'vel' | 'grow' | 'rain' | 'rainDmg' | 'hail' | 'bolts'>>;
  puffs: Puff[] = []; mesh: THREE.InstancedMesh; mat: THREE.MeshStandardMaterial; base: number; R: number; growth = 0;
  rainTick = 0; boltT = 0; hailT = 0; tornT = 0; isSuper = false; evolved = false; dir: THREE.Vector3; side: THREE.Vector3; stageName = '';
  constructor(public g: any, o: CloudOpts) {
    this.o = { vel: V(), grow: 0.01, rain: 0, rainDmg: 0, hail: 0, bolts: 0, ...o } as any;
    this.R = o.size / 2;
    this.base = Math.min(220, 45 + o.size * 0.08);
    this.dir = this.o.vel.lengthSq() > 0 ? this.o.vel.clone().normalize() : V(0, 0, 1);
    this.side = V(-this.dir.z, 0, this.dir.x);
    this.isSuper = o.kind === 'supercell';
    this.build();
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, transparent: true, opacity: 0.96, emissive: 0x1a1d24, depthWrite: true });
    this.mesh = new THREE.InstancedMesh(PUFF_GEO, this.mat, this.puffs.length);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.castShadow = g.settings.shadows && o.size < 700;
    this.puffs.forEach((p, i) => { const s = p.shade * (o.shade ?? 1); this.mesh.setColorAt(i, _c.setRGB(s, s, s * 1.03)); });
    this.mesh.position.copy(o.pos); this.mesh.position.y = 0;
    g.scene.add(this.mesh);
    this.layout();
  }
  addPuff(x: number, y: number, z: number, r: number, stage: number, shade: number, fy = 1) { this.puffs.push({ x, y, z, r, fy, stage, shade }); }
  build() {
    const R = this.R, b = this.base, k = this.o.kind, dens = this.g.settings.clouds;
    const N = (n: number) => Math.max(3, Math.round(n * dens));
    if (k === 'cumulus' || k === 'cell' || k === 'supercell' || k === 'hail') {
      for (let i = 0; i < N(16); i++) { const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * R * 0.55; this.addPuff(Math.cos(a) * r, b + rnd(0, R * 0.08), Math.sin(a) * r, R * rnd(0.22, 0.34), rnd(0, 0.2), rnd(0.5, 0.68), 0.55); }
      for (let i = 0; i < N(14); i++) { const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * R * 0.4; this.addPuff(Math.cos(a) * r, b + R * rnd(0.2, 0.7), Math.sin(a) * r, R * rnd(0.22, 0.32), rnd(0.2, 0.45), rnd(0.8, 0.95)); }
      for (let i = 0; i < N(12); i++) { const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * R * 0.3; this.addPuff(Math.cos(a) * r, b + R * rnd(0.7, 1.4), Math.sin(a) * r, R * rnd(0.2, 0.28), rnd(0.45, 0.72), rnd(0.9, 1)); }
      for (let i = 0; i < N(20); i++) { const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * R * 1.25; this.addPuff(Math.cos(a) * r + R * 0.25, b + R * rnd(1.5, 1.7), Math.sin(a) * r, R * rnd(0.28, 0.4), rnd(0.72, 0.98), rnd(0.88, 1), 0.3); }
      this.addPuff(0, b + R * 1.85, 0, R * 0.25, 0.9, 1); // overshooting top
    } else if (k === 'stratus' || k === 'nimbo') {
      const n = k === 'nimbo' ? N(26) : N(7);
      for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * R * 0.85; this.addPuff(Math.cos(a) * r, b + rnd(0, R * 0.05), Math.sin(a) * r, R * rnd(0.25, 0.38), 0, k === 'nimbo' ? rnd(0.42, 0.55) : rnd(0.7, 0.8), 0.28); }
    } else { // squall / derecho line: shelf cloud front + taller body behind
      const L = this.o.length!, D = this.o.depth!, bow = this.o.bow ?? 0;
      const cols = N(Math.min(60, Math.ceil(L / (D * 0.25)))); const pr = Math.max(L / cols, D * 0.12);
      for (let i = 0; i < cols; i++) {
        const u = (i / (cols - 1)) * 2 - 1; const fwd = bow * D * (1 - u * u);
        const lat = u * L / 2;
        this.addPuff(lat, b * 0.55, fwd, pr * 0.8, 0, 0.45, 0.35); // shelf (low, dark front)
        this.addPuff(lat, b * 0.8, fwd - D * 0.12, pr * 0.9, 0, 0.62, 0.5);
        this.addPuff(lat + rnd(-pr, pr) * 0.4, b + D * 0.25, fwd - D * rnd(0.3, 0.5), pr * 1.1, 0, rnd(0.8, 0.95));
        if (i % 2 === 0) this.addPuff(lat, b + D * 0.55, fwd - D * rnd(0.5, 0.8), pr * 1.3, 0, 0.97, 0.4);
      }
    }
  }
  layout() {
    const gr = this.growth;
    const spin = this.t * (this.o.spin ?? (this.isSuper ? 0.06 : 0.01));
    const cs = Math.cos(spin), sn = Math.sin(spin);
    const lineRot = this.o.kind === 'squall' || this.o.kind === 'derecho' ? Math.atan2(this.dir.x, this.dir.z) : 0;
    const cr = Math.cos(lineRot), sr = Math.sin(lineRot);
    this.puffs.forEach((p, i) => {
      const s = Math.max(0, Math.min(1, (gr - p.stage) / 0.14));
      const bulge = 1 + 0.04 * Math.sin(this.t * 0.8 + i);
      let x = p.x, z = p.z;
      if (lineRot) { const nx = x * cr + z * sr, nz = -x * sr + z * cr; x = nx; z = nz; }
      else { const nx = x * cs - z * sn, nz = x * sn + z * cs; x = nx; z = nz; }
      _p.set(x, p.y, z); _s.set(p.r * s * bulge, p.r * s * p.fy * bulge, p.r * s * bulge);
      _m.compose(_p, _q.identity(), _s); this.mesh.setMatrixAt(i, _m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  /** random rain point in world space under the cloud */
  rainPoint(out: THREE.Vector3) {
    const c = this.mesh.position;
    if (this.o.kind === 'squall' || this.o.kind === 'derecho') {
      const u = rnd(-1, 1); const fwd = (this.o.bow ?? 0) * this.o.depth! * (1 - u * u) - this.o.depth! * rnd(0.05, 0.6);
      return out.set(c.x, 0, c.z).addScaledVector(this.side, u * this.o.length! / 2).addScaledVector(this.dir, fwd);
    }
    const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * this.R * (this.o.kind === 'nimbo' ? 0.85 : 0.5);
    return out.set(c.x + Math.cos(a) * r, 0, c.z + Math.sin(a) * r);
  }
  inRain(p: THREE.Vector3) {
    const c = this.mesh.position;
    if (this.o.kind === 'squall' || this.o.kind === 'derecho') {
      const rel = V(p.x - c.x, 0, p.z - c.z); const u = rel.dot(this.side) / (this.o.length! / 2); if (Math.abs(u) > 1) return false;
      const f = rel.dot(this.dir) - (this.o.bow ?? 0) * this.o.depth! * (1 - u * u); return f < 0 && f > -this.o.depth! * 0.65;
    }
    return Math.hypot(p.x - c.x, p.z - c.z) < this.R * (this.o.kind === 'nimbo' ? 0.85 : 0.55);
  }
  update(dt: number) {
    const g = this.g, o = this.o; this.t += dt;
    this.mesh.position.addScaledVector(o.vel, dt);
    const prev = this.growth;
    this.growth = Math.min(1, this.t / o.grow);
    // dynamic stage evolution
    if (o.kind === 'cumulus') {
      this.stageName = this.growth < 0.25 ? 'Cumulus humilis' : this.growth < 0.5 ? 'Cumulus mediocris' : this.growth < 0.75 ? 'Cumulus congestus' : this.isSuper ? 'Supercell' : 'Cumulonimbus';
      if (prev < 1 && this.growth >= 1 && !this.evolved) { this.evolved = true; if (Math.random() < (o.supercellChance ?? 0)) this.becomeSupercell(); else { o.bolts = 0.5; o.superChance = 0.25; o.superMul = 3; o.superName = 'SUPERBOLT'; o.hail = 0.6; o.rain = 0.8; } }
    }
    const fadeK = Math.min(1, (o.life - this.t) / 3);
    this.mat.opacity = 0.96 * Math.max(0, fadeK);
    this.layout();
    const rainOn = o.kind === 'cumulus' ? (this.growth > 0.55 ? (this.growth - 0.5) * 2 * o.rain + (this.growth > 0.55 ? 0.25 : 0) : 0) : o.rain * Math.min(1, this.growth * 1.5);
    const dens = g.settings.particles;
    if (rainOn > 0 && fadeK > 0) {
      // rainshafts: white smoke with fluid (curl + ground outflow) behaviour
      const shafts = Math.min(30, Math.ceil(rainOn * (this.R / 40) * 3 * dens * dt * 60));
      const rp = V();
      for (let i = 0; i < shafts; i++) {
        this.rainPoint(rp); const vy = -rnd(14, 24) * (0.8 + rainOn * 0.4);
        const h = this.base * rnd(0.55, 0.95);
        g.smoke.spawn(rp.x, h, rp.z, o.vel.x + rnd(-2, 2), vy, o.vel.z + rnd(-2, 2), o.rainColor ?? 0xd9dee6, Math.min(80, this.R * rnd(0.12, 0.22)), h / -vy + rnd(1.5, 3),
          { turb: 5, spread: 0.55, drag: 0.15, grow: 1.4, alpha: 0.1 + 0.12 * Math.min(1, rainOn), ox: rp.x + rnd(-3, 3), oz: rp.z + rnd(-3, 3) });
      }
      const drops = Math.min(60, Math.ceil(rainOn * this.R * 0.3 * dens * dt * 60));
      for (let i = 0; i < drops; i++) { this.rainPoint(rp); g.smoke.spawn(rp.x, this.base * 0.6, rp.z, o.vel.x * 0.5, -60, o.vel.z * 0.5, 0xbcd4ff, 0.35, this.base * 0.6 / 60, { alpha: 0.7 }); }
      // rain damage every 0.05s
      this.rainTick += dt;
      while (this.rainTick >= 0.05) {
        this.rainTick -= 0.05;
        if (o.rainDmg > 0) for (const e of g.enemies) if (!e.dead && this.inRain(e.pos)) g.damage(e, o.rainDmg * (o.dmgMul ?? 1), { noCharge: true, source: 'rain' });
      }
    }
    // wind / gust front
    if (o.wind && fadeK > 0) {
      const c = this.mesh.position; const push = o.wind * 0.447; // mph -> m/s
      for (const e of g.enemies) {
        if (e.dead) continue; const rel = V(e.pos.x - c.x, 0, e.pos.z - c.z); const u = rel.dot(this.side) / (o.length! / 2);
        if (Math.abs(u) > 1) continue; const f = rel.dot(this.dir) - (o.bow ?? 0) * o.depth! * (1 - u * u);
        if (f > -o.depth! * 0.3 && f < o.depth! * 0.25) { e.pos.addScaledVector(this.dir, push * 0.12 * dt); if (Math.random() < dt * 4) g.damage(e, (o.windDmg ?? 0) * (o.dmgMul ?? 1), { noCharge: true, stun: 0.2 }); }
      }
      const pr = V(g.player.pos.x - c.x, 0, g.player.pos.z - c.z); const pu = pr.dot(this.side) / (o.length! / 2); const pf = pr.dot(this.dir) - (o.bow ?? 0) * o.depth! * (1 - pu * pu);
      if (Math.abs(pu) < 1 && Math.abs(pf) < o.depth! * 0.35) g.shakeRaw(o.wind / 60 * (1 - Math.abs(pf) / (o.depth! * 0.35)), 0.1);
      // gust front dust
      for (let i = 0; i < 4 * dens; i++) { const u = rnd(-1, 1); const p = V(c.x, 0, c.z).addScaledVector(this.side, u * o.length! / 2).addScaledVector(this.dir, (o.bow ?? 0) * o.depth! * (1 - u * u) + rnd(0, 20));
        g.smoke.spawn(p.x, rnd(1, 12), p.z, this.dir.x * push * 0.6, rnd(0, 3), this.dir.z * push * 0.6, 0xc8c2b8, rnd(8, 18), 2, { alpha: 0.18, grow: 1.5, turb: 6, drag: 0.3 }); }
    }
    // lightning
    if (o.bolts > 0 && this.growth > 0.7 && fadeK > 0) {
      this.boltT -= dt;
      if (this.boltT <= 0) {
        this.boltT = rnd(0.2, 2) / o.bolts;
        const isSuper = Math.random() < (o.superChance ?? 0); const mul = isSuper ? (o.superMul ?? 3) : 1;
        const rp = this.rainPoint(V()); rp.x += rnd(-10, 10);
        const top = V(rp.x + rnd(-20, 20), this.base * 0.9, rp.z + rnd(-20, 20));
        const col = isSuper ? (mul >= 12 ? 0xff66ff : 0xaaddff) : 0xcfe0ff;
        for (let k = 0; k < (isSuper ? 3 : 1); k++) g.bolt(top, rp, { color: col, width: isSuper ? (mul >= 12 ? 3.2 : 1.8) : 0.8, life: isSuper ? 0.6 : 0.3, segs: 18, jag: 0.045, branches: isSuper ? 3 : 2 });
        const r = isSuper ? (mul >= 12 ? 22 : 12) : 6;
        g.damageRadius(rp, r, (o.boltDmg ?? 3000) * mul * (o.dmgMul ?? 1), { stun: 0.4, noCharge: true });
        if (isSuper) explosion(g, rp, r, { core: 0xffffff, mid: col, ring: col, smoke: 0x333344, debrisCount: 10 });
        else g.flash(rp, 0xddeeff, 8);
        if (isSuper && o.superName) g.toast(o.superName + '!', mul >= 12 ? '#ff66ff' : '#9fdcff');
      }
    }
    // hail
    if (o.hail > 0 && this.growth > 0.75 && fadeK > 0) {
      this.hailT += dt * o.hail * 10 * Math.max(0.3, dens);
      while (this.hailT >= 1) {
        this.hailT -= 1;
        const rp = this.rainPoint(V()); const h = this.base * 0.7; const vy = 45; const tt = h / vy;
        g.fx.spawn(rp.x, h, rp.z, 0, -vy, 0, 0xeaf6ff, 0.9, tt, {});
        const dmg = (o.hailDmg ?? 8000) * (o.dmgMul ?? 1), sh = o.hailShatter ?? 0.6, shd = o.hailShatterDmg ?? 0.4;
        g.after(tt, () => {
          g.damageRadius(rp, 2.5, dmg, { noCharge: true });
          if (Math.random() < sh) { for (let i = 0; i < 5; i++) g.debris.spawn(rp.x, 0.4, rp.z, rnd(-6, 6), rnd(3, 7), rnd(-6, 6), 0.12, 0xdff4ff, 1.2); g.damageRadius(rp, 5, dmg * shd, { noCharge: true }); }
        });
      }
    }
    // tornadoes
    if (o.tornado && this.growth >= 1 && fadeK > 0.3) {
      this.tornT -= dt;
      if (this.tornT <= 0) { this.tornT = 1 / (o.tornadoRate ?? 0.05); g.add(new Tornado(g, this, Math.min(14, 6 + this.R * 0.02), o.kind === 'supercell' ? 200 : 170, Math.min(20, (this.o.life - this.t) * 0.8))); }
    }
    return this.t < o.life;
  }
  becomeSupercell() {
    this.isSuper = true; const o = this.o;
    o.bolts = 1.4; o.superChance = 0.45; o.superMul = 12; o.superName = 'HYPERBOLT'; o.hail = 2.2; o.rain = 1.4; o.tornado = true; o.tornadoRate = 0.08; o.rainDmg *= 1.8;
    this.tornT = 1.5;
    this.puffs.forEach((p, i) => { const s = p.shade * 0.8; this.mesh.setColorAt(i, _c.setRGB(s, s, s * 1.05)); });
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    // wall cloud
    const R = this.R; for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.28; this.puffs.push({ x: Math.cos(a) * R * 0.15, y: this.base * 0.75, z: Math.sin(a) * R * 0.15, r: R * 0.12, fy: 0.6, stage: 0, shade: 0.4 }); }
    const old = this.mesh; this.mesh = new THREE.InstancedMesh(PUFF_GEO, this.mat, this.puffs.length); this.mesh.position.copy(old.position); this.mesh.frustumCulled = false;
    this.puffs.forEach((p, i) => { const s = p.shade * 0.8; this.mesh.setColorAt(i, _c.setRGB(s, s, s)); });
    this.g.scene.remove(old); old.dispose(); this.g.scene.add(this.mesh);
    this.g.toast('SUPERCELL FORMED', '#ffb347');
  }
  dispose() { this.g.scene.remove(this.mesh); this.mesh.dispose(); this.mat.dispose(); }
}

/** Tornado: analytic swirling particle funnel + condensation cone + suction. */
export class Tornado implements Effect {
  t = 0; ps: ParticleSystem; cone: THREE.Mesh; pos = V(); wander = V(); ang: Float32Array; hgt: Float32Array; spd: Float32Array; N: number; dmgT = 0;
  constructor(public g: any, public cloud: StormCloud | null, public baseR: number, public mph: number, public life: number, fixed?: THREE.Vector3, public dmg = 2500) {
    this.N = Math.round(900 * g.settings.particles) + 100;
    this.ps = new ParticleSystem(this.N, false); g.scene.add(this.ps.points);
    this.ps.mat.uniforms.uScale.value = g.smoke.mat.uniforms.uScale.value;
    this.ang = new Float32Array(this.N); this.hgt = new Float32Array(this.N); this.spd = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) { this.ang[i] = Math.random() * 6.28; this.hgt[i] = Math.random(); this.spd[i] = rnd(0.6, 1.2);
      const c = rnd(0.45, 0.75); this.ps.col[i * 3] = c; this.ps.col[i * 3 + 1] = c * 0.97; this.ps.col[i * 3 + 2] = c * 0.93; this.ps.life[i] = 1e9; this.ps.maxLife[i] = 1e9; }
    this.cone = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.2, 1, 24, 8, true).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x777a80, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, roughness: 1 }));
    g.scene.add(this.cone);
    if (cloud) { const a = Math.random() * 6.28; this.pos.set(cloud.mesh.position.x + Math.cos(a) * cloud.R * 0.1, 0, cloud.mesh.position.z + Math.sin(a) * cloud.R * 0.1); }
    else if (fixed) this.pos.copy(fixed);
  }
  update(dt: number) {
    const g = this.g; this.t += dt;
    const H = this.cloud ? this.cloud.base * 0.8 : 120;
    if (this.cloud) { const cp = this.cloud.mesh.position; this.wander.x += (cp.x - this.pos.x) * 0.02 + rnd(-2, 2); this.wander.z += (cp.z - this.pos.z) * 0.02 + rnd(-2, 2); this.wander.multiplyScalar(0.95); this.pos.addScaledVector(this.wander, dt); this.pos.addScaledVector(this.cloud.o.vel, dt); }
    const k = Math.min(1, this.t / 1.5) * Math.min(1, (this.life - this.t) / 1.5);
    const topR = this.baseR * 4.5, w = this.mph * 0.447; // tangential m/s
    for (let i = 0; i < this.N; i++) {
      const h = this.hgt[i]; const r = (this.baseR + (topR - this.baseR) * h * h) * (0.8 + 0.4 * Math.sin(i));
      this.ang[i] += (w / Math.max(3, r)) * this.spd[i] * dt;
      this.hgt[i] += dt * 0.12 * this.spd[i]; if (this.hgt[i] > 1) this.hgt[i] = 0;
      const i3 = i * 3;
      this.ps.pos[i3] = this.pos.x + Math.cos(this.ang[i]) * r; this.ps.pos[i3 + 1] = h * H; this.ps.pos[i3 + 2] = this.pos.z + Math.sin(this.ang[i]) * r;
      this.ps.size[i] = (this.baseR * 1.4 + h * this.baseR * 3) * k; this.ps.alpha[i] = 0.35 * k * (h < 0.08 ? 1.4 : 1);
    }
    ['position', 'aColor', 'aSize', 'aAlpha'].forEach(n => (this.ps.geo.attributes[n] as THREE.BufferAttribute).needsUpdate = true);
    this.cone.position.copy(this.pos); this.cone.scale.set(topR * 0.8 * k, H, topR * 0.8 * k); this.cone.rotation.y += dt * 3;
    // debris cloud at base
    if (Math.random() < 0.6) { const a = Math.random() * 6.28; g.debris.spawn(this.pos.x + Math.cos(a) * this.baseR * 2, 1, this.pos.z + Math.sin(a) * this.baseR * 2, -Math.sin(a) * w * 0.3, rnd(10, 30), Math.cos(a) * w * 0.3, rnd(0.2, 0.7), 0x5a4a3a, 3); }
    // suction + continuous damage
    this.dmgT += dt; const tick = this.dmgT >= 0.1; if (tick) this.dmgT = 0;
    const suck = this.baseR * 7;
    for (const e of g.enemies) {
      if (e.dead) continue; const dx = this.pos.x - e.pos.x, dz = this.pos.z - e.pos.z; const d = Math.hypot(dx, dz);
      if (d < suck) { const f = (1 - d / suck); e.pos.x += (dx / d * 18 * f - dz / d * 10 * f) * dt; e.pos.z += (dz / d * 18 * f + dx / d * 10 * f) * dt; if (d < this.baseR * 2) e.lift = Math.max(e.lift, 0.3);
        if (tick) g.damage(e, this.dmg * f * (this.cloud?.o.dmgMul ?? 1), { noCharge: true }); }
    }
    const pd = Math.hypot(g.player.pos.x - this.pos.x, g.player.pos.z - this.pos.z); if (pd < 150) g.shakeRaw((1 - pd / 150) * 2, 0.1);
    return this.t < this.life;
  }
  dispose() { this.g.scene.remove(this.ps.points, this.cone); this.ps.geo.dispose(); this.ps.mat.dispose(); this.cone.geometry.dispose(); (this.cone.material as THREE.Material).dispose(); }
}

function spiralTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 1024; const x = c.getContext('2d')!;
  x.translate(512, 512);
  for (let arm = 0; arm < 5; arm++) {
    for (let i = 0; i < 1400; i++) {
      const t = i / 1400; const a = arm * (Math.PI * 2 / 5) + t * Math.PI * 4.2; const r = 40 + t * 470;
      const px = Math.cos(a) * r, py = Math.sin(a) * r; const s = 14 + t * 60 * Math.random();
      const gr = x.createRadialGradient(px, py, 0, px, py, s); const al = 0.13 * (1 - t * 0.6);
      gr.addColorStop(0, `rgba(245,248,255,${al})`); gr.addColorStop(1, 'rgba(245,248,255,0)'); x.fillStyle = gr; x.beginPath(); x.arc(px, py, s, 0, 6.28); x.fill();
    }
  }
  const g2 = x.createRadialGradient(0, 0, 0, 0, 0, 120); g2.addColorStop(0, 'rgba(250,252,255,0.0)'); g2.addColorStop(0.25, 'rgba(250,252,255,0.0)'); g2.addColorStop(0.45, 'rgba(250,252,255,0.9)'); g2.addColorStop(1, 'rgba(250,252,255,0.3)');
  x.fillStyle = g2; x.beginPath(); x.arc(0, 0, 120, 0, 6.28); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** 25 km hurricane with calm eye, towering eyewall, spiral bands, rain-wall mist & outward wind. */
export class Hurricane implements Effect {
  t = 0; grp = new THREE.Group(); disk: THREE.Mesh; disk2: THREE.Mesh; wall: THREE.InstancedMesh; tex: THREE.Texture; pos: THREE.Vector3; dir: THREE.Vector3; dmgT = 0;
  eye = 120; wallR = 420; R = 12500;
  constructor(public g: any, at: THREE.Vector3, dir: THREE.Vector3, public life = 300, public dmg = 4000) {
    this.pos = at.clone().setY(0); this.dir = dir.clone().setY(0).normalize();
    this.tex = spiralTexture();
    const mk = (y: number, s: number, op: number) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide })); m.position.y = y; m.scale.setScalar(s); return m; };
    this.disk = mk(1800, this.R * 2, 0.95); this.disk2 = mk(700, this.R * 1.1, 0.6);
    const n = Math.round(90 * g.settings.clouds) + 20;
    this.wall = new THREE.InstancedMesh(PUFF_GEO, new THREE.MeshStandardMaterial({ color: 0xcfd4dc, roughness: 1, transparent: true, opacity: 0.9, emissive: 0x15181e }), n);
    for (let i = 0; i < n; i++) { const a = (i / n) * 6.28 * 2; const r = this.eye + rnd(20, 90) + (i % 3) * 60; const y = rnd(80, 1500);
      _p.set(Math.cos(a) * r, y, Math.sin(a) * r); _s.set(rnd(80, 160), rnd(120, 260), rnd(80, 160)); _m.compose(_p, _q.identity(), _s); this.wall.setMatrixAt(i, _m); }
    this.wall.frustumCulled = false;
    this.grp.add(this.disk, this.disk2, this.wall); this.grp.position.copy(this.pos); g.scene.add(this.grp);
  }
  update(dt: number) {
    const g = this.g; this.t += dt; const k = Math.min(1, this.t / 4) * Math.min(1, (this.life - this.t) / 5);
    this.pos.addScaledVector(this.dir, 15 * dt); this.grp.position.copy(this.pos);
    this.disk.rotation.y -= dt * 0.03; this.disk2.rotation.y -= dt * 0.05; this.wall.rotation.y -= dt * 0.12;
    (this.disk.material as THREE.MeshBasicMaterial).opacity = 0.95 * k; (this.disk2.material as THREE.MeshBasicMaterial).opacity = 0.6 * k; (this.wall.material as THREE.MeshStandardMaterial).opacity = 0.9 * k;
    const w = 350 * 0.447; const dens = g.settings.particles;
    // eyewall rain mist (blasting, tangential)
    for (let i = 0; i < 26 * dens; i++) { const a = Math.random() * 6.28; const r = this.eye + rnd(0, this.wallR - this.eye);
      g.smoke.spawn(this.pos.x + Math.cos(a) * r, rnd(1, 90), this.pos.z + Math.sin(a) * r, -Math.sin(a) * w * 0.5 + Math.cos(a) * 20, rnd(-20, -5), Math.cos(a) * w * 0.5 + Math.sin(a) * 20, 0xe6e9ee, rnd(18, 45), rnd(1, 2.2), { alpha: 0.2 * k, grow: 1.2, turb: 8, spread: 0.3 }); }
    // mist around player if inside rain bands
    const pp = g.player.pos; const pd = Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z);
    if (pd > this.eye && pd < this.R) { const ca = Math.atan2(pp.z - this.pos.z, pp.x - this.pos.x); const inten = pd < this.wallR ? 1 : Math.max(0.15, 1 - (pd - this.wallR) / 4000);
      for (let i = 0; i < 18 * dens * inten; i++) { const x = pp.x + rnd(-80, 80), z = pp.z + rnd(-80, 80); g.smoke.spawn(x, rnd(2, 40), z, -Math.sin(ca) * w * 0.4 * inten, -15, Math.cos(ca) * w * 0.4 * inten, 0xdfe3ea, rnd(6, 16), 1.5, { alpha: 0.18, grow: 1, turb: 6 }); }
      g.shakeRaw(inten * 3 * k, 0.1); }
    this.dmgT += dt; const tick = this.dmgT >= 0.25; if (tick) this.dmgT = 0;
    for (const e of g.enemies) {
      if (e.dead) continue; const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z; const d = Math.hypot(dx, dz) || 1;
      if (d < this.eye || d > this.R) continue;
      const f = d < this.wallR ? 1 : Math.max(0.1, 1 - (d - this.wallR) / 3000);
      e.pos.x += (dx / d * 25 - dz / d * 18) * f * dt * k; e.pos.z += (dz / d * 25 + dx / d * 18) * f * dt * k;
      if (tick) g.damage(e, this.dmg * f, { noCharge: true, stun: 0.3 });
    }
    return this.t < this.life;
  }
  dispose() { this.g.scene.remove(this.grp); this.grp.traverse((o: any) => { o.material?.dispose(); }); this.disk.geometry.dispose(); this.disk2.geometry.dispose(); this.wall.dispose(); this.tex.dispose(); }
}

/** Rising flood water that drowns enemies. */
export class Flood implements Effect {
  t = 0; mesh: THREE.Mesh; dmgT = 0;
  constructor(public g: any, public pos: THREE.Vector3, public r: number, public life: number, public maxH: number, public dmg: number) {
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a5d7a, transparent: true, opacity: 0.72, roughness: 0.08, metalness: 0.4, emissive: 0x051a28 }));
    this.mesh.scale.setScalar(r); this.mesh.position.set(pos.x, 0.02, pos.z); g.scene.add(this.mesh);
  }
  get level() { return Math.min(this.maxH, (this.t / 18) * this.maxH) * Math.min(1, (this.life - this.t) / 3); }
  update(dt: number) {
    const g = this.g; this.t += dt; const h = this.level; this.mesh.position.y = 0.02 + h;
    if (Math.random() < 0.8) { const a = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * this.r; g.fx.spawn(this.pos.x + Math.cos(a) * rr, h + 0.2, this.pos.z + Math.sin(a) * rr, 0, 1.5, 0, 0x9cc8ff, 1.5, 0.4, {}); }
    this.dmgT += dt; if (this.dmgT >= 0.25) { this.dmgT = 0;
      for (const e of g.enemies) if (!e.dead && Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) < this.r) { const sub = Math.min(1, h / e.height); if (sub > 0.05) { g.damage(e, this.dmg * sub * (sub >= 1 ? 3 : 1), { noCharge: true, stun: sub > 0.6 ? 0.3 : 0 }); if (sub >= 1) g.fx.spawn(e.pos.x, h + 0.3, e.pos.z, 0, 2, 0, 0xffffff, 0.8, 0.6, {}); } } }
    return this.t < this.life;
  }
  dispose() { this.g.scene.remove(this.mesh); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

/** Microburst: scattered cells form, merge, then a 200 m/s downburst with an expanding rain wall. */
export class Microburst implements Effect {
  t = 0; cells: StormCloud[] = []; offs: THREE.Vector3[] = []; ringMesh: THREE.Mesh; dmgT = 0;
  constructor(public g: any, public pos: THREE.Vector3, public size = 150, public dmg = 3500) {
    for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28 + rnd(-0.3, 0.3); const off = V(Math.cos(a) * size * 0.9, 0, Math.sin(a) * size * 0.9); this.offs.push(off);
      const c = new StormCloud(g, { pos: pos.clone().add(off), kind: 'cell', size: size * 0.55, life: 16, grow: 2.2, rain: 0, shade: 0.85 }); this.cells.push(c); g.add(c); }
    this.ringMesh = new THREE.Mesh(GEO.torus, new THREE.MeshBasicMaterial({ color: 0xeef3ff, transparent: true, opacity: 0, depthWrite: false })); this.ringMesh.position.set(pos.x, 3, pos.z); g.scene.add(this.ringMesh);
  }
  update(dt: number) {
    const g = this.g; this.t += dt;
    const merge = Math.min(1, Math.max(0, (this.t - 2.5) / 2.5));
    this.cells.forEach((c, i) => { c.mesh.position.set(this.pos.x + this.offs[i].x * (1 - merge * 0.85), 0, this.pos.z + this.offs[i].z * (1 - merge * 0.85)); });
    if (this.t > 5 && this.t < 15) {
      const k = Math.min(1, (this.t - 5) / 0.5); const base = this.cells[0].base * 0.7; const dens = g.settings.particles;
      for (let i = 0; i < 40 * dens; i++) { const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * this.size * 0.35;
        g.smoke.spawn(this.pos.x + Math.cos(a) * r, base, this.pos.z + Math.sin(a) * r, 0, -200, 0, 0xf0f3f8, rnd(12, 26), base / 200 + rnd(1.2, 2.2), { alpha: 0.22 * k, spread: 0.45, drag: 0.6, grow: 1.6, turb: 6, ox: this.pos.x, oz: this.pos.z }); }
      const wallR = Math.min(this.size, (this.t - 5) * 60);
      this.ringMesh.scale.set(wallR, wallR, wallR * 8); (this.ringMesh.material as THREE.MeshBasicMaterial).opacity = 0.25;
      const dp = Math.hypot(g.player.pos.x - this.pos.x, g.player.pos.z - this.pos.z); if (dp < this.size * 1.5) g.shakeRaw(4 * (1 - dp / (this.size * 1.5)) + 0.5, 0.1);
      this.dmgT += dt; const tick = this.dmgT > 0.2; if (tick) this.dmgT = 0;
      for (const e of g.enemies) { if (e.dead) continue; const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z; const d = Math.hypot(dx, dz) || 1;
        if (d < this.size) { const f = 220 * 0.447 * 0.35 * (1 - d / this.size * 0.5); e.pos.x += dx / d * f * dt; e.pos.z += dz / d * f * dt; if (tick) g.damage(e, this.dmg, { noCharge: true, stun: 0.3 }); } }
    } else (this.ringMesh.material as THREE.MeshBasicMaterial).opacity = 0;
    return this.t < 16;
  }
  dispose() { this.g.scene.remove(this.ringMesh); (this.ringMesh.material as THREE.Material).dispose(); }
}

export { addMat };

import * as THREE from 'three';
import type { Effect, HitOpts } from './types';

export const GEO = {
  sphere: new THREE.IcosahedronGeometry(1, 3),
  sphereLo: new THREE.IcosahedronGeometry(1, 1),
  rock: new THREE.DodecahedronGeometry(1, 1),
  ring: new THREE.RingGeometry(0.85, 1, 64).rotateX(-Math.PI / 2),
  disc: new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
  torus: new THREE.TorusGeometry(1, 0.08, 8, 48).rotateX(Math.PI / 2),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16, 1, true).translate(0, 0.5, 0),
  cylC: new THREE.CylinderGeometry(1, 1, 1, 12, 1, true),
  cone: new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0),
  box: new THREE.BoxGeometry(1, 1, 1),
  crescent: makeCrescent(),
  dome: new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
};

function makeCrescent() {
  const s = new THREE.Shape();
  const N = 24;
  for (let i = 0; i <= N; i++) { const a = -Math.PI * 0.45 + (i / N) * Math.PI * 0.9; const x = Math.cos(a), y = Math.sin(a); i === 0 ? s.moveTo(x, y) : s.lineTo(x, y); }
  for (let i = N; i >= 0; i--) { const a = -Math.PI * 0.45 + (i / N) * Math.PI * 0.9; const w = 0.72 + 0.18 * Math.cos(a * 1.1); s.lineTo(Math.cos(a) * w + 0.05, Math.sin(a) * w); }
  return new THREE.ShapeGeometry(s);
}

export const rnd = (a: number, b: number) => a + Math.random() * (b - a);
export const rndi = (a: number, b: number) => Math.floor(rnd(a, b + 1));
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export function addMat(color: number, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
}
export function alphaMat(color: number, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
}

/** Generic timed object with custom per-frame animation. Disposes its own materials. */
export class Timed implements Effect {
  t = 0;
  constructor(public g: any, public obj: THREE.Object3D, public life: number, public fn: (k: number, t: number, dt: number, self: Timed) => void) {
    g.scene.add(obj);
  }
  update(dt: number) { this.t += dt; const k = Math.min(1, this.t / this.life); this.fn(k, this.t, dt, this); return this.t < this.life; }
  dispose() {
    this.obj.parent?.remove(this.obj);
    this.obj.traverse((o: any) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m.dispose()); if (o.userData.ownGeo) o.geometry.dispose(); });
  }
}

export interface ExplosionStyle {
  core?: number; mid?: number; smoke?: number; ring?: number; debris?: number; debrisCount?: number;
  sparks?: number; shake?: number; smokeCount?: number; ringOnly?: boolean; dur?: number; noFlash?: boolean; spikes?: number;
}

/** Fireball + shell + ground ring + sparks + smoke + physical debris. */
export function explosion(g: any, pos: THREE.Vector3, r: number, s: ExplosionStyle = {}) {
  const core = s.core ?? 0xffcc66, mid = s.mid ?? 0xff5511, dur = s.dur ?? 0.8;
  const grp = new THREE.Group(); grp.position.copy(pos);
  const vr = Math.min(r, 6000);
  if (!s.ringOnly) {
    const m1 = new THREE.Mesh(GEO.sphere, addMat(core, 1)); const m2 = new THREE.Mesh(GEO.sphere, addMat(mid, 0.55));
    grp.add(m1, m2);
    if (s.spikes) for (let i = 0; i < s.spikes; i++) {
      const sp = new THREE.Mesh(GEO.cone, addMat(core, 0.8)); sp.rotation.set(rnd(-1.4, 1.4), rnd(0, 6.28), rnd(-1.4, 1.4)); sp.userData.sp = 1; grp.add(sp);
    }
  }
  const ring = new THREE.Mesh(GEO.ring, addMat(s.ring ?? mid, 0.9)); ring.position.y = 0.2 - pos.y; grp.add(ring);
  g.add(new Timed(g, grp, dur * 1.6, (k) => {
    const e = 1 - Math.pow(1 - Math.min(1, k * 2.2), 3);
    grp.children.forEach((c: any, i) => {
      if (c === ring) { c.scale.setScalar(vr * (0.3 + e * 1.3)); c.material.opacity = 0.9 * (1 - k); return; }
      if (c.userData.sp) { c.scale.set(vr * 0.12 * (1 - k), vr * 1.3 * e, vr * 0.12 * (1 - k)); c.material.opacity = 0.8 * (1 - k); return; }
      c.scale.setScalar(vr * (0.15 + e * (i === 0 ? 0.85 : 1.1)));
      c.material.opacity = (i === 0 ? 1 : 0.55) * Math.max(0, 1 - k * 1.3);
    });
  }));
  const n = Math.min(90, 12 + r * 2) | 0;
  const col = new THREE.Color(core), col2 = new THREE.Color(mid);
  for (let i = 0; i < n; i++) {
    const d = V(rnd(-1, 1), rnd(0.1, 1.2), rnd(-1, 1)).normalize().multiplyScalar(vr * rnd(1, 3.2));
    g.fx.spawn(pos.x, pos.y + 0.5, pos.z, d.x, d.y, d.z, i % 2 ? col : col2, Math.max(0.3, vr * 0.05), rnd(0.4, 1.1), { grav: 12, drag: 1.5 });
  }
  const sn = s.smokeCount ?? Math.min(40, 6 + r) | 0;
  for (let i = 0; i < sn; i++) {
    const a = Math.random() * 6.28, rr = Math.random() * vr * 0.7;
    g.smoke.spawn(pos.x + Math.cos(a) * rr, pos.y + rnd(0, vr * 0.5), pos.z + Math.sin(a) * rr, Math.cos(a) * vr * 0.3, rnd(1, vr * 0.25), Math.sin(a) * vr * 0.3,
      s.smoke ?? 0x3a3330, vr * rnd(0.5, 0.9), rnd(1.5, 3), { drag: 1.2, grow: 1.2, alpha: 0.55, turb: 2 });
  }
  const dn = s.debrisCount ?? Math.min(36, 4 + r * 0.7) | 0;
  for (let i = 0; i < dn; i++) {
    const a = Math.random() * 6.28, sp = rnd(8, 16 + Math.min(r, 200) * 0.8);
    g.debris.spawn(pos.x + rnd(-1, 1), Math.max(0.5, pos.y), pos.z + rnd(-1, 1), Math.cos(a) * sp, rnd(8, 18 + Math.min(r, 200) * 0.6), Math.sin(a) * sp,
      Math.min(4, Math.max(0.15, vr * rnd(0.02, 0.07))), s.debris ?? 0x5b4a3a, rnd(2.5, 5));
  }
  if (!s.noFlash) g.flash(pos, core, Math.min(40, 4 + r * 0.4));
  g.shake(pos, s.shake ?? Math.min(25, 1.5 + r * 0.12), 0.45);
}

export function shockwave(g: any, pos: THREE.Vector3, r: number, dur = 0.7, color = 0xffffff, opacity = 0.45, dome = true) {
  const grp = new THREE.Group(); grp.position.set(pos.x, 0.05, pos.z);
  const d = new THREE.Mesh(dome ? GEO.dome : GEO.sphere, alphaMat(color, opacity));
  const ring = new THREE.Mesh(GEO.ring, addMat(color, 0.8)); ring.position.y = 0.3;
  grp.add(d, ring);
  g.add(new Timed(g, grp, dur, (k) => {
    const e = 1 - Math.pow(1 - k, 3);
    d.scale.set(r * e, r * e * 0.45, r * e); (d.material as any).opacity = opacity * (1 - k);
    ring.scale.setScalar(r * e * 1.05); (ring.material as any).opacity = 0.8 * (1 - k);
  }));
}

/** Ground cracks built from flat lightning bolts (explicitly allowed reuse for Quake). */
export function cracks(g: any, pos: THREE.Vector3, radius: number, count: number, color: number, life = 1.2, width = 0.35) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd(-0.2, 0.2);
    const l = radius * rnd(0.5, 1);
    g.bolt(V(pos.x, 0.08, pos.z), V(pos.x + Math.cos(a) * l, 0.08, pos.z + Math.sin(a) * l), { color, core: 0xe0ffff, width, life, segs: 14, jag: 0.08, branches: 2, flat: true });
  }
}

const PIT_FS = `
uniform float uTime; uniform vec3 uA; uniform vec3 uB; uniform float uOp; varying vec2 vUv;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
void main(){ vec2 c=vUv-0.5; float d=length(c)*2.; if(d>1.) discard;
 float f = n(c*9.+vec2(0.,-uTime*1.5))*0.6 + n(c*23.-uTime*0.7)*0.4;
 float m = smoothstep(1.0,0.6,d);
 vec3 col = mix(uB,uA,f);
 gl_FragColor=vec4(col*(1.2+f), m*uOp*(0.55+f*0.6)); }`;
const PIT_VS = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;

/** Damaging ground pit (firepit / burn pit / lava pit). */
export class Pit implements Effect {
  t = 0; tickT = 0; mesh: THREE.Mesh;
  constructor(public g: any, public pos: THREE.Vector3, public r: number, public life: number, a: number, b: number, public onTick: (p: Pit) => void, public tick = 0.5, public ember = 0xff7722) {
    const mat = new THREE.ShaderMaterial({ vertexShader: PIT_VS, fragmentShader: PIT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uA: { value: new THREE.Color(a) }, uB: { value: new THREE.Color(b) }, uOp: { value: 1 } } });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), mat);
    this.mesh.position.set(pos.x, 0.14 + Math.random() * 0.08, pos.z); this.mesh.scale.setScalar(r); this.mesh.renderOrder = 2;
    g.scene.add(this.mesh);
  }
  update(dt: number) {
    this.t += dt; this.tickT += dt;
    const m = this.mesh.material as THREE.ShaderMaterial; m.uniforms.uTime.value = this.t;
    m.uniforms.uOp.value = Math.min(1, (this.life - this.t) / 1.0);
    if (this.tickT >= this.tick) { this.tickT = 0; this.onTick(this); }
    if (Math.random() < Math.min(1, this.r * 0.08)) {
      const a = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * this.r;
      this.g.fx.spawn(this.pos.x + Math.cos(a) * rr, 0.3, this.pos.z + Math.sin(a) * rr, rnd(-1, 1), rnd(3, 8), rnd(-1, 1), this.ember, rnd(0.4, 1.2), rnd(0.6, 1.4), { drag: 0.5, turb: 3 });
    }
    return this.t < this.life;
  }
  dispose() { this.g.scene.remove(this.mesh); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

export interface ProjOpts {
  pos: THREE.Vector3; vel: THREE.Vector3; mesh: THREE.Object3D; life?: number; gravity?: number;
  homing?: () => THREE.Vector3 | null; turn?: number; hitR?: number; hitEnemies?: boolean; hitGround?: boolean;
  onHit: (p: THREE.Vector3, enemy?: any) => void; trail?: (p: THREE.Vector3, dt: number, self: Projectile) => void; spin?: number; pierce?: boolean;
}
export class Projectile implements Effect {
  t = 0; dead = false; o: ProjOpts; hitSet = new Set<any>();
  constructor(public g: any, o: ProjOpts) { this.o = { life: 6, gravity: 0, turn: 6, hitR: 1.5, hitEnemies: true, hitGround: true, ...o }; o.mesh.position.copy(o.pos); g.scene.add(o.mesh); }
  update(dt: number) {
    if (this.dead) return false;
    const o = this.o; this.t += dt;
    if (o.homing) { const tg = o.homing(); if (tg) { const sp = o.vel.length(); const want = tg.clone().sub(o.pos).normalize().multiplyScalar(sp); o.vel.lerp(want, Math.min(1, o.turn! * dt)).setLength(sp); } }
    o.vel.y -= o.gravity! * dt;
    // sub-step to avoid tunnelling at very high speeds (e.g. 930 m/s slashes)
    const steps = Math.min(12, Math.max(1, Math.ceil((o.vel.length() * dt) / (o.hitR! * 1.5))));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      o.pos.addScaledVector(o.vel, sdt);
      if (o.hitEnemies) {
        for (const e of this.g.enemies) {
          if (e.dead || this.hitSet.has(e)) continue;
          if (e.pos.distanceToSquared(o.pos) < (o.hitR! + e.radius) ** 2) {
            if (o.pierce) { this.hitSet.add(e); o.onHit(o.pos.clone(), e); continue; }
            o.onHit(o.pos.clone(), e); this.dead = true; return false;
          }
        }
      }
      if (o.hitGround && o.pos.y <= 0.2) { o.pos.y = 0.2; o.onHit(o.pos.clone()); this.dead = true; return false; }
    }
    o.mesh.position.copy(o.pos);
    if (o.spin) { o.mesh.rotation.x += o.spin * dt; o.mesh.rotation.y += o.spin * 0.7 * dt; }
    o.trail?.(o.pos, dt, this);
    if (this.t > o.life!) { if (!o.hitGround) o.onHit(o.pos.clone()); return false; }
    return true;
  }
  dispose() { this.o.mesh.parent?.remove(this.o.mesh); this.o.mesh.traverse((c: any) => { if (c.material && !c.userData.shared) c.material.dispose(); }); }
}

/** Straight beam cylinder between two points. */
export function beam(g: any, a: THREE.Vector3, b: THREE.Vector3, color: number, width: number, life: number, core = 0xffffff) {
  const grp = new THREE.Group();
  const len = a.distanceTo(b);
  const outer = new THREE.Mesh(GEO.cylC, addMat(color, 0.7)); const inner = new THREE.Mesh(GEO.cylC, addMat(core, 1));
  grp.add(outer, inner); grp.position.copy(a).add(b).multiplyScalar(0.5);
  grp.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  g.add(new Timed(g, grp, life, (k) => {
    const w = width * (1 - k * k);
    outer.scale.set(w, len, w); inner.scale.set(w * 0.35, len, w * 0.35);
    (outer.material as any).opacity = 0.7 * (1 - k); (inner.material as any).opacity = 1 - k;
  }));
}

/** Falling rock (asteroid / meteor / boulder) that impacts at target. */
export function fallingRock(g: any, target: THREE.Vector3, size: number, speed: number, color: number, glow: number, onImpact: (p: THREE.Vector3) => void, height = 160, lateral = 0.35) {
  const dir = V(rnd(-lateral, lateral), -1, rnd(-lateral, lateral)).normalize();
  const start = target.clone().addScaledVector(dir, -height / Math.abs(dir.y));
  const grp = new THREE.Group();
  const rock = new THREE.Mesh(GEO.rock, new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true, emissive: glow, emissiveIntensity: 0.6 }));
  rock.scale.setScalar(size); rock.castShadow = true;
  const aura = new THREE.Mesh(GEO.sphereLo, addMat(glow, 0.35)); aura.scale.setScalar(size * 1.35);
  grp.add(rock, aura);
  const gc = new THREE.Color(glow);
  g.add(new Projectile(g, {
    pos: start, vel: dir.multiplyScalar(speed), mesh: grp, hitEnemies: false, spin: 2, life: 20,
    onHit: (p) => onImpact(V(p.x, 0, p.z)),
    trail: (p) => {
      g.fx.spawn(p.x + rnd(-size, size) * 0.5, p.y + size * 0.5, p.z + rnd(-size, size) * 0.5, 0, 2, 0, gc, size * 1.2, 0.35, { grow: -0.5 });
      if (Math.random() < 0.5) g.smoke.spawn(p.x, p.y + size, p.z, rnd(-1, 1), 2, rnd(-1, 1), 0x2a2522, size * 1.6, 1.4, { grow: 1, alpha: 0.5, turb: 1 });
    },
  }));
}

/** Tsunami wave wall moving through; damages & pushes enemies it passes. */
export class Tsunami implements Effect {
  t = 0; grp = new THREE.Group(); hits = new Map<any, number>(); dir: THREE.Vector3; pos: THREE.Vector3; dist: number;
  constructor(public g: any, from: THREE.Vector3, to: THREE.Vector3, public w: number, public h: number, public speed: number, public dmg: number, color = 0x1e6fd0) {
    this.pos = from.clone(); this.pos.y = 0; this.dir = to.clone().sub(from).setY(0).normalize(); this.dist = from.distanceTo(to) * 2;
    const geo = new THREE.PlaneGeometry(1, 1, 24, 10); const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i) + 0.5; const curl = Math.pow(y, 2.2) * 0.45; p.setXYZ(i, x, y * (1 - 0.15 * Math.cos(x * Math.PI * 2)), curl - Math.sin(y * 2.2) * 0.25); }
    geo.computeVertexNormals();
    const water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.78, roughness: 0.15, metalness: 0.3, side: THREE.DoubleSide, emissive: 0x0a2a55 }));
    water.userData.ownGeo = true; water.scale.set(w, h, h * 0.8);
    this.grp.add(water); this.grp.position.copy(this.pos);
    this.grp.lookAt(this.pos.clone().add(this.dir)); g.scene.add(this.grp);
  }
  update(dt: number) {
    this.t += dt; const step = this.speed * dt; this.pos.addScaledVector(this.dir, step); this.grp.position.copy(this.pos);
    const k = Math.min(1, this.t / 0.4) * Math.min(1, (this.dist / this.speed - this.t) / 0.6);
    this.grp.scale.set(1, Math.max(0.01, k), 1);
    const side = V(-this.dir.z, 0, this.dir.x);
    for (let i = 0; i < 3; i++) { const o = rnd(-0.5, 0.5) * this.w; this.g.smoke.spawn(this.pos.x + side.x * o, this.h * k * rnd(0.6, 1), this.pos.z + side.z * o, this.dir.x * this.speed * 0.5, rnd(1, 4), this.dir.z * this.speed * 0.5, 0xe8f4ff, this.h * 0.35, 0.9, { grav: 6, alpha: 0.7, grow: 0.8 }); }
    for (const e of this.g.enemies) {
      if (e.dead) continue; const rel = e.pos.clone().sub(this.pos); const fwd = rel.dot(this.dir); const lat = Math.abs(rel.dot(side));
      if (fwd > -this.h * 0.6 && fwd < this.h * 0.4 && lat < this.w / 2) {
        const last = this.hits.get(e) ?? -9; if (this.t - last > 0.3) { this.hits.set(e, this.t); this.g.damage(e, this.dmg, { knock: 4, from: this.pos.clone().addScaledVector(this.dir, -2), stun: 0.3 }); }
        e.pos.addScaledVector(this.dir, step * 0.8);
      }
    }
    return this.t < this.dist / this.speed;
  }
  dispose() { this.g.scene.remove(this.grp); this.grp.traverse((o: any) => { o.material?.dispose(); o.userData.ownGeo && o.geometry.dispose(); }); }
}

/** Crescent slash visual. */
export function slashMesh(color: number, size: number, opacity = 0.9) {
  const m = new THREE.Mesh(GEO.crescent, addMat(color, opacity)); m.scale.setScalar(size); return m;
}

export type { HitOpts };

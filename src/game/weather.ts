import * as THREE from 'three';
import type { Effect } from './types';
import { rnd, V, addMat, explosion } from './effects';
import { ParticleSystem } from './particles';
import { MicroburstFlow } from './fluids';

const PUFF_GEO = new THREE.SphereGeometry(1, 12, 8);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();
const GUST_FRONT_SCALE = 3.72;

interface Puff { x: number; y: number; z: number; r: number; fy: number; stage: number; shade: number }
export type CloudKind = 'cumulus' | 'cell' | 'stratus' | 'nimbo' | 'squall' | 'derecho' | 'supercell' | 'hail';

export interface CloudOpts {
  pos: THREE.Vector3; kind: CloudKind; size: number; life: number; vel?: THREE.Vector3; grow?: number; densityScale?: number;
  rain?: number; rainDmg?: number; hail?: number; hailDmg?: number; hailShatter?: number; hailShatterDmg?: number;
  bolts?: number; boltDmg?: number; superChance?: number; superMul?: number; superName?: string;
  tornado?: boolean; tornadoRate?: number; wind?: number; windDmg?: number; supercellChance?: number;
  length?: number; depth?: number; bow?: number; shade?: number; rainColor?: number; dmgMul?: number; spin?: number;
}

/** Dynamic-growing volumetric-ish cloud built from instanced puffs, with rainshafts, hail, lightning, tornadoes. */
export class StormCloud implements Effect {
  t = 0; o: CloudOpts & Required<Pick<CloudOpts, 'vel' | 'grow' | 'rain' | 'rainDmg' | 'hail' | 'bolts'>>;
  puffs: Puff[] = []; mesh: THREE.InstancedMesh; mat: THREE.MeshStandardMaterial; base: number; R: number; growth = 0;
  rainTick = 0; boltT = 0; hailT = 0; tornT = 0; layoutT = 0; rainSeq = 0; gustSeq = 0; shaftAcc = 0; dropAcc = 0; gustAcc = 0; rainSeed = Math.random(); gustSounded = false; isSuper = false; evolved = false; dir: THREE.Vector3; side: THREE.Vector3; stageName = '';
  constructor(public g: any, o: CloudOpts) {
    this.o = { vel: V(), grow: 0.01, rain: 0, rainDmg: 0, hail: 0, bolts: 0, ...o } as any;
    this.R = o.size / 2;
    this.base = o.kind === 'squall' || o.kind === 'derecho' ? Math.max(165, 55 + o.size * 0.1) : Math.min(260, 45 + o.size * 0.1);
    this.dir = this.o.vel.lengthSq() > 0 ? this.o.vel.clone().normalize() : V(0, 0, 1);
    this.side = V(-this.dir.z, 0, this.dir.x);
    this.isSuper = o.kind === 'supercell';
    this.build();
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, transparent: true, opacity: 0.96, emissive: 0x1a1d24, depthWrite: true });
    this.mesh = new THREE.InstancedMesh(PUFF_GEO, this.mat, this.puffs.length);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false;
    // Transparent puff volumes add substantial shadow-map overdraw without a useful hard shadow.
    this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    this.puffs.forEach((p, i) => { const s = p.shade * (o.shade ?? 1); this.mesh.setColorAt(i, _c.setRGB(s, s, s * 1.03)); });
    this.mesh.position.copy(o.pos); this.mesh.position.y = 0;
    g.scene.add(this.mesh);
    this.layout();
  }
  addPuff(x: number, y: number, z: number, r: number, stage: number, shade: number, fy = 1) { this.puffs.push({ x, y, z, r, fy, stage, shade }); }
  build() {
    const R = this.R, b = this.base, k = this.o.kind, dens = this.g.settings.clouds;
    const N = (n: number) => Math.max(3, Math.round(n * dens * (this.o.densityScale ?? 1)));
    const disk=(i:number,n:number,radius:number,phase=0):[number,number]=>{const rr=Math.sqrt((i+.5)/n)*radius,a=i*2.399963229728653+phase;return [Math.cos(a)*rr,Math.sin(a)*rr];};
    if (k === 'cumulus' || k === 'cell' || k === 'supercell' || k === 'hail') {
      const n0=N(16),n1=N(14),n2=N(12),n3=N(20);
      for (let i = 0; i < n0; i++) { const [x,z]=disk(i,n0,R*.55); this.addPuff(x,b+rnd(0,R*.08),z,R*rnd(.22,.34),rnd(0,.2),rnd(.5,.68),.55); }
      for (let i = 0; i < n1; i++) { const [x,z]=disk(i,n1,R*.4,.7); this.addPuff(x,b+R*rnd(.2,.7),z,R*rnd(.22,.32),rnd(.2,.45),rnd(.8,.95)); }
      for (let i = 0; i < n2; i++) { const [x,z]=disk(i,n2,R*.3,1.4); this.addPuff(x,b+R*rnd(.7,1.4),z,R*rnd(.2,.28),rnd(.45,.72),rnd(.9,1)); }
      for (let i = 0; i < n3; i++) { const [x,z]=disk(i,n3,R*1.25,2.1); this.addPuff(x+R*.25,b+R*rnd(1.5,1.7),z,R*rnd(.28,.4),rnd(.72,.98),rnd(.88,1),.3); }
      // Overlapping core puffs close the visual gaps above the rain/hail column and tornado origin.
      if(k==='supercell'||k==='cumulus'){
        const nc=N(k==='supercell'?38:32);for (let i = 0; i < nc; i++) { const [x,z]=disk(i,nc,R*.58,.37);
          this.addPuff(x,b+R*rnd(.12,1.2),z,R*rnd(.18,.27),rnd(.06,.7),rnd(.62,.84),rnd(.72,1.05)); }
      } else {
        const nc=N(26);for(let i=0;i<nc;i++){const [x,z]=disk(i,nc,R*.52,.37);this.addPuff(x,b+R*rnd(.18,1.15),z,R*rnd(.17,.25),rnd(.08,.68),rnd(.62,.84),rnd(.72,1.05));}
      }
      if(k==='supercell'||k==='cumulus'){
        // Broad, flattened anvil canopy: it develops late on Cumulonimbus and fills the supercell crown.
        const na=N(k==='supercell'?42:30);for(let i=0;i<na;i++){const [x,z]=disk(i,na,R*(k==='supercell'?1.55:1.42),2.8);
          this.addPuff(x,b+R*rnd(1.48,1.8),z,R*rnd(.28,.4),rnd(.72,.9),rnd(.82,.96),rnd(.18,.27));}
      }
      // Explicit supercells also carry a dense, suspended wall-cloud base.
      if(k==='supercell'){const nw=N(18);for(let i=0;i<nw;i++){const [x,z]=disk(i,nw,R*.2,.1);
        this.addPuff(x,b+R*rnd(.08,.3),z,R*rnd(.2,.29),0,rnd(.38,.52),rnd(.48,.66));}}
      this.addPuff(0, b + R * 1.85, 0, R * 0.25, 0.9, 1); // overshooting top
    } else if (k === 'stratus' || k === 'nimbo') {
      const n = k === 'nimbo' ? Math.max(18,N(36)) : Math.max(9,N(16));
      for (let i = 0; i < n; i++) { const [x,z]=disk(i,n,R*.85,.23); this.addPuff(x,b+rnd(0,R*.05),z,R*rnd(.25,.38),0,k==='nimbo'?rnd(.42,.55):rnd(.7,.8),.28); }
    } else { // squall / derecho line: shelf cloud front + taller body behind
      const L = this.o.length!, D = this.o.depth!, bow = this.o.bow ?? 0;
      const cols = N(Math.min(60, Math.ceil(L / (D * 0.25)))); const pr = Math.max(L / cols, D * 0.12);
      for (let i = 0; i < cols; i++) {
        const u = (i / (cols - 1)) * 2 - 1; const fwd = bow * D * (1 - u * u);
        const lat = u * L / 2;
        // Elevated, broad shelf front: keep the underside well clear of the ground.
        this.addPuff(lat, b * 1.35, fwd, pr * 0.9, 0, 0.45, 0.34);
        this.addPuff(lat, b * 1.8, fwd - D * 0.12, pr * 1.02, 0, 0.62, 0.46);
        this.addPuff(lat + rnd(-pr, pr) * 0.4, b + D * 0.4, fwd - D * rnd(0.3, 0.5), pr * 1.12, 0, rnd(0.8, 0.95), 0.62);
        if (i % 2 === 0) this.addPuff(lat, b + D * 0.78, fwd - D * rnd(0.5, 0.8), pr * 1.35, 0, 0.97, 0.4);
      }
    }
  }
  layout() {
    const gr = this.growth;
    const spin = this.t * (this.o.spin ?? (this.isSuper ? 0.06 : 0.01));
    const cs = Math.cos(spin), sn = Math.sin(spin);
    const lineRot = this.o.kind === 'squall' || this.o.kind === 'derecho' ? Math.atan2(this.dir.x, this.dir.z) : 0;
    const cr = Math.cos(lineRot), sr = Math.sin(lineRot);
    const mature=THREE.MathUtils.clamp((gr-.42)/.58,0,1), matureEase=mature*mature*(3-2*mature);
    const spread=this.isSuper?(this.o.kind==='cumulus'?1.68:1.52):this.o.kind==='cumulus'?1+0.58*matureEase:1;
    const height=this.isSuper?1.42:this.o.kind==='cumulus'?1+0.36*matureEase:1;
    this.puffs.forEach((p, i) => {
      const s = Math.max(0, Math.min(1, (gr - p.stage) / 0.14));
      const bulge = 1 + 0.04 * Math.sin(this.t * 0.8 + i);
      let x = p.x, z = p.z;
      if (lineRot) { const nx = x * cr + z * sr, nz = -x * sr + z * cr; x = nx; z = nz; }
      else { const nx = x * cs - z * sn, nz = x * sn + z * cs; x = nx; z = nz; }
      // Preserve a raised base while scaling the cloud vertically; flattened canopy puffs form the anvil.
      const rawY = Math.max(p.y, p.r * s * p.fy * 1.18 * bulge + 80);
      const puffY=this.base+(rawY-this.base)*height;
      _p.set(x * 1.12 * spread, puffY, z * 1.12 * spread); _s.set(p.r * s * 1.62 * bulge * spread, p.r * s * p.fy * 1.18 * bulge * height, p.r * s * 1.62 * bulge * spread);
      _m.compose(_p, _q.identity(), _s); this.mesh.setMatrixAt(i, _m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  audioMix() {
    const fade=Math.min(1,Math.max(0,(this.o.life-this.t)/3)), wet=Math.min(1,this.o.rain*.48)*this.growth*fade;
    return {wind:Math.max((this.o.wind??0)/165,wet*.35)*this.growth*fade,rain:wet,hail:Math.min(1,this.o.hail/5)*this.growth*fade};
  }
  windAt(pos: THREE.Vector3) {
    const { wind = 0, length = 1, depth = 1, bow = 0 } = this.o;
    if (wind <= 0 || this.t >= this.o.life) return null;
    const scale = this.o.kind === 'squall' || this.o.kind === 'derecho' ? GUST_FRONT_SCALE : 1;
    const frontLength = length * scale, frontDepth = depth * scale;
    const rel = V(pos.x - this.mesh.position.x, 0, pos.z - this.mesh.position.z);
    const cross = rel.dot(this.side) / (frontLength / 2);
    const along = rel.dot(this.dir) - bow * frontDepth * (1 - cross * cross);
    if (Math.abs(cross) >= 1 || along > frontDepth * 0.35 || along < -frontDepth * 0.75) return null;
    const acrossFalloff = 1 - Math.abs(cross) * 0.24;
    const frontFalloff = Math.max(0, 1 - Math.abs(along) / (frontDepth * 0.85));
    return this.dir.clone().multiplyScalar(wind * 0.44704 * acrossFalloff * (0.35 + frontFalloff * 0.65));
  }
  /** random rain point in world space under the cloud */
  rainPoint(out: THREE.Vector3) {
    const c=this.mesh.position,seq=++this.rainSeq;
    const u=(seq*.6180339887498949+this.rainSeed)%1,v=(seq*.7548776662466927+this.rainSeed*.371)%1;
    if(this.o.kind==='squall'||this.o.kind==='derecho'){
      const cross=u*2-1,fwd=(this.o.bow??0)*this.o.depth!*(1-cross*cross)-this.o.depth!*(.05+v*.55);
      return out.set(c.x,0,c.z).addScaledVector(this.side,cross*this.o.length!/2).addScaledVector(this.dir,fwd);
    }
    const a=u*6.28318530718,r=Math.sqrt(v)*this.rainRadius();
    return out.set(c.x+Math.cos(a)*r,0,c.z+Math.sin(a)*r);
  }
  rainRadius() {
    // Cell clouds have a broad, low underbase extending beyond their nominal R;
    // the old generic 0.5R rain disk left much of that visible footprint dry.
    // Match the actual puff footprint without increasing the particle budget.
    const factor = this.o.kind === 'cell' ? 1.3 : this.o.kind === 'nimbo' ? 0.85 : (this.o.kind === 'cumulus' || this.isSuper) ? 0.75 : 0.5;
    return this.R * factor;
  }
  inRain(p: THREE.Vector3) {
    const c = this.mesh.position;
    if (this.o.kind === 'squall' || this.o.kind === 'derecho') {
      const rel = V(p.x - c.x, 0, p.z - c.z); const u = rel.dot(this.side) / (this.o.length! / 2); if (Math.abs(u) > 1) return false;
      const f = rel.dot(this.dir) - (this.o.bow ?? 0) * this.o.depth! * (1 - u * u); return f < 0 && f > -this.o.depth! * 0.65;
    }
    const damageRadius = this.rainRadius() * (this.o.kind === 'nimbo' ? 1 : 1.1);
    return Math.hypot(p.x - c.x, p.z - c.z) < damageRadius;
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
    // Cloud silhouettes do not need per-frame matrix uploads; 24 Hz keeps growth fluid and cheaper.
    this.layoutT += dt;
    if (this.layoutT >= 1 / 24) { this.layoutT %= 1 / 24; this.layout(); }
    const rainOn = o.kind === 'cumulus' ? (this.growth > 0.55 ? (this.growth - 0.5) * 2 * o.rain + (this.growth > 0.55 ? 0.25 : 0) : 0) : o.rain * Math.min(1, this.growth * 1.5);
    const dens = g.settings.particles;
    if (rainOn > 0 && fadeK > 0) {
      // rainshafts: white smoke with fluid (curl + ground outflow) behaviour
      this.shaftAcc+=dt*Math.min(1800,rainOn*(this.R/40)*3*dens*60);
      const shafts=Math.min(Math.min(60,Math.max(1,Math.ceil(30*dt*60))),Math.floor(this.shaftAcc));this.shaftAcc-=shafts;if(this.shaftAcc>30)this.shaftAcc%=1;
      const rp = V();
      const dropSourceY = o.kind === 'cell' ? this.base * 1.2 : this.base * 0.6;
      for (let i = 0; i < shafts; i++) {
        this.rainPoint(rp); const vy = -(o.kind === 'squall' || o.kind === 'derecho' ? rnd(34, 48) : rnd(14, 24)) * (0.8 + rainOn * 0.4);
        // Cell rain used to originate inside its opaque underbase and was depth-occluded.
        // Lift the emitter above the cloud underside so each column visibly joins the base.
        const h = o.kind === 'cell' ? this.base * 1.2 + rnd(3, 8) : this.base * rnd(0.55, 0.95), localWind = g.windAt(rp);
        const wx = localWind.x + o.vel.x * 0.2, wz = localWind.z + o.vel.z * 0.2;
        g.smoke.spawn(rp.x, h, rp.z, wx + rnd(-2, 2), vy, wz + rnd(-2, 2), o.rainColor ?? 0xd9dee6, Math.min(135, this.R * (o.kind === 'squall' || o.kind === 'derecho' ? rnd(0.18, 0.28) : rnd(0.12, 0.22))), h / -vy + rnd(1.5, 3),
          { turb: 5, spread: 0.55, drag: 0.04, grow: 1.4, alpha: (o.kind === 'squall' || o.kind === 'derecho' ? 0.2 : 0.1) + 0.12 * Math.min(1, rainOn), ox: rp.x + rnd(-3, 3), oz: rp.z + rnd(-3, 3), windX: wx, windZ: wz, windResponse: 1.15, windDynamic: true });
      }
      this.dropAcc+=dt*Math.min(3600,rainOn*this.R*.3*dens*60);
      const drops=Math.min(Math.min(120,Math.max(1,Math.ceil(60*dt*60))),Math.floor(this.dropAcc));this.dropAcc-=drops;if(this.dropAcc>60)this.dropAcc%=1;
      for (let i = 0; i < drops; i++) { this.rainPoint(rp); const w = g.windAt(rp); const wx = w.x + o.vel.x * 0.15, wz = w.z + o.vel.z * 0.15;
        g.smoke.spawn(rp.x, dropSourceY, rp.z, wx, -60, wz, 0xbcd4ff, 0.35, dropSourceY / 60, { alpha: 0.7, windX: wx, windZ: wz, windResponse: 2.1, windDynamic: true }); }
      // rain damage every 0.05s
      this.rainTick += dt;
      while (this.rainTick >= 0.05) {
        this.rainTick -= 0.05;
        if (o.rainDmg > 0) for (const e of g.enemies) if (!e.dead && this.inRain(e.pos)) g.damage(e, o.rainDmg * (o.dmgMul ?? 1), { noCharge: true, source: 'rain' });
      }
    }
    // wind / gust front
    if (o.wind && fadeK > 0) {
      const c = this.mesh.position, scale = o.kind === 'squall' || o.kind === 'derecho' ? GUST_FRONT_SCALE : 1;
      const frontLength = o.length! * scale, frontDepth = o.depth! * scale, push = o.wind * 0.44704;
      if (scale > 1 && !this.gustSounded && this.growth > 0.18) { this.gustSounded = true; g.audio.gustFront(this.mesh.position.distanceTo(g.player.pos), o.wind / 100); }
      for (const e of g.enemies) {
        if (e.dead) continue; const rel = V(e.pos.x - c.x, 0, e.pos.z - c.z); const u = rel.dot(this.side) / (frontLength / 2);
        if (Math.abs(u) > 1) continue; const f = rel.dot(this.dir) - (o.bow ?? 0) * frontDepth * (1 - u * u);
        if (f > -frontDepth * 0.3 && f < frontDepth * 0.25) { e.pos.addScaledVector(this.dir, push * 0.12 * dt); if (Math.random() < dt * 4) g.damage(e, (o.windDmg ?? 0) * (o.dmgMul ?? 1), { noCharge: true, stun: 0.2 }); }
      }
      const pr = V(g.player.pos.x - c.x, 0, g.player.pos.z - c.z); const pu = pr.dot(this.side) / (frontLength / 2); const pf = pr.dot(this.dir) - (o.bow ?? 0) * frontDepth * (1 - pu * pu);
      if (Math.abs(pu) < 1 && Math.abs(pf) < frontDepth * 0.35) g.shakeRaw(o.wind / 60 * (1 - Math.abs(pf) / (frontDepth * 0.35)), 0.1);
      // Keep the existing capped particle budget; seed it across the enlarged front.
      this.gustAcc+=dt*20*dens*60;const gusts=Math.min(Math.min(60,Math.max(1,Math.ceil(20*dt*60))),Math.floor(this.gustAcc));this.gustAcc-=gusts;if(this.gustAcc>30)this.gustAcc%=1;
      for(let i=0;i<gusts;i++){const seq=++this.gustSeq,u=((seq*.6180339887498949+this.rainSeed*.71)%1)*2-1,v=(seq*.7548776662466927+this.rainSeed*.23)%1;
        const p=V(c.x,0,c.z).addScaledVector(this.side,u*frontLength/2).addScaledVector(this.dir,(o.bow??0)*frontDepth*(1-u*u)+v*20*scale),w=g.windAt(p);
        g.smoke.spawn(p.x,rnd(1,12),p.z,w.x+rnd(-5,5),rnd(0,3),w.z+rnd(-5,5),0xc8c2b8,rnd(8*1.3,18*1.3),2.2,{alpha:.2,grow:1.5,turb:6,drag:.06,windX:w.x,windZ:w.z,windResponse:1.8,windDynamic:true});}
    }
    // lightning
    if (o.bolts > 0 && this.growth > 0.7 && fadeK > 0) {
      this.boltT -= dt;
      if (this.boltT <= 0) {
        this.boltT = rnd(0.2, 2) / o.bolts;
        const isSuper = Math.random() < (o.superChance ?? 0); const mul = isSuper ? (o.superMul ?? 3) : 1;
        const rp = this.rainPoint(V()); rp.x += rnd(-10, 10);
        const top = V(rp.x + rnd(-20, 20), this.base * 5.4, rp.z + rnd(-20, 20));
        const col = isSuper ? (mul >= 12 ? 0xff66ff : 0xaaddff) : 0xcfe0ff;
        for (let k = 0; k < (isSuper ? 3 : 1); k++) g.bolt(top, rp, { color: col, width: isSuper ? (mul >= 12 ? 3.2 : 1.8) : 0.8, life: isSuper ? 0.6 : 0.3, segs: 18, jag: 0.045, branches: isSuper ? 3 : 2 });
        g.audio.thunder(rp.distanceTo(g.player.pos), isSuper ? 1.25 : 0.75);
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
        const rp = this.rainPoint(V()); const h = this.base * 0.7; const w=g.windAt(rp);
        const vy=rnd(34,50), tt=h/vy, stoneSize=rnd(.24,.56)*(o.kind==='hail'?1.15:1);
        g.hail.spawn(rp.x,h,rp.z,w.x,-vy,w.z,stoneSize,tt+.12);
        const dmg = (o.hailDmg ?? 8000) * (o.dmgMul ?? 1), sh = o.hailShatter ?? 0.6, shd = o.hailShatterDmg ?? 0.4;
        g.after(tt, () => {
          g.audio.hailImpact(rp.distanceTo(g.player.pos));
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

/** Tornado: dense helical condensation funnel, turbulent dust, and realistic suction. */
export class Tornado implements Effect {
  t = 0; ps: ParticleSystem; cone: THREE.Mesh; cloudPuffs: THREE.InstancedMesh; pos = V(); wander = V(); ang: Float32Array; hgt: Float32Array; spd: Float32Array; N: number; puffN: number; puffH: Float32Array; puffPhase: Float32Array; puffSize: Float32Array; dmgT = 0; dustAcc = 0; dustSeq = 0;
  constructor(public g: any, public cloud: StormCloud | null, public baseR: number, public mph: number, public life: number, fixed?: THREE.Vector3, public dmg = 2500) {
    this.N = Math.round(540 * g.settings.particles) + 100;
    this.ps = new ParticleSystem(this.N, false); g.scene.add(this.ps.points);
    this.ps.mat.uniforms.uScale.value = g.smoke.mat.uniforms.uScale.value;
    this.ang = new Float32Array(this.N); this.hgt = new Float32Array(this.N); this.spd = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) { this.ang[i] = Math.random() * 6.28; this.hgt[i] = Math.random(); this.spd[i] = rnd(0.6, 1.2);
      const c = rnd(0.45, 0.75); this.ps.col[i * 3] = c; this.ps.col[i * 3 + 1] = c * 0.97; this.ps.col[i * 3 + 2] = c * 0.93; this.ps.life[i] = 1e9; this.ps.maxLife[i] = 1e9; }
    this.puffN=Math.max(96,Math.round(150*g.settings.clouds)); this.puffH=new Float32Array(this.puffN);this.puffPhase=new Float32Array(this.puffN);this.puffSize=new Float32Array(this.puffN);
    const puffMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,transparent:true,opacity:.3,depthWrite:false,emissive:0x111315});
    this.cloudPuffs=new THREE.InstancedMesh(PUFF_GEO,puffMat,this.puffN);this.cloudPuffs.frustumCulled=false;this.cloudPuffs.castShadow=false;
    for(let i=0;i<this.puffN;i++){const strand=i%4,step=Math.floor(i/4),steps=Math.ceil(this.puffN/4);
      this.puffH[i]=Math.min(1,(step+rnd(-.25,.25))/Math.max(1,steps-1));this.puffPhase[i]=strand*Math.PI*.5+rnd(-.18,.18);this.puffSize[i]=baseR*rnd(.48,.78);
      const shade=rnd(.52,.76);this.cloudPuffs.setColorAt(i,_c.setRGB(shade,shade*1.015,shade*1.04));}
    this.cloudPuffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);if(this.cloudPuffs.instanceColor)this.cloudPuffs.instanceColor.needsUpdate=true;g.scene.add(this.cloudPuffs);
    this.cone = new THREE.Mesh(new THREE.CylinderGeometry(1,0.12,1,40,10,true).translate(0,0.5,0), new THREE.MeshStandardMaterial({ color:0x777a80, transparent:true, opacity:0.16, side:THREE.DoubleSide, depthWrite:false, roughness:1 }));
    g.scene.add(this.cone);
    if (cloud) { const a = Math.random() * 6.28; this.pos.set(cloud.mesh.position.x + Math.cos(a) * cloud.R * 0.1, 0, cloud.mesh.position.z + Math.sin(a) * cloud.R * 0.1); }
    else if (fixed) this.pos.copy(fixed);
  }
  audioMix(){const k=Math.min(1,this.t/1.5)*Math.min(1,(this.life-this.t)/1.5);return {wind:Math.min(1,this.mph/220)*.68*k,rain:.18*k,hail:0};}
  update(dt: number) {
    const g = this.g; this.t += dt;
    const H = this.cloud ? Math.max(120,this.cloud.base*1.08) : 180;
    if (this.cloud) { const cp = this.cloud.mesh.position; this.wander.x += (cp.x - this.pos.x) * 0.02 + rnd(-2, 2); this.wander.z += (cp.z - this.pos.z) * 0.02 + rnd(-2, 2); this.wander.multiplyScalar(0.95); this.pos.addScaledVector(this.wander, dt); this.pos.addScaledVector(this.cloud.o.vel, dt); }
    const k = Math.min(1, this.t / 1.5) * Math.min(1, (this.life - this.t) / 1.5);
    const topR = this.baseR * 4.5, w = this.mph * 0.447; // tangential m/s
    this.cloudPuffs.position.copy(this.pos);(this.cloudPuffs.material as THREE.MeshStandardMaterial).opacity=.32*k;
    for(let i=0;i<this.puffN;i++){const h=this.puffH[i],r=this.baseR*(.58+3.85*h*h)*(1+.035*Math.sin(this.t*2+i));
      const a=this.puffPhase[i]+h*Math.PI*10+this.t*(4.5-h*2.6),size=this.puffSize[i]*(.82+.25*h);
      _p.set(Math.cos(a)*r,Math.max(size*.82,h*H),Math.sin(a)*r);_s.set(size*(1+.12*Math.sin(i*3.1)),size*.9,size*(1+.12*Math.cos(i*2.7)));
      _m.compose(_p,_q.identity(),_s);this.cloudPuffs.setMatrixAt(i,_m);}
    this.cloudPuffs.instanceMatrix.needsUpdate=true;
    for (let i = 0; i < this.N; i++) {
      const h = this.hgt[i]; const r = (this.baseR + (topR - this.baseR) * h * h) * (0.8 + 0.4 * Math.sin(i));
      this.ang[i] += (w / Math.max(3, r)) * this.spd[i] * dt;
      this.hgt[i] += dt * 0.12 * this.spd[i]; if (this.hgt[i] > 1) this.hgt[i] = 0;
      const i3 = i * 3;
      this.ps.pos[i3] = this.pos.x + Math.cos(this.ang[i]) * r; this.ps.pos[i3 + 1] = h * H; this.ps.pos[i3 + 2] = this.pos.z + Math.sin(this.ang[i]) * r;
      this.ps.size[i] = (this.baseR * 0.75 + h * this.baseR * 2.5) * k; this.ps.alpha[i] = 0.26 * k * (h < 0.08 ? 1.35 : 1);
    }
    ['position', 'aColor', 'aSize', 'aAlpha'].forEach(n => (this.ps.geo.attributes[n] as THREE.BufferAttribute).needsUpdate = true);
    this.cone.position.copy(this.pos); this.cone.scale.set(topR * 0.72 * k, H, topR * 0.72 * k); this.cone.rotation.y += dt * 2.4;
    // A bounded, wind-advected dust skirt makes the ground contact read as a real debris cloud.
    this.dustAcc += dt * 42 * Math.max(0.25, g.settings.particles);
    const dustCount = Math.min(3, Math.floor(this.dustAcc)); this.dustAcc -= dustCount;
    for (let i = 0; i < dustCount; i++) {
      const seq = ++this.dustSeq, a = (seq * 2.399963229728653) % 6.28318530718;
      const radius = this.baseR * (1.15 + ((seq * 0.61803398875) % 1) * 2.5);
      const x = this.pos.x + Math.cos(a) * radius, z = this.pos.z + Math.sin(a) * radius;
      const wind = g.windAt(V(x, 1, z));
      const swirl = this.mph * 0.44704 * 0.16;
      g.smoke.spawn(x, rnd(0.6, 3.5), z,
        wind.x - Math.sin(a) * swirl + rnd(-3, 3), rnd(2, 8),
        wind.z + Math.cos(a) * swirl + rnd(-3, 3), 0x786a55, rnd(5, 11), rnd(2.2, 4),
        { alpha: 0.3 * k, spread: 1.45, grow: 1.35, drag: 0.12, groundDrag: 0.55, turb: 5,
          ox: this.pos.x, oz: this.pos.z, windX: wind.x, windZ: wind.z, windResponse: 1.45, windDynamic: true, densityManaged: true });
    }
    // A broader, wind-driven debris ring anchors the funnel to the ground.
    if (Math.random() < 0.8) { const a = Math.random() * 6.28, wv=g.windAt(this.pos);
      g.debris.spawn(this.pos.x + Math.cos(a) * this.baseR * rnd(1.4,2.4), 1, this.pos.z + Math.sin(a) * this.baseR * rnd(1.4,2.4), wv.x+rnd(-4,4), rnd(8,24), wv.z+rnd(-4,4), rnd(0.2,0.65), 0x655a4c, 2.8); }
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
  dispose() { this.g.scene.remove(this.ps.points, this.cone, this.cloudPuffs); this.ps.geo.dispose(); this.ps.mat.dispose(); (this.cloudPuffs.material as THREE.Material).dispose(); this.cone.geometry.dispose(); (this.cone.material as THREE.Material).dispose(); }
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

/** 25 km hurricane with a calm eye, towering eyewall, spiral bands, rain-wall mist & outward wind. */
export class Hurricane implements Effect {
  t = 0; grp = new THREE.Group(); disk: THREE.Mesh; disk2: THREE.Mesh; wall: THREE.InstancedMesh; tex: THREE.Texture; pos: THREE.Vector3; dir: THREE.Vector3; dmgT = 0; mistSeq=0; localSeq=0; mistSeed=Math.random();
  eye = 320; wallR = 2600; R = 12500;
  constructor(public g: any, at: THREE.Vector3, dir: THREE.Vector3, public life = 300, public dmg = 4000) {
    this.pos = at.clone().setY(0); this.dir = dir.clone().setY(0).normalize();
    this.tex = spiralTexture();
    const mk = (y: number, s: number, op: number) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide })); m.position.y = y; m.scale.setScalar(s); return m; };
    this.disk = mk(1800, this.R * 2, 0.95); this.disk2 = mk(700, this.R * 1.1, 0.6);
    const n = Math.round(90 * g.settings.clouds) + 20;
    this.wall = new THREE.InstancedMesh(PUFF_GEO, new THREE.MeshStandardMaterial({ color: 0xcfd4dc, roughness: 1, transparent: true, opacity: 0.9, emissive: 0x15181e }), n);
    for (let i = 0; i < n; i++) { const a = (i / n) * 6.28 * 2; const r = this.eye + rnd(80, 700) + (i % 3) * 400;
      const sy = rnd(280,600) * 1.2, y = Math.max(rnd(600,3200), sy + 220);
      _p.set(Math.cos(a) * r, y, Math.sin(a) * r); _s.set(rnd(240,520) * 1.65, sy, rnd(240,520) * 1.65); _m.compose(_p, _q.identity(), _s); this.wall.setMatrixAt(i, _m); }
    this.wall.frustumCulled = false;
    this.grp.add(this.disk, this.disk2, this.wall); this.grp.position.copy(this.pos); g.scene.add(this.grp);
  }
  audioMix() { const k=Math.min(1,this.t/4)*Math.min(1,(this.life-this.t)/5); return {wind:.9*k,rain:.72*k,hail:0}; }
  windAt(at: THREE.Vector3) {
    const dx = at.x - this.pos.x, dz = at.z - this.pos.z, dist = Math.hypot(dx, dz);
    if (dist < this.eye * 0.6 || dist > this.R) return null;
    const strength = dist <= this.wallR ? 1 : Math.max(0, 1 - (dist - this.wallR) / (this.R - this.wallR));
    const speed = 165 * 0.44704 * strength;
    return V(-dz / Math.max(1, dist) * speed + dx / Math.max(1, dist) * speed * 0.14, 0,
      dx / Math.max(1, dist) * speed + dz / Math.max(1, dist) * speed * 0.14);
  }
  update(dt: number) {
    const g = this.g; this.t += dt; const k = Math.min(1, this.t / 4) * Math.min(1, (this.life - this.t) / 5);
    this.pos.addScaledVector(this.dir, 15 * dt); this.grp.position.copy(this.pos);
    this.disk.rotation.y -= dt * 0.03; this.disk2.rotation.y -= dt * 0.05; this.wall.rotation.y -= dt * 0.12;
    (this.disk.material as THREE.MeshBasicMaterial).opacity = 0.95 * k; (this.disk2.material as THREE.MeshBasicMaterial).opacity = 0.6 * k; (this.wall.material as THREE.MeshStandardMaterial).opacity = 0.9 * k;
    const dens = g.settings.particles;
    // Eyewall rain mist samples the local swirl so particle advection changes around the vortex.
    for (let i = 0; i < 60 * dens; i++) { const seq=++this.mistSeq,u=(seq*.6180339887498949+this.mistSeed)%1,v=(seq*.7548776662466927+this.mistSeed*.37)%1;
      const a=u*6.28318530718,r=Math.sqrt(this.eye*this.eye+v*(this.wallR*this.wallR-this.eye*this.eye));
      const x=this.pos.x+Math.cos(a)*r, y=8+((seq*.38196601125+this.mistSeed*.13)%1)*172, z=this.pos.z+Math.sin(a)*r, localWind=g.windAt(V(x,y,z));
      g.smoke.spawn(x, y, z, localWind.x+rnd(-8,8), rnd(-24,-7), localWind.z+rnd(-8,8), 0xe6e9ee, rnd(28,68), rnd(2,3.2), { alpha:0.32*k, grow:1.2, turb:10, spread:0.3, windX:localWind.x, windZ:localWind.z, windResponse:2.2, windDynamic:true }); }
    // mist around player if inside rain bands
    const pp = g.player.pos; const pd = Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z);
    if (pd > this.eye && pd < this.R) { const inten = pd < this.wallR ? 1 : Math.max(0.15, 1 - (pd - this.wallR) / 4000);
      for (let i = 0; i < 36 * dens * inten; i++) { const seq=++this.localSeq,u=(seq*.6180339887498949+this.mistSeed*.53)%1,v=(seq*.7548776662466927+this.mistSeed*.19)%1;
        const x=pp.x+(u-.5)*200,y=3+((seq*.38196601125+this.mistSeed*.41)%1)*62,z=pp.z+(v-.5)*200,localWind=g.windAt(V(x,y,z));
        g.smoke.spawn(x,y,z,localWind.x+rnd(-4,4),-18,localWind.z+rnd(-4,4),0xdfe3ea,rnd(10,28),2,{alpha:0.24,grow:1,turb:8,windX:localWind.x,windZ:localWind.z,windResponse:1.8,windDynamic:true}); }
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

/** Microburst: scattered cells merge into a downdraft-fed cold pool whose pressure field drives surface outflow. */
export class Microburst implements Effect {
  t = 0; cells: StormCloud[] = []; offs: THREE.Vector3[] = []; dmgT = 0; gustSounded = false; dustSeq=0; dustSeed=Math.random(); particleAcc=0;
  private readonly flow: MicroburstFlow;
  private readonly windSample = V();
  constructor(public g: any, public pos: THREE.Vector3, public size = 150, public dmg = 3500) {
    const cloudSize = size * 0.7; // keep the source cloud compact; the outflow can travel well beyond its edge.
    // Keep the low-resolution grid focused on the physically relevant 0.9 km outflow domain;
    // spreading the same 64 cells over several kilometres under-resolves the cold-pool gradient.
    this.flow = new MicroburstFlow(size * 6, size);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28 + rnd(-0.3, 0.3); const off = V(Math.cos(a) * cloudSize * 0.78, 0, Math.sin(a) * cloudSize * 0.78); this.offs.push(off);
      const c = new StormCloud(g, { pos: pos.clone().add(off), kind: 'cell', size: cloudSize * 1.05, life: 16, grow: 2.2, densityScale: 2.5, rain: 0, shade: 0.85 }); this.cells.push(c); g.add(c); }
    // A slow-growing central tower fills the join as the six cells merge, so the burst
    // never leaves a hollow center for its falling mist to appear detached from.
    const core = new StormCloud(g, { pos: pos.clone(), kind: 'cell', size: cloudSize * 1.8, life: 16, grow: 3, densityScale: 3, rain: 0, shade: 0.9 });
    this.cells.push(core); this.offs.push(V()); g.add(core);
  }
  audioMix() { const k=this.t>5&&this.t<15?Math.min(1,(this.t-5)/.5)*Math.min(1,(15-this.t)/1):0; return {wind:.8*k,rain:.22*k,hail:0}; }
  windAt(at: THREE.Vector3) {
    if (this.t < 5 || this.t > 15) return null;
    return this.flow.sample(at.x - this.pos.x, at.z - this.pos.z, at.y, this.windSample) ? this.windSample : null;
  }
  update(dt: number) {
    const g = this.g; this.t += dt;
    const mergeRaw = Math.min(1, Math.max(0, (this.t - 1.5) / 2));
    const merge = mergeRaw * mergeRaw * (3 - 2 * mergeRaw);
    this.cells.forEach((c, i) => { c.mesh.position.set(this.pos.x + this.offs[i].x * (1 - merge), 0, this.pos.z + this.offs[i].z * (1 - merge)); });
    if (this.t > 5 && this.t < 15) {
      this.flow.update(dt, this.t - 5);
      if (!this.gustSounded) { this.gustSounded = true; g.audio.gustFront(this.pos.distanceTo(g.player.pos), 1.15); }
      const k = Math.min(1, (this.t - 5) / 0.5), source = this.cells[this.cells.length - 1], emitter = source.mesh.position;
      // Seed soft smoke throughout the cloud-to-ground volume; the simulated boundary-layer
      // field takes over as particles descend and skim outward across the surface.
      const topY = source.base + source.R * 0.5, emissionR = source.R * 1.05;
      const density = Math.max(0, Math.min(1, g.settings.particles));
      this.particleAcc += dt * 1850 * density;
      const count = Math.floor(this.particleAcc); this.particleAcc -= count;
      for (let i = 0; i < count; i++) { const seq=++this.dustSeq,u=(seq*.6180339887498949+this.dustSeed)%1,v=(seq*.7548776662466927+this.dustSeed*.29)%1,w=(seq*.5698402909980532+this.dustSeed*.63)%1;
        const a=u*6.28318530718,r=Math.sqrt(v)*emissionR,x=emitter.x+Math.cos(a)*r,z=emitter.z+Math.sin(a)*r,y=topY*(.08+.92*w),localWind=g.windAt(V(x,y,z));
        // Give the source a vertical downdraft; horizontal spread is produced by the evolving
        // cold-pool pressure field instead of baking an expanding radial kick into each mote.
        g.smoke.spawn(x,y,z,localWind.x+rnd(-2,2),-rnd(20,36),localWind.z+rnd(-2,2),0xe1e6eb,rnd(20,36),2,{alpha:0.32*k,grav:9.8,spread:0,drag:0.06,groundDrag:1.05,grow:1.7,turb:3,ox:emitter.x,oz:emitter.z,windX:localWind.x,windZ:localWind.z,windResponse:2.3,windDynamic:true,densityManaged:true}); }
      const dp = Math.hypot(g.player.pos.x - this.pos.x, g.player.pos.z - this.pos.z); if (dp < this.size * 1.5) g.shakeRaw(4 * (1 - dp / (this.size * 1.5)) + 0.5, 0.1);
      const playerWind = this.windAt(g.player.pos);
      if (playerWind) {
        // Wind load scales with the sampled air speed; stronger ground friction restrains the
        // player, while the shared velocity field can still push them several metres per second.
        const relativeX = playerWind.x - g.player.vel.x, relativeZ = playerWind.z - g.player.vel.z;
        const relativeSpeed = Math.hypot(relativeX, relativeZ);
        const coupling = Math.min(1.4, relativeSpeed * 0.05) * (g.player.grounded ? 1 : 0.25);
        g.player.vel.x += relativeX * dt * coupling;
        g.player.vel.z += relativeZ * dt * coupling;
        const horizontalSpeedSq = g.player.vel.x * g.player.vel.x + g.player.vel.z * g.player.vel.z;
        if (horizontalSpeedSq > 12 * 12) { const scale = 12 / Math.sqrt(horizontalSpeedSq); g.player.vel.x *= scale; g.player.vel.z *= scale; }
      }
      this.dmgT += dt; const tick = this.dmgT > 0.2; if (tick) this.dmgT = 0;
      for (const e of g.enemies) {
        if (e.dead) continue;
        const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d >= 1 && d < this.size * 6) {
          // Wind loads horizontal velocity; enemy mass and the ground-contact drag in Enemy.update
          // determine how far the gust can actually carry each body.
          const gust = this.windAt(e.pos);
          if (gust) {
            const mass = e.kind === 'boss' ? 4.2 : e.kind === 'brute' ? 3 : e.kind === 'elite' ? 1.7 : e.kind === 'runner' ? 0.8 : 1;
            const relativeX = gust.x - e.vel.x, relativeZ = gust.z - e.vel.z;
            const relativeSpeed = Math.hypot(relativeX, relativeZ);
            const dragResponse = Math.min(1.5, relativeSpeed * 0.075) / mass;
            e.vel.x += relativeX * dt * dragResponse;
            e.vel.z += relativeZ * dt * dragResponse;
            const maxSpeed = e.kind === 'boss' ? 10 : e.kind === 'brute' ? 13 : 20;
            const speedSq = e.vel.x * e.vel.x + e.vel.z * e.vel.z;
            if (speedSq > maxSpeed * maxSpeed) { const scale = maxSpeed / Math.sqrt(speedSq); e.vel.x *= scale; e.vel.z *= scale; }
          }
          if (d < this.size && tick) g.damage(e, this.dmg, { noCharge: true, stun: 0.3 });
        }
      }
    }
    return this.t < 16;
  }
  dispose() {}
}

export { addMat };

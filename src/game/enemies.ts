import * as THREE from 'three';
import { GEO, rnd, V } from './effects';

export type EnemyKind = 'normal' | 'elite' | 'boss';

const G = {
  torso: new THREE.CapsuleGeometry(0.5, 0.9, 8, 14),
  chest: new THREE.BoxGeometry(0.86, 0.72, 0.62),
  shoulder: new THREE.SphereGeometry(0.26, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.65),
  armUpper: new THREE.CapsuleGeometry(0.13, 0.34, 6, 12),
  armFore: new THREE.CapsuleGeometry(0.15, 0.36, 6, 12),
  claw: new THREE.ConeGeometry(0.1, 0.34, 6),
  thigh: new THREE.CapsuleGeometry(0.18, 0.36, 6, 12),
  shin: new THREE.CapsuleGeometry(0.13, 0.34, 6, 12),
  head: new THREE.SphereGeometry(0.34, 18, 14),
  jaw: new THREE.BoxGeometry(0.42, 0.16, 0.4),
  eye: new THREE.SphereGeometry(0.075, 8, 8),
  horn: new THREE.ConeGeometry(0.12, 0.5, 6),
  spike: new THREE.ConeGeometry(0.09, 0.42, 5),
  crest: new THREE.BoxGeometry(0.1, 0.5, 0.34),
  core: new THREE.SphereGeometry(0.16, 12, 10),
  plate: new THREE.BoxGeometry(0.34, 0.26, 0.1),
  bar: new THREE.PlaneGeometry(1.6, 0.16),
  cage: new THREE.EdgesGeometry(new THREE.CylinderGeometry(1, 1, 1, 8, 3)),
  ice: new THREE.IcosahedronGeometry(1, 0),
  star: new THREE.TorusGeometry(0.5, 0.05, 4, 16),
};
const M = {
  eye: new THREE.MeshBasicMaterial({ color: 0xff3344 }),
  barBg: new THREE.MeshBasicMaterial({ color: 0x100a14, transparent: true, opacity: 0.8, depthWrite: false }),
  cage: new THREE.LineBasicMaterial({ color: 0xff2030, transparent: true, opacity: 0.95 }),
  ice: new THREE.MeshStandardMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.2, emissive: 0x114466 }),
  star: new THREE.MeshBasicMaterial({ color: 0xffee55 }),
  horn: new THREE.MeshStandardMaterial({ color: 0x1a1a1e, metalness: 0.85, roughness: 0.3 }),
  crown: new THREE.MeshStandardMaterial({ color: 0xffc830, metalness: 1, roughness: 0.25, emissive: 0x442200 }),
  armor: new THREE.MeshStandardMaterial({ color: 0x39424f, metalness: 0.85, roughness: 0.35 }),
  claw: new THREE.MeshStandardMaterial({ color: 0xd8dde6, metalness: 0.9, roughness: 0.2 }),
  coreRed: new THREE.MeshStandardMaterial({ color: 0x3a0a10, emissive: 0xff2a3a, emissiveIntensity: 1.7, metalness: 0.6, roughness: 0.3 }),
  coreViolet: new THREE.MeshStandardMaterial({ color: 0x220a3a, emissive: 0xb060ff, emissiveIntensity: 1.7, metalness: 0.6, roughness: 0.3 }),
  coreTeal: new THREE.MeshStandardMaterial({ color: 0x06222a, emissive: 0x2fe0d0, emissiveIntensity: 1.5, metalness: 0.6, roughness: 0.3 }),
};

export class Enemy {
  kind: EnemyKind; maxHp: number; hp: number; pos = V(); vel = V(); radius: number; height: number; speed: number; scale: number;
  mesh = new THREE.Group(); bodyMat: THREE.MeshStandardMaterial; bar: THREE.Mesh; barGrp = new THREE.Group();
  stun = 0; freeze = 0; imprison = 0; blind = 0; flee = 0; hacked = 0; lift = 0; burn = 0; burnDps = 0; burnTick = 0;
  bleeds: { t: number; dps: number }[] = []; bleedTick = 0; attackCd = 1; wander = V(); wanderT = 0;
  dead = false; deadT = 0; cage: THREE.LineSegments; ice: THREE.Mesh; star: THREE.Mesh; airborne = false; id: number; lastHit = 0;
  static nextId = 1;
  constructor(public g: any, kind: EnemyKind) {
    this.id = Enemy.nextId++;
    this.kind = kind;
    this.scale = kind === 'boss' ? 3.2 : kind === 'elite' ? 1.6 : 1;
    this.maxHp = kind === 'boss' ? 2.5e6 : kind === 'elite' ? 1.5e5 : 12000;
    this.hp = this.maxHp; this.radius = 0.85 * this.scale; this.height = 2.55 * this.scale;
    this.speed = kind === 'boss' ? 5 : kind === 'elite' ? 6.5 : 7.5;
    const col = kind === 'boss' ? 0x7a1020 : kind === 'elite' ? 0x5a2a9a : 0x2f4f5f;
    this.bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.35, emissive: 0x000000 });
    const inner = new THREE.Group();
    const armor = kind === 'normal' ? M.armor : this.bodyMat;
    const coreMat = kind === 'boss' ? M.coreRed : kind === 'elite' ? M.coreViolet : M.coreTeal;
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = inner) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
    };

    // legs: thigh, shin, clawed foot
    for (const sgn of [-1, 1]) {
      const thigh = mk(G.thigh, armor, sgn * 0.26, 0.85, 0);
      const shin = mk(G.shin, this.bodyMat, sgn * 0.28, 0.42, 0.04);
      const foot = mk(G.claw, M.claw, sgn * 0.3, 0.12, 0.2); foot.rotation.x = Math.PI * 0.62;
      void thigh; void shin;
    }
    // torso: broad chest over a segmented abdomen, with an exposed glowing core
    const abd = mk(G.torso, this.bodyMat, 0, 1.18, 0); abd.scale.set(0.86, 0.78, 0.72);
    const chest = mk(G.chest, armor, 0, 1.6, 0); chest.scale.set(1.06, 1, 0.86);
    const core = mk(G.core, coreMat, 0, 1.58, 0.3);
    for (const sgn of [-1, 1]) mk(G.plate, armor, sgn * 0.3, 1.42, 0.26);
    // shoulders + arms: pauldron, upper arm, forearm, three claws
    for (const sgn of [-1, 1]) {
      const arm = new THREE.Group(); arm.position.set(sgn * 0.56, 1.72, 0); inner.add(arm);
      const pauld = mk(G.shoulder, armor, 0, 0.02, 0, arm); pauld.rotation.z = -sgn * 0.35;
      mk(G.armUpper, this.bodyMat, 0, -0.28, 0, arm);
      mk(G.armFore, armor, 0, -0.66, 0.02, arm);
      for (let c = 0; c < 3; c++) {
        const claw = mk(G.claw, M.claw, (c - 1) * 0.08, -0.98, 0.03, arm);
        claw.rotation.x = Math.PI + (c - 1) * 0.16;
      }
    }
    // head: skull, jaw, two eyes; elite/boss get horns and a crest
    const head = mk(G.head, this.bodyMat, 0, 2.16, 0.06); head.scale.set(1, 0.94, 1.06);
    mk(G.jaw, M.horn, 0, 2.0, 0.3);
    for (let i = 0; i < 5; i++) mk(new THREE.ConeGeometry(0.035, 0.12, 4), M.claw, -0.16 + i * 0.08, 2.06, 0.44).rotation.x = Math.PI;
    for (const sgn of [-1, 1]) {
      const socket = mk(G.eye, M.horn, sgn * 0.15, 2.21, 0.28); socket.scale.set(1.5, 1.3, 1.1);
      const eye = mk(G.eye, M.eye, sgn * 0.15, 2.21, 0.33); eye.scale.setScalar(0.9);
      const brow = mk(G.plate, M.horn, sgn * 0.15, 2.34, 0.3); brow.scale.set(1.2, 0.8, 1.6);
    }
    if (kind !== 'normal') {
      for (const sgn of [-1, 1]) {
        const h = mk(G.horn, M.horn, sgn * 0.26, 2.52, 0.0); h.rotation.z = -sgn * 0.75; h.rotation.x = -0.32; h.scale.set(1.15, 1.9, 1.15);
      }
      const fin = mk(G.crest, M.horn, 0, 2.46, -0.26); fin.rotation.x = -0.7; fin.scale.set(1.4, 1.3, 0.6);
      for (let i = 0; i < 4; i++) {
        const sp = mk(G.spike, M.horn, 0, 1.86 - i * 0.02, -0.34 - i * 0.06);
        sp.rotation.x = -0.5 - i * 0.12;
      }
    }
    if (kind === 'boss') {
      // crown: ring of upright spikes + a glowing gem, so the silhouette reads as royalty
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2, sp2 = mk(G.spike, M.crown, Math.cos(a) * 0.26, 2.62, Math.sin(a) * 0.26 + 0.04);
        sp2.rotation.z = -Math.cos(a) * 0.3; sp2.rotation.x = Math.sin(a) * 0.3; sp2.scale.setScalar(1.5);
      }
      const ring = mk(new THREE.TorusGeometry(0.27, 0.05, 6, 20).rotateX(Math.PI / 2), M.crown, 0, 2.58, 0.04);
      void ring;
      const gem = mk(G.core, M.coreRed, 0, 2.34, 0.36); gem.scale.setScalar(0.9);
      for (const sgn of [-1, 1]) {
        const pauld = mk(G.shoulder, M.crown, sgn * 0.62, 1.62, 0); pauld.scale.setScalar(1.5); pauld.rotation.z = -sgn * 0.4;
      }
    }
    inner.scale.setScalar(this.scale); this.mesh.add(inner);
    const bg = new THREE.Mesh(G.bar, M.barBg);
    this.bar = new THREE.Mesh(G.bar, new THREE.MeshBasicMaterial({ color: kind === 'boss' ? 0xff3040 : kind === 'elite' ? 0xc070ff : 0x30ffb0, depthWrite: false }));
    this.bar.position.z = 0.01; this.barGrp.add(bg, this.bar); this.barGrp.position.y = this.height + 0.6; this.barGrp.scale.setScalar(kind === 'boss' ? 2.5 : kind === 'elite' ? 1.5 : 1);
    this.mesh.add(this.barGrp);
    this.cage = new THREE.LineSegments(G.cage, M.cage); this.cage.scale.set(this.radius * 1.8, this.height * 1.1, this.radius * 1.8); this.cage.position.y = this.height * 0.55; this.cage.visible = false;
    this.ice = new THREE.Mesh(G.ice, M.ice); this.ice.scale.set(this.radius * 1.9, this.height * 0.7, this.radius * 1.9); this.ice.position.y = this.height * 0.5; this.ice.visible = false;
    this.star = new THREE.Mesh(G.star, M.star); this.star.position.y = this.height + 0.2; this.star.rotation.x = Math.PI / 2; this.star.scale.setScalar(this.scale); this.star.visible = false;
    this.mesh.add(this.cage, this.ice, this.star);
    g.scene.add(this.mesh);
    this.respawn();
  }
  respawn() {
    const p = this.g.player.pos; const a = Math.random() * Math.PI * 2; const r = rnd(50, 170);
    this.pos.set(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r);
    this.hp = this.maxHp; this.dead = false; this.vel.set(0, 0, 0);
    this.stun = this.freeze = this.imprison = this.blind = this.flee = this.hacked = this.lift = this.burn = 0; this.bleeds = [];
    this.mesh.visible = true; this.mesh.scale.setScalar(1); this.mesh.position.copy(this.pos);
  }
  get immobile() { return this.stun > 0 || this.freeze > 0 || this.imprison > 0 || this.lift > 0 || this.g.pauseEnemies > 0; }
  update(dt: number) {
    const g = this.g;
    if (this.dead) {
      this.deadT += dt; this.mesh.scale.setScalar(Math.max(0.01, 1 - this.deadT * 1.5)); this.mesh.position.y -= dt * 2;
      if (this.deadT > 2.8) this.respawn();
      return;
    }
    if (g.pauseEnemies > 0) { this.syncVisual(dt); return; }
    const dec = (k: 'stun' | 'freeze' | 'imprison' | 'blind' | 'flee' | 'hacked' | 'lift' | 'burn') => { if (this[k] > 0) this[k] = Math.max(0, this[k] - dt); };
    dec('stun'); dec('freeze'); dec('imprison'); dec('blind'); dec('flee'); dec('hacked'); dec('lift'); dec('burn');
    // DoTs
    if (this.burn > 0) { this.burnTick += dt; if (this.burnTick >= 0.5) { this.burnTick = 0; g.damage(this, this.burnDps * 0.5, { noCharge: true, source: 'dot' }); }
      if (Math.random() < 0.4) g.fx.spawn(this.pos.x + rnd(-0.5, 0.5) * this.scale, this.pos.y + rnd(0.3, this.height), this.pos.z + rnd(-0.5, 0.5) * this.scale, 0, rnd(2, 5), 0, 0xff6a1a, 0.6 * this.scale, 0.5, { turb: 2 }); }
    if (this.bleeds.length) {
      let dps = 0; this.bleeds = this.bleeds.filter(b => (b.t -= dt) > 0); for (const b of this.bleeds) dps += b.dps;
      const iv = Math.max(0.03, 0.5 / Math.max(1, this.bleeds.length)); // more stacks -> super fast ticks
      this.bleedTick += dt; if (this.bleedTick >= iv && dps > 0) { g.damage(this, dps * this.bleedTick, { noCharge: true, source: 'dot' }); this.bleedTick = 0; if (Math.random() < 0.5) g.fx.spawn(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z, rnd(-2, 2), rnd(1, 3), rnd(-2, 2), 0xaa0010, 0.35, 0.5, { grav: 15 }); }
    }
    // movement
    const pp = g.player.pos; const to = V(pp.x - this.pos.x, 0, pp.z - this.pos.z); const dist = to.length(); to.normalize();
    let mv = V();
    if (!this.immobile) {
      if (this.blind > 0) { this.wanderT -= dt; if (this.wanderT <= 0) { this.wanderT = rnd(0.4, 1.2); const a = Math.random() * 6.28; this.wander.set(Math.cos(a), 0, Math.sin(a)); } mv.copy(this.wander); }
      else if (this.flee > 0) mv.copy(to).multiplyScalar(-1.4);
      else if (dist > 2.2 + this.radius) mv.copy(to);
      else {
        this.attackCd -= dt;
        if (this.attackCd <= 0) { this.attackCd = this.kind === 'boss' ? 2 : 1.4; g.enemyAttack(this); }
      }
    }
    if (this.airborne || this.vel.lengthSq() > 0.01) {
      this.pos.addScaledVector(this.vel, dt);
      if (this.pos.y > 0 || this.vel.y > 0) { this.vel.y -= 30 * dt; this.airborne = true; }
      if (this.pos.y <= 0) { this.pos.y = 0; if (this.airborne) { this.airborne = false; g.onEnemyLand?.(this); } this.vel.y = 0; this.vel.x *= 0.8; this.vel.z *= 0.8; }
    }
    if (this.lift > 0) { this.pos.y += (4 - this.pos.y) * Math.min(1, dt * 4); this.airborne = true; }
    this.pos.addScaledVector(mv, this.speed * dt);
    if (mv.lengthSq() > 0) this.mesh.rotation.y = Math.atan2(mv.x, mv.z);
    this.syncVisual(dt);
  }
  syncVisual(dt: number) {
    this.mesh.position.copy(this.pos);
    this.barGrp.quaternion.copy(this.g.camera.quaternion);
    this.barGrp.quaternion.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -this.mesh.rotation.y, 0)));
    const k = Math.max(0, this.hp / this.maxHp); this.bar.scale.x = Math.max(0.001, k); this.bar.position.x = -0.8 * (1 - k);
    this.cage.visible = this.imprison > 0; if (this.cage.visible) this.cage.rotation.y += dt * 2;
    this.ice.visible = this.freeze > 0;
    this.star.visible = this.stun > 0; if (this.star.visible) this.star.rotation.z += dt * 6;
    const em = this.bodyMat.emissive;
    if (this.g.time - this.lastHit < 0.08) em.setHex(0xffffff);
    else if (this.hacked > 0) em.setHex(0x0a5520);
    else if (this.blind > 0) em.setHex(0x2a0a40);
    else if (this.burn > 0) em.setHex(0x551500);
    else em.setHex(0x000000);
  }
}

export { GEO };

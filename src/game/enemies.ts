import * as THREE from 'three';
import { GEO, rnd, V } from './effects';

export type EnemyKind = 'normal' | 'elite' | 'boss';

const G = {
  body: new THREE.CapsuleGeometry(0.55, 1.1, 4, 10),
  head: new THREE.SphereGeometry(0.42, 14, 10),
  eye: new THREE.SphereGeometry(0.08, 6, 6),
  horn: new THREE.ConeGeometry(0.12, 0.5, 6),
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
  horn: new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.3 }),
  crown: new THREE.MeshStandardMaterial({ color: 0xffc830, metalness: 1, roughness: 0.25, emissive: 0x442200 }),
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
    this.hp = this.maxHp; this.radius = 0.7 * this.scale; this.height = 2.2 * this.scale;
    this.speed = kind === 'boss' ? 5 : kind === 'elite' ? 6.5 : 7.5;
    const col = kind === 'boss' ? 0x7a1020 : kind === 'elite' ? 0x5a2a9a : 0x2f4f5f;
    this.bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.35, emissive: 0x000000 });
    const body = new THREE.Mesh(G.body, this.bodyMat); body.position.y = 1.1; body.castShadow = true;
    const head = new THREE.Mesh(G.head, this.bodyMat); head.position.y = 2.05; head.castShadow = true;
    const e1 = new THREE.Mesh(G.eye, M.eye); e1.position.set(0.15, 2.1, 0.36); const e2 = e1.clone(); e2.position.x = -0.15;
    const inner = new THREE.Group(); inner.add(body, head, e1, e2);
    if (kind !== 'normal') { const h1 = new THREE.Mesh(G.horn, M.horn); h1.position.set(0.22, 2.45, 0); h1.rotation.z = -0.4; const h2 = h1.clone(); h2.position.x = -0.22; h2.rotation.z = 0.4; inner.add(h1, h2); }
    if (kind === 'boss') { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.3, 0.25, 8, 1, true), M.crown); c.position.y = 2.55; inner.add(c); }
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

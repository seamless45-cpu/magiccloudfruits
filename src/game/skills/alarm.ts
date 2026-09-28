import * as THREE from 'three';
import type { ItemDef, Effect } from '../types';
import { explosion, shockwave, beam, Timed, GEO, addMat, V, rnd, slashMesh } from '../effects';
import { cone, faceAim, knockFor } from './util';

const RED = 0xff2233;

function imprisonBeams(g: any, from: THREE.Vector3, beams: number, targets: number, dur: number) {
  const tg = g.pickTargets(targets, from, 200);
  for (let i = 0; i < beams; i++) { const e = tg[i % Math.max(1, tg.length)]; if (!e) break; beam(g, from.clone(), e.pos.clone().setY(e.height * 0.5), RED, 0.35, 0.35); if (i < tg.length) g.damage(e, 3000, { imprison: dur }); }
}
function tallBeam(g: any, p: THREE.Vector3, w = 1.6) { beam(g, V(p.x, 160, p.z), V(p.x, 0, p.z), RED, w, 0.6, 0xffd0d0); explosion(g, V(p.x, 0, p.z), 5, { core: 0xffe0e0, mid: RED, ring: RED, smoke: 0x301015, debrisCount: 4, smokeCount: 4, shake: 3 }); }
function redStomp(g: any, c: THREE.Vector3, scale = 1) {
  const R = g.aoe(40); shockwave(g, c, R, 0.8, 0xff5060, 0.35); explosion(g, c, 10 * scale, { core: 0xffe0e0, mid: RED, ring: 0xff4050, smoke: 0x2a1015, debris: 0x4a3030, shake: 13 });
  g.shake(c, 13, 0.6);
  g.damageRadius(c, R, 20000, { knock: knockFor(50) * 0.6, knockUp: 22, stun: 1 });
}

/** Giant attacker from Amber Alert. Uses Alarm Sword; auto Red Stomp every 5s; mini hacker every 2s. */
class AmberGiant implements Effect {
  grp = new THREE.Group(); pos: THREE.Vector3; target: any = null; t = 0; atk = 0; hits = 0; stompT = rnd(1, 5); hackT = 2; drone: THREE.Mesh; sword: THREE.Group; life = 15;
  static claimed = new Set<any>();
  constructor(public g: any, p: THREE.Vector3) {
    this.pos = p.clone();
    const body = new THREE.MeshStandardMaterial({ color: 0x2a0c10, metalness: 0.7, roughness: 0.35, emissive: 0x550008, emissiveIntensity: 0.6 });
    const t = new THREE.Mesh(new THREE.CapsuleGeometry(1.8, 4, 4, 10), body); t.position.y = 5.5; t.userData.ownGeo = true;
    const h = new THREE.Mesh(new THREE.SphereGeometry(1.3, 12, 10), body); h.position.y = 9.2; h.userData.ownGeo = true;
    const eye = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.3, 0.2), new THREE.MeshBasicMaterial({ color: RED })); eye.position.set(0, 9.3, 1.15); eye.userData.ownGeo = true;
    const l1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 3, 3, 8), body); l1.position.set(0.9, 1.8, 0); l1.userData.ownGeo = true; const l2 = l1.clone(); l2.position.x = -0.9;
    this.sword = new THREE.Group(); const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 7, 0.9), new THREE.MeshStandardMaterial({ color: 0xff3040, emissive: RED, emissiveIntensity: 2 })); blade.position.y = 3.5; blade.userData.ownGeo = true; this.sword.add(blade);
    this.sword.position.set(-2.4, 6.5, 0.5); this.sword.rotation.x = 0.9;
    this.drone = new THREE.Mesh(new THREE.OctahedronGeometry(0.6), new THREE.MeshBasicMaterial({ color: 0x33ff88 })); this.drone.userData.ownGeo = true;
    this.grp.add(t, h, eye, l1, l2, this.sword); g.scene.add(this.grp); g.scene.add(this.drone);
    this.grp.traverse((o: any) => { if (o.isMesh) o.castShadow = true; });
    explosion(g, V(p.x, 0, p.z), 8, { core: 0xffd0d0, mid: RED, ring: RED, smoke: 0x301015, debrisCount: 8, shake: 4 });
  }
  pick() {
    const g = this.g; let best: any = null, bd = 200 * 200;
    for (const e of g.enemies) { if (e.dead || AmberGiant.claimed.has(e)) continue; const d = e.pos.distanceToSquared(this.pos); if (d < bd) { bd = d; best = e; } }
    if (best) AmberGiant.claimed.add(best); this.target = best;
  }
  update(dt: number) {
    const g = this.g; this.t += dt;
    if (!this.target || this.target.dead) { if (this.target) AmberGiant.claimed.delete(this.target); this.pick(); }
    const tg = this.target;
    if (tg) {
      const d = V(tg.pos.x - this.pos.x, 0, tg.pos.z - this.pos.z); const l = d.length();
      this.grp.rotation.y = Math.atan2(d.x, d.z);
      if (l > 5 + tg.radius) this.pos.addScaledVector(d.normalize(), Math.min(l, 20 * dt));
      else { this.atk -= dt; if (this.atk <= 0) { this.atk = 0.2; this.swing(tg); } }
      this.hackT -= dt; if (this.hackT <= 0) { this.hackT = 2; beam(g, this.drone.position.clone(), tg.pos.clone().setY(tg.height * 0.6), 0x33ff88, 0.25, 0.4, 0xd0ffe0); g.damage(tg, 2000, { noCharge: true }); tg.hacked = Math.max(tg.hacked, 15 - this.t + 2); }
    }
    this.stompT -= dt; if (this.stompT <= 0) { this.stompT = 5; redStomp(g, this.pos.clone(), 1.2); }
    this.grp.position.copy(this.pos); this.sword.rotation.x = 0.9 + Math.max(0, this.atk) * 8;
    this.drone.position.set(this.pos.x + Math.cos(this.t * 3) * 3, 12 + Math.sin(this.t * 5) * 0.5, this.pos.z + Math.sin(this.t * 3) * 3); this.drone.rotation.y += dt * 5;
    const k = Math.min(1, (this.life - this.t) / 0.6); this.grp.scale.setScalar(Math.max(0.01, Math.min(1, this.t / 0.5) * k));
    return this.t < this.life;
  }
  swing(tg: any) {
    const g = this.g; const m = slashMesh(RED, 6); const grp = new THREE.Group(); grp.add(m); grp.position.copy(tg.pos).setY(3); m.rotation.set(Math.PI / 2, 0, rnd(0, 6.28));
    g.add(new Timed(g, grp, 0.18, (k) => { (m.material as any).opacity = 1 - k; m.rotateZ(0.3); }));
    g.damage(tg, 12000, { noCharge: true }); this.hits++;
    if (this.hits % 3 === 0) imprisonBeams(g, this.pos.clone().setY(9), 6, 4, 3);
  }
  dispose() { if (this.target) AmberGiant.claimed.delete(this.target); this.g.scene.remove(this.grp, this.drone); this.grp.traverse((o: any) => { o.material?.dispose(); o.userData.ownGeo && o.geometry.dispose(); }); this.drone.geometry.dispose(); (this.drone.material as any).dispose(); }
}

export const ALARM_FRUIT: ItemDef = {
  id: 'alarm', name: 'Alarm Fruit', type: 'fruit', color: '#ff2a3a', glyph: '⚠',
  skills: [
    { name: 'Manual Alert', cd: 3, info: 'Red lasers · imprison 6s · 80m', cast: (g) => { g.anim('punch', 0.3); const h = g.handPos(); const R = g.aoe(80);
      const tg = g.enemies.filter((e: any) => !e.dead && e.pos.distanceTo(g.player.pos) < R);
      for (const e of tg) { beam(g, h, e.pos.clone().setY(e.height * 0.5), RED, 0.3, 0.4); g.damage(e, 6000, { imprison: 6 }); }
      if (!tg.length) g.toast('NO TARGETS IN 80m', '#ff6677'); } },
    { name: 'Automatic Transmission Alarming', cd: 5.5, info: 'Highest-HP target · imprison 15s + tall beams', cast: (g) => { g.anim('punch', 0.3);
      let best: any = null; for (const e of g.enemies) if (!e.dead && e.pos.distanceTo(g.player.pos) < 400 && (!best || e.hp > best.hp)) best = e;
      if (!best) return; const h = g.handPos(); beam(g, h, best.pos.clone().setY(best.height * 0.5), RED, 2.6, 0.7, 0xffe0e0); g.damage(best, 40000, { imprison: 15 }); g.shake(best.pos, 10, 0.4);
      g.after(0.4, () => { const R = g.aoe(45); for (const e of g.enemies) if (!e.dead && e.imprison > 0 && e.pos.distanceTo(best.pos) < R) { tallBeam(g, e.pos, 1.8); g.damage(e, 15000, {}); } }); } },
    { name: 'Siren Blaster', cd: 8, info: 'Enemies <1000m flee · red beam each 1s ×7', cast: (g) => {
      const P = g.player; const R = g.aoe(1000); const aff = g.enemies.filter((e: any) => !e.dead && e.pos.distanceTo(P.pos) < R); for (const e of aff) e.flee = 7;
      g.toast('SIREN BLASTER', '#ff4455');
      g.every(0.35, 20, () => { const ring = new THREE.Mesh(GEO.torus, addMat(RED, 0.8)); const grp = new THREE.Group(); grp.add(ring); grp.position.copy(P.pos).setY(1.5);
        g.add(new Timed(g, grp, 1.2, (k) => { ring.scale.setScalar(2 + k * 80); (ring.material as any).opacity = 0.8 * (1 - k); grp.position.copy(P.pos).setY(1.5); })); });
      g.every(1, 7, () => { for (const e of aff) { if (e.dead || e.flee <= 0) continue; tallBeam(g, e.pos, 1.1); for (let i = 0; i < 3; i++) g.bolt(e.pos.clone().setY(rnd(0, e.height)), e.pos.clone().add(V(rnd(-2, 2), rnd(0, e.height + 1), rnd(-2, 2))), { color: RED, core: 0xffc0c0, width: 0.15, life: 0.5, segs: 8 }); g.damage(e, 5000, {}); } });
    } },
    { name: 'Alarm Buffer', cd: 15, info: '+200% dmg, +200% AoE, -25% CD · 30s', cast: (g) => {
      g.buffs.alarm = g.time + 30; g.toast('ALARM BUFFER ACTIVE', '#ff3344');
      const ring = new THREE.Mesh(GEO.torus, addMat(RED, 0.8)); const ring2 = new THREE.Mesh(GEO.ring, addMat(RED, 0.4)); const grp = new THREE.Group(); grp.add(ring, ring2);
      g.add(new Timed(g, grp, 30, (k, t) => { grp.position.copy(g.player.pos).setY(0.2); ring.scale.setScalar(2.4 + Math.sin(t * 6) * 0.2); ring.rotation.z = t * 2; ring2.scale.setScalar(2); ring.position.y = 1 + Math.sin(t * 3) * 0.8; if (Math.random() < 0.3) g.fx.spawn(g.player.pos.x + rnd(-1, 1), rnd(0, 2), g.player.pos.z + rnd(-1, 1), 0, 3, 0, RED, 0.3, 0.6, {}); }));
    } },
    { name: 'Amber Alert', cd: 30, info: '15 giants · 15s · mini hackers', cast: (g) => { g.toast('AMBER ALERT — 15 GIANTS DEPLOYED', '#ffb020'); for (let i = 0; i < 15; i++) { const a = (i / 15) * 6.28; g.after(i * 0.05, () => g.add(new AmberGiant(g, g.player.pos.clone().add(V(Math.cos(a) * 14, 0, Math.sin(a) * 14))))); } } },
  ],
};

let swordHits = 0;
export const ALARM_SWORD: ItemDef = {
  id: 'alarmsword', name: 'Alarm Sword', type: 'sword', color: '#ff3040', glyph: '⚡',
  passive: 'Every 3 M1 hits: 6 red beams imprison 4 enemies (3s)',
  m1: { interval: 0.2, combo: 4, endLag: 0.4, onHit: (g) => { faceAim(g); g.slashFx(RED, 3.2, 1.8, rnd(-0.7, 0.7)); const hit = cone(g, 7, 5000);
    if (hit.length) { swordHits++; if (swordHits % 3 === 0) imprisonBeams(g, g.handPos(), 6, 4, 3); } } },
  skills: [
    { name: 'Red Stomp', cd: 5, info: '40m · knock up to 50m · shake 13', cast: (g) => { const P = g.player; P.vel.y = 12; P.grounded = false; g.after(0.45, () => redStomp(g, P.pos.clone().setY(0))); } },
  ],
};

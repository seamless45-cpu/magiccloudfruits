import * as THREE from 'three';
import type { ItemDef } from '../types';
import { explosion, shockwave, cracks, Timed, Projectile, Tsunami, GEO, addMat, alphaMat, V, rnd } from '../effects';
import { cone, faceAim, knockFor } from './util';

const NB = 0x2ad4ff; // neon blue

function airCracks(g: any, at: THREE.Vector3, n: number, len: number) {
  for (let i = 0; i < n; i++) { const d = V(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(len * rnd(0.5, 1)); g.bolt(at.clone(), at.clone().add(d), { color: NB, core: 0xe8ffff, width: 0.18, life: 0.6, segs: 8, jag: 0.12, branches: 1 }); }
}
function armCracks(g: any, life: number) {
  for (const right of [true, false]) {
    const arm = right ? g.player.rArm : g.player.lArm;
    g.bolt(V(), V(), { color: NB, core: 0xffffff, width: 0.08, life, segs: 8, jag: 0.15, branches: 2, follow: () => { const a = V(), b = V(); arm.localToWorld(a.set(0, 0, 0)); arm.localToWorld(b.set(0, -0.8, 0)); return [a, b]; } });
  }
}
function debrisBlocks(g: any, c: THREE.Vector3, r: number, n: number) {
  for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, d = rnd(0.2, 1) * r; g.debris.spawn(c.x + Math.cos(a) * d, 0.5, c.z + Math.sin(a) * d, Math.cos(a) * rnd(4, 14), rnd(8, 22), Math.sin(a) * rnd(4, 14), rnd(0.4, 1.4), 0x5d5750, rnd(3, 5)); }
}
function quakeShock(g: any, c: THREE.Vector3, r: number, dur = 0.8) {
  shockwave(g, c, r, dur, 0xffffff, 0.42);
  const sph = new THREE.Mesh(GEO.sphere, alphaMat(0xf4fbff, 0.18)); const grp = new THREE.Group(); grp.add(sph); grp.position.copy(c);
  g.add(new Timed(g, grp, dur, (k) => { sph.scale.setScalar(r * (0.2 + 0.8 * (1 - Math.pow(1 - k, 2)))); (sph.material as any).opacity = 0.18 * (1 - k); }));
}

export const QUAKE_FRUIT: ItemDef = {
  id: 'quake', name: 'Quake Fruit', type: 'fruit', color: '#e8f6ff', glyph: '❂',
  skills: [
    { name: 'Fatal Destruction', cd: 5, info: 'Grab → red pause 1s → quake punch', cast: (g) => {
      faceAim(g); const P = g.player; g.anim('punch', 0.2);
      let tg: any = null, bd = 1e9;
      for (const e of g.enemies) { if (e.dead) continue; const d = V(e.pos.x - P.pos.x, 0, e.pos.z - P.pos.z); const l = d.length(); if (l < 22 && d.normalize().dot(P.facing) > 0.55 && l < bd) { bd = l; tg = e; } }
      const hand = g.handPos(); for (let i = 0; i < 20; i++) { const p = hand.clone().addScaledVector(P.facing, i * 1.1); g.fx.spawn(p.x, p.y, p.z, -P.facing.x * 20, 0, -P.facing.z * 20, 0xcff4ff, 0.6, 0.3, {}); }
      if (!tg) { g.toast('NO TARGET CAUGHT', '#8fa3b5'); return; }
      tg.pos.copy(P.pos).addScaledVector(P.facing, 2.5); tg.stun = 2;
      g.pauseEnemies = 1.05; P.lockMove = 1.1; P.invincible = 1.2; g.anim('charge', 1);
      g.every(0.05, 20, (i: number) => g.screen(i < 10 ? '#ff1a1a' : '#8a0000', 0.25 + i * 0.03, 0));
      armCracks(g, 1.1);
      g.after(1.0, () => {
        g.screen('#6a0000', 0.8, 3); g.anim('punch', 0.25);
        const c = P.pos.clone().addScaledVector(P.facing, 3);
        airCracks(g, g.handPos(), 14, 7); quakeShock(g, c, g.aoe(20), 0.7); cracks(g, c, g.aoe(18), 12, NB, 1.4);
        g.shake(P.pos, 60, 0.9);
        g.damage(tg, 150000, { knock: knockFor(60), knockUp: 14, stun: 2, from: P.pos.clone() });
        cone(g, g.aoe(12), 30000, { knock: knockFor(30), stun: 1 }, 0.3);
      });
    } },
    { name: 'Air Crusher', cd: 7, info: 'Large quake orb · stun 2s', cast: (g) => {
      faceAim(g); g.anim('punch', 0.3); const h = g.handPos(); airCracks(g, h, 12, 4);
      const grp = new THREE.Group(); const orb = new THREE.Mesh(GEO.sphere, alphaMat(0xf0faff, 0.45)); const shell = new THREE.Mesh(GEO.sphere, addMat(NB, 0.3)); orb.scale.setScalar(4); shell.scale.setScalar(4.6); grp.add(orb, shell);
      g.add(new Projectile(g, { pos: h.clone(), vel: g.player.facing.clone().multiplyScalar(55), mesh: grp, hitR: 5, pierce: true, hitGround: false, life: 1.8,
        onHit: (p, e) => { if (e) { g.damage(e, 22000, { stun: 2, knock: 5, from: p.clone() }); } else { quakeShock(g, p.setY(0), g.aoe(14), 0.5); g.damageRadius(p, g.aoe(14), 15000, { stun: 2 }); } },
        trail: (p) => { shell.scale.setScalar(4.6 + Math.random()); if (Math.random() < 0.5) g.bolt(p.clone(), p.clone().add(V(rnd(-5, 5), rnd(-5, 5), rnd(-5, 5))), { color: NB, width: 0.15, life: 0.2, segs: 7, branches: 1 }); } }));
    } },
    { name: 'Spatial Shockwave', cd: 7, info: 'Ground smash · stun 5s · knock 10m', cast: (g) => {
      g.anim('punch', 0.3); const c = g.player.pos.clone(); armCracks(g, 1.4);
      quakeShock(g, c, g.aoe(45), 1.0); cracks(g, c, g.aoe(40), 26, NB, 1.8, 0.5); debrisBlocks(g, c, g.aoe(30), 60);
      explosion(g, c, 6, { core: 0xffffff, mid: 0xbfefff, ring: 0xffffff, smoke: 0x6a6a70, debris: 0x5d5750, shake: 40, ringOnly: true });
      g.damageRadius(c, g.aoe(45), 25000, { stun: 5, knock: knockFor(10) });
    } },
    { name: 'Seaquake', cd: 14.5, info: '3× smash · 12 small + 4 large (×8) tsunamis', cast: (g) => {
      g.anim('punch', 0.3); const c = g.player.pos.clone(); armCracks(g, 2);
      [30, 55, 85].forEach((r, i) => g.after(i * 0.15, () => { quakeShock(g, c, g.aoe(r), 0.6); cracks(g, c, g.aoe(r), 10 + i * 6, NB, 1.5, 0.45); g.damageRadius(c, g.aoe(r), 12000, { stun: 1 }); g.shake(c, 25, 0.4); }));
      const dirs = [V(1, 0, 0), V(-1, 0, 0), V(0, 0, 1), V(0, 0, -1)];
      g.after(0.5, () => {
        dirs.forEach((d, si) => {
          const side = V(-d.z, 0, d.x);
          for (let i = 0; i < 3; i++) { const from = c.clone().addScaledVector(d, 110).addScaledVector(side, (i - 1) * 32); g.add(new Tsunami(g, from, from.clone().addScaledVector(d, -110), 150, 40, 45, 7000)); }
          g.after(0.6, () => { const from = c.clone().addScaledVector(d, 160); g.add(new Tsunami(g, from, c.clone(), 600, 150, 50, 21000, 0x1558b0)); });
          if (si === 0) g.toast('SEAQUAKE — TSUNAMIS INBOUND', '#5fd7ff');
        });
      });
    } },
  ],
};

export const BISENTO: ItemDef = {
  id: 'bisento', name: 'Bisento (Quake)', type: 'sword', color: '#bfefff', glyph: '⚚',
  m1: { interval: 0.3, combo: 3, endLag: 0.3, onHit: (g) => { faceAim(g); g.slashFx(0xdff6ff, 4, 2.4, rnd(-0.6, 0.6)); cone(g, 8, 4000, { knock: 2 }); } },
  skills: [
    { name: 'Quake Slam', cd: 2, info: 'Shockwave · stun 2.5s · knock far', cast: (g) => { faceAim(g); g.anim('slash', 0.3); const c = g.player.pos.clone().addScaledVector(g.player.facing, 3);
      quakeShock(g, c, g.aoe(30), 0.8); cracks(g, c, g.aoe(28), 18, NB, 1.4, 0.4); debrisBlocks(g, c, g.aoe(15), 25); g.shake(c, 22, 0.5);
      g.damageRadius(c, g.aoe(30), 18000, { stun: 2.5, knock: knockFor(40) }); } },
    { name: 'Quake Ball', cd: 3, info: '5 diagonal quake orbs', cast: (g) => { faceAim(g); g.anim('punch', 0.25); const h = g.handPos(); airCracks(g, h, 6, 3);
      for (let i = 0; i < 5; i++) { const a = THREE.MathUtils.degToRad(-32 + i * 16); const f = g.player.facing; const d = V(f.x * Math.cos(a) - f.z * Math.sin(a), 0.05, f.x * Math.sin(a) + f.z * Math.cos(a)).normalize();
        const grp = new THREE.Group(); const o = new THREE.Mesh(GEO.sphere, alphaMat(0xffffff, 0.55)); o.scale.setScalar(1.3); const s = new THREE.Mesh(GEO.sphere, addMat(NB, 0.35)); s.scale.setScalar(1.6); grp.add(o, s);
        g.add(new Projectile(g, { pos: h.clone(), vel: d.multiplyScalar(60), mesh: grp, hitR: 1.5, life: 1.5, hitGround: true, gravity: 2,
          onHit: (p) => { const R = g.aoe(9); quakeShock(g, p.setY(0), R, 0.5); cracks(g, p, R, 6, NB, 0.8, 0.3); g.damageRadius(p, R, 9000, { stun: 0.8, knock: 5 }); g.shake(p, 8, 0.3); },
          trail: (p) => g.fx.spawn(p.x, p.y, p.z, 0, 0, 0, 0xc8f4ff, 0.8, 0.2, {}) })); } } },
    { name: 'Mini Seaquake', cd: 5, info: '23 small tsunamis from random directions', cast: (g) => { g.anim('slash', 0.3); const c = g.player.pos.clone(); quakeShock(g, c, g.aoe(18), 0.5); cracks(g, c, 18, 10, NB, 1);
      for (let i = 0; i < 23; i++) { const a = Math.random() * 6.28; const from = c.clone().add(V(Math.cos(a) * rnd(55, 80), 0, Math.sin(a) * rnd(55, 80))); g.after(i * 0.03, () => g.add(new Tsunami(g, from, c.clone(), 16, 5, 38, 5000))); } } },
  ],
};

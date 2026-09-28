import * as THREE from 'three';
import type { ItemDef } from '../types';
import { explosion, shockwave, Pit, fallingRock, Timed, Projectile, beam, GEO, addMat, alphaMat, V, rnd, rndi } from '../effects';
import { around, faceAim, spreadDir } from './util';

const ICE = 0x9fe8ff, FIRE = 0xff6a1a;
const shardGeo = new THREE.ConeGeometry(0.25, 1.2, 5).rotateX(Math.PI / 2);
const shardMatIce = new THREE.MeshBasicMaterial({ color: 0xd8f8ff });
const shardMatFire = new THREE.MeshBasicMaterial({ color: 0xffa040 });

function fragments(g: any, c: THREE.Vector3, n: number, speed: number, dmg: number, fire: boolean, onEnemy?: (e: any) => void) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.28; const d = V(Math.cos(a), rnd(0.05, 0.5), Math.sin(a)).normalize();
    const m = new THREE.Mesh(shardGeo, fire ? shardMatFire : shardMatIce); m.userData.shared = true;
    const col = fire ? FIRE : ICE;
    g.add(new Projectile(g, { pos: c.clone().setY(1.5), vel: d.multiplyScalar(speed), mesh: m, hitR: 1.2, life: 0.6, gravity: 20, pierce: true,
      onHit: (p, e) => { if (e) { g.damage(e, dmg, { noCharge: true, skillHit: true }); onEnemy?.(e); } },
      trail: (p, dt, self) => { m.lookAt(p.clone().add(self.o.vel)); if (Math.random() < 0.4) g.fx.spawn(p.x, p.y, p.z, 0, 0, 0, col, 0.5, 0.15, {}); } }));
  }
}
const iceMul = (g: any) => (g.buff('iceBombard') ? 78001 : 1);
const fireMul = (g: any) => (g.buff('hellFury') ? 12501 : 1);

function shoot(g: any, color: number) {
  faceAim(g); const muzzle = g.handPos().addScaledVector(g.player.facing, 0.6); const tg = g.autoAim(220);
  const to = tg ? tg.pos.clone().setY(tg.height * 0.55) : g.aim.clone().setY(1);
  if (tg) { const d = to.clone().sub(muzzle).setY(0).normalize(); g.player.facing.copy(d); }
  return { muzzle, tg, to };
}

export const RIME_FRUIT: ItemDef = {
  id: 'rime', name: 'Rimefracture Fruit', type: 'fruit', color: '#9fe8ff', glyph: '❄',
  passive: 'Gun (manual, auto-aim, 0.05s): 45% icicle ×76 dmg + 40m ice-ball burst',
  m1: { gun: true, interval: 0.05, onHit: (g) => {
    const { muzzle, tg, to } = shoot(g, ICE); const mul = iceMul(g);
    if (Math.random() < 0.45) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.2, 6).rotateX(Math.PI / 2), addMat(0xe0faff, 1)); m.userData.ownGeo = true;
      g.add(new Projectile(g, { pos: muzzle.clone(), vel: to.clone().sub(muzzle).normalize().multiplyScalar(260), mesh: m, homing: () => (tg && !tg.dead ? tg.pos.clone().setY(tg.height * 0.55) : null), turn: 30, hitR: 1, life: 2,
        trail: (p, dt, self) => { m.lookAt(p.clone().add(self.o.vel)); g.fx.spawn(p.x, p.y, p.z, 0, 0, 0, ICE, 0.7, 0.2, {}); },
        onHit: (p, e) => { if (e) g.damage(e, 2000 * 76 * mul, {}); const tp = (e ?? { pos: p }).pos.clone().setY(0);
          fallingRock(g, tp, 4, 120, 0xcfeeff, 0x7fd8ff, (ip) => { const R = g.aoe(40); explosion(g, ip, R, { core: 0xffffff, mid: 0x7fd8ff, ring: 0xc8f4ff, smoke: 0xcfe6f0, debris: 0xbfeeff, shake: 10, debrisCount: 20 }); g.damageRadius(ip, R, 30000 * mul, {}); fragments(g, ip, 16, 120, 6000 * mul, false); }, 90, 0.2); } }));
    } else {
      beam(g, muzzle, to, ICE, 0.12, 0.06, 0xffffff);
      if (tg) g.damage(tg, 2000 * mul, {});
    }
    g.fx.spawn(muzzle.x, muzzle.y, muzzle.z, 0, 0, 0, 0xffffff, 0.6, 0.05, {});
  } },
  skills: [
    { name: 'Icy Power', cd: 3.5, info: '18 giant icicles · 45m blast · 20-40 frags', cast: (g) => { g.anim('raise', 0.4); const c = g.aim.clone();
      g.every(0.13, 18, () => { const t = around(c, 20); const grp = new THREE.Group(); const ic = new THREE.Mesh(GEO.cone, new THREE.MeshStandardMaterial({ color: 0xcff4ff, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.85, emissive: 0x3aa0d0 })); ic.scale.set(2.2, 12, 2.2); ic.rotation.x = Math.PI; ic.position.y = 6; grp.add(ic);
        const start = t.clone().setY(150);
        g.add(new Projectile(g, { pos: start, vel: V(0, -130, 0), mesh: grp, hitEnemies: false, life: 5, trail: (p) => g.fx.spawn(p.x + rnd(-1, 1), p.y + 8, p.z + rnd(-1, 1), 0, 10, 0, ICE, 1.4, 0.3, {}),
          onHit: (p) => { const R = g.aoe(45); const dmg = 20000 * iceMul(g); explosion(g, p.setY(0), R, { core: 0xffffff, mid: 0x6fd0ff, ring: 0xbfefff, smoke: 0xd8ecf4, debris: 0xcff4ff, shake: 9, spikes: 8, debrisCount: 18 });
            g.damageRadius(p, R, dmg, { skillHit: true }); fragments(g, p, rndi(20, 40), 80, dmg * 0.5, false); } })); }); } },
    { name: 'Ice Bombard', cd: 30, info: 'Gun ×78,001 dmg · -77% fire CD · freeze 3s · 15s', cast: (g) => {
      g.buffs.iceBombard = g.time + 15; g.toast('ICE BOMBARD — SUPERPOWER STATE', '#9fe8ff'); shockwave(g, g.player.pos, 20, 0.6, ICE, 0.4);
      const grp = new THREE.Group(); const aura = new THREE.Mesh(GEO.sphere, addMat(ICE, 0.18)); grp.add(aura);
      g.add(new Timed(g, grp, 15, (k, t) => { grp.position.copy(g.player.pos).setY(1); aura.scale.setScalar(1.8 + Math.sin(t * 8) * 0.15); if (Math.random() < 0.6) g.fx.spawn(g.player.pos.x + rnd(-1.5, 1.5), rnd(0, 2.5), g.player.pos.z + rnd(-1.5, 1.5), 0, 2, 0, 0xdff8ff, 0.3, 0.8, {}); }));
    } },
    { name: 'Snowy Destruction', cd: 8, info: 'Warm-up 0.5s (invincible) · 5000m blast · freeze 10s', cast: (g) => {
      const P = g.player; P.invincible = Math.max(P.invincible, 0.7); P.lockMove = 0.6; g.anim('charge', 0.5);
      g.add(new Timed(g, new THREE.Group(), 0.5, () => { for (let i = 0; i < 6; i++) { const a = Math.random() * 6.28; g.fx.spawn(P.pos.x + Math.cos(a) * 5, 0.3, P.pos.z + Math.sin(a) * 5, -Math.cos(a) * 10, 1, -Math.sin(a) * 10, ICE, 0.6, 0.5, {}); } }));
      g.after(0.5, () => {
        const c = P.pos.clone().setY(0); const R = g.aoe(5000);
        g.screen('#7fe0ff', 0.75, 1.5); g.shake(c, 60, 12);
        const dome = new THREE.Mesh(GEO.sphere, alphaMat(0xbfeeff, 0.35)); const ring = new THREE.Mesh(GEO.ring, addMat(0xdff8ff, 0.9)); const core = new THREE.Mesh(GEO.sphere, addMat(0xffffff, 1)); const grp = new THREE.Group(); grp.add(dome, ring, core); grp.position.copy(c);
        g.add(new Timed(g, grp, 3, (k) => { const e = 1 - Math.pow(1 - k, 4); dome.scale.set(R * e, R * e * 0.25, R * e); (dome.material as any).opacity = 0.35 * (1 - k); ring.scale.setScalar(R * e); (ring.material as any).opacity = 0.9 * (1 - k); core.scale.setScalar(20 + 60 * Math.min(1, k * 5)); (core.material as any).opacity = Math.max(0, 1 - k * 3); }));
        explosion(g, c, 40, { core: 0xffffff, mid: 0x7fd8ff, ring: 0xdff8ff, smoke: 0xdcecf4, debris: 0xcff4ff, shake: 1, debrisCount: 0, spikes: 16 });
        for (let i = 0; i < 260; i++) { const a = Math.random() * 6.28, sp = rnd(10, 70); g.debris.spawn(c.x + Math.cos(a) * rnd(2, 30), 1, c.z + Math.sin(a) * rnd(2, 30), Math.cos(a) * sp, rnd(10, 50), Math.sin(a) * sp, rnd(0.5, 3.5), i % 3 ? 0xcff4ff : 0x7a8a95, rnd(6, 10)); }
        const spikes = new THREE.Group(); for (let i = 0; i < 40; i++) { const a = Math.random() * 6.28, d = rnd(8, 90); const s = new THREE.Mesh(GEO.cone, new THREE.MeshStandardMaterial({ color: 0xcff4ff, transparent: true, opacity: 0.85, roughness: 0.05, emissive: 0x2a80a0 })); s.position.set(c.x + Math.cos(a) * d, 0, c.z + Math.sin(a) * d); s.scale.set(rnd(1, 3), rnd(6, 20), rnd(1, 3)); s.rotation.set(rnd(-0.4, 0.4), 0, rnd(-0.4, 0.4)); spikes.add(s); }
        g.add(new Timed(g, spikes, 10, (k) => spikes.children.forEach((s: any) => { s.material.opacity = 0.85 * Math.min(1, (1 - k) * 5); })));
        const hit = g.damageRadius(c, R, 60000 * iceMul(g), { freeze: 10 });
        g.every(0.5, 20, () => { for (const e of hit) if (!e.dead) g.damage(e, 4000 * iceMul(g), { noCharge: true, source: 'dot' }); });
        g.toast('SNOWY DESTRUCTION', '#bfefff');
      });
    } },
  ],
};

function orangeBolt(g: any, e: any) { g.strike(e.pos.x, e.pos.z, { color: 0xff8a20, core: 0xfff0c0, width: 1.4, n: 2, h: 110, life: 0.4 }); }

export const WILDFIRE_FRUIT: ItemDef = {
  id: 'wildfire', name: 'Wildfire Fruit', type: 'fruit', color: '#ff6a1a', glyph: '🜂',
  passive: 'Gun (manual, auto-aim, 0.1s): 35% fireball ×151 + 45m burst · <50% HP ×11 & AoE +300%',
  m1: { gun: true, interval: 0.1, onHit: (g) => {
    const { muzzle, tg, to } = shoot(g, FIRE); const mul = fireMul(g);
    if (Math.random() < 0.35) {
      const grp = new THREE.Group(); const b = new THREE.Mesh(GEO.sphere, addMat(0xffc060, 1)); b.scale.setScalar(0.7); const a = new THREE.Mesh(GEO.sphere, addMat(FIRE, 0.5)); a.scale.setScalar(1.2); grp.add(b, a);
      g.add(new Projectile(g, { pos: muzzle.clone(), vel: to.clone().sub(muzzle).normalize().multiplyScalar(200), mesh: grp, homing: () => (tg && !tg.dead ? tg.pos.clone().setY(tg.height * 0.55) : null), turn: 30, hitR: 1.2, life: 2,
        trail: (p) => { g.fx.spawn(p.x, p.y, p.z, rnd(-1, 1), rnd(0, 2), rnd(-1, 1), FIRE, 1.2, 0.3, {}); g.smoke.spawn(p.x, p.y, p.z, 0, 1, 0, 0x2a1a10, 1.2, 0.6, { grow: 1, alpha: 0.4 }); },
        onHit: (p, e) => { const low = e && e.hp < e.maxHp * 0.5; if (e) g.damage(e, 2500 * 151 * mul, { lowHpBonus: true }); const tp = (e ?? { pos: p }).pos.clone().setY(0);
          fallingRock(g, tp, 4.5, 130, 0x3a1a0a, 0xff5a10, (ip) => { const R = g.aoe(45) * (low ? 4 : 1); explosion(g, ip, R, { core: 0xfff0b0, mid: FIRE, ring: 0xff9a40, smoke: 0x2a1a12, debris: 0x3a2a20, spikes: 10, shake: 14 });
            g.damageRadius(ip, R, 40000 * mul * (low ? 3 : 1), { lowHpBonus: true }); let n = 0; fragments(g, ip, rndi(30, 60), 150, 8000 * mul, true, (en) => { if (n++ < 8) orangeBolt(g, en); }); }, 90, 0.2); } }));
    } else {
      beam(g, muzzle, to, FIRE, 0.14, 0.07, 0xfff0c0);
      if (tg) g.damage(tg, 2500 * mul, { lowHpBonus: true });
    }
    g.fx.spawn(muzzle.x, muzzle.y, muzzle.z, 0, 0, 0, 0xffd080, 0.7, 0.05, {});
  } },
  skills: [
    { name: 'Firestorm', cd: 5, info: '150 fireballs · 30° · 30m · 6s pits', cast: (g) => { faceAim(g); const base = g.player.facing.clone();
      g.every(0.035, 150, () => { const h = g.handPos(); const d = spreadDir(base, 30); d.y = rnd(0.02, 0.12); d.normalize();
        const grp = new THREE.Group(); const b = new THREE.Mesh(GEO.sphereLo, addMat(0xffb040, 1)); b.scale.setScalar(0.9); grp.add(b);
        g.add(new Projectile(g, { pos: h.clone(), vel: d.multiplyScalar(95), mesh: grp, gravity: 12, hitR: 1.2, life: 3,
          trail: (p) => g.fx.spawn(p.x, p.y, p.z, 0, 1, 0, FIRE, 1.4, 0.25, {}),
          onHit: (p) => { const R = g.aoe(30); explosion(g, p.setY(0), R, { core: 0xffe0a0, mid: 0xff4a00, ring: FIRE, smoke: 0x2a1a12, debris: 0x3a2a20, debrisCount: 4, smokeCount: 5, shake: 3 }); g.damageRadius(p, R, 9000 * fireMul(g), { burn: 4, lowHpBonus: true, skillHit: true });
            g.add(new Pit(g, p, R * 0.5, 6, 0xff7a20, 0x5a1000, (pit: Pit) => g.damageRadius(pit.pos, pit.r, 1500, { burn: 2, noCharge: true, source: 'dot' }), 0.5)); } })); }); } },
    { name: 'Hell Fury', cd: 30, info: 'Gun ×12,501 dmg · -78% fire CD · burn 3s · 15s', cast: (g) => {
      g.buffs.hellFury = g.time + 15; g.toast('HELL FURY — SUPERPOWER STATE', '#ff7a2a'); explosion(g, g.player.pos.clone(), 12, { core: 0xfff0c0, mid: FIRE, ring: FIRE, smoke: 0x2a1a12, debrisCount: 0, shake: 5 });
      g.add(new Timed(g, new THREE.Group(), 15, () => { const P = g.player.pos; for (let i = 0; i < 2; i++) g.fx.spawn(P.x + rnd(-0.8, 0.8), rnd(0, 2), P.z + rnd(-0.8, 0.8), 0, rnd(3, 6), 0, i ? 0xffc040 : FIRE, 0.6, 0.5, { turb: 3 }); }));
    } },
    { name: 'Burning Lightning', cd: 5, info: '40 lava rocks · 40° · 50m · 10s lava pits', cast: (g) => { faceAim(g); const base = g.player.facing.clone();
      g.every(0.1, 40, () => { const h = g.handPos(); const d = spreadDir(base, 40); d.y = rnd(0.15, 0.35); d.normalize();
        const grp = new THREE.Group(); const r = new THREE.Mesh(GEO.rock, new THREE.MeshStandardMaterial({ color: 0x2a1208, emissive: 0xff4400, emissiveIntensity: 1.2, flatShading: true })); r.scale.setScalar(1.6); grp.add(r);
        g.add(new Projectile(g, { pos: h.clone(), vel: d.multiplyScalar(75), mesh: grp, gravity: 25, hitR: 1.8, spin: 4, life: 5,
          trail: (p) => { g.fx.spawn(p.x, p.y, p.z, 0, 0, 0, 0xff5a10, 2, 0.3, {}); g.smoke.spawn(p.x, p.y, p.z, 0, 2, 0, 0x201008, 2, 0.8, { grow: 1, alpha: 0.5 }); },
          onHit: (p) => { const R = g.aoe(50); explosion(g, p.setY(0), R, { core: 0xffe0a0, mid: 0xff3a00, ring: 0xff8a20, smoke: 0x241208, debris: 0x301a10, spikes: 6, shake: 10 });
            const hit = g.damageRadius(p, R, 18000 * fireMul(g), { burn: 3, lowHpBonus: true, skillHit: true }); hit.slice(0, 5).forEach((e: any) => orangeBolt(g, e));
            g.add(new Pit(g, p, R * 0.45, 10, 0xffa020, 0x6a0a00, (pit: Pit) => { const hs = g.damageRadius(pit.pos, pit.r, 3000, { burn: 3, noCharge: true, source: 'dot' }); if (hs.length) orangeBolt(g, hs[Math.floor(Math.random() * hs.length)]); }, 0.5, 0xffaa30)); } })); }); } },
  ],
};

import * as THREE from 'three';
import type { ItemDef } from '../types';
import { explosion, shockwave, Pit, fallingRock, Timed, Projectile, GEO, addMat, alphaMat, V, rnd, rndi, slashMesh } from '../effects';
import { cone, around, faceAim, knockFor, TargetPlanner } from './util';

function asteroidImpact(g: any, p: THREE.Vector3, r: number, tick: number, dmg: number) {
  const R = g.aoe(r);
  explosion(g, p, R, { core: 0xffc27a, mid: 0xff4a10, ring: 0xff8a3a, smoke: 0x2b2320, debris: 0x4a3a30, spikes: 10, shake: 20, debrisCount: 40 });
  shockwave(g, p, R * 1.15, 0.9, 0xffd9b0, 0.28);
  g.damageRadius(p, R, dmg, { knock: 5 });
  g.add(new Pit(g, p, R, 10, 0xff8a20, 0x4a0800, (pit: Pit) => g.damageRadius(pit.pos, pit.r, 0, { percentMax: tick, noCharge: true, source: 'dot' }), 0.5));
}

export const GRAVITY_FRUIT: ItemDef = {
  id: 'gravity', name: 'Gravity Fruit', type: 'fruit', color: '#a45cff', glyph: '◉',
  skills: [
    { name: 'Asteroid', cd: 2, info: '25m blast · 10s firepit 3%/tick', cast: (g) => { faceAim(g); g.anim('raise', 0.4); const t = g.aim.clone(); fallingRock(g, t, 7, 110, 0x3a2c25, 0xff5a1a, (p) => asteroidImpact(g, p, 25, 0.03, 25000), 200); } },
    { name: 'Gravitational Pressure', cd: 4, info: 'Pull all to arena center, +2%/unit (max 2000%)', cast: (g) => {
      const C = V(0, 0, 0); const caught = g.alive(); const n = caught.length;
      const mult = Math.min(20, 1 + 0.02 * n);
      const grp = new THREE.Group(); grp.position.set(0, 3, 0);
      const rings = [0, 1, 2].map(i => { const m = new THREE.Mesh(GEO.torus, addMat(0x9a4cff, 0.8)); m.rotation.x = i * 0.9; grp.add(m); return m; });
      const core = new THREE.Mesh(GEO.sphere, addMat(0x1a0030, 0.9)); grp.add(core);
      g.add(new Timed(g, grp, 1.6, (k, _t, dt) => {
        rings.forEach((r, i) => { r.scale.setScalar(20 * (1 - k) + 3); r.rotation.y += dt * (3 + i); r.rotation.z += dt * 2; });
        core.scale.setScalar(2 + k * 6);
        for (const e of caught) if (!e.dead) { e.pos.lerp(V(rnd(-3, 3), 0, rnd(-3, 3)), Math.min(1, dt * 4)); e.stun = Math.max(e.stun, 0.3); }
        for (let i = 0; i < 8; i++) { const a = Math.random() * 6.28, r = rnd(15, 40); g.fx.spawn(Math.cos(a) * r, rnd(0, 12), Math.sin(a) * r, -Math.cos(a) * r * 2, 0, -Math.sin(a) * r * 2, 0xb070ff, 0.8, 0.45, {}); }
      }));
      g.toast(`GRAVITATIONAL PRESSURE ×${(mult * 100).toFixed(0)}%`, '#b98cff');
      g.after(1.6, () => { const R = g.aoe(18 * mult); explosion(g, C, R, { core: 0xe0c0ff, mid: 0x7a20ff, ring: 0xc080ff, smoke: 0x1c1030, debris: 0x3a2a4a, shake: 30 }); shockwave(g, C, R * 1.2, 1.1, 0xd8b8ff, 0.35); g.damageRadius(C, R, 30000 * mult, { knock: 6 }); });
    } },
    { name: 'Gravitational Lightning', cd: 6.5, info: '8 bursts · 17m · 12% meteors', cast: (g) => {
      const P = g.player.pos.clone(); const grp = new THREE.Group(); grp.position.copy(P);
      const pillar = new THREE.Mesh(GEO.cyl, addMat(0x8a3cff, 0.55)); grp.add(pillar);
      const rings = Array.from({ length: 9 }, (_, i) => { const r = new THREE.Mesh(GEO.torus, addMat(0xc89bff, 0.9)); r.position.y = i * 4; grp.add(r); return r; });
      g.add(new Timed(g, grp, 1.4, (k) => { const rise = Math.min(1, k * 2.2); pillar.scale.set(2.2, 40 * rise, 2.2); (pillar.material as any).opacity = 0.55 * (1 - k);
        rings.forEach((r, i) => { r.position.y = i * 4.5 * rise; r.scale.setScalar(3 + Math.sin(k * 8 + i) * 0.5); (r.material as any).opacity = 0.9 * (1 - k); r.rotation.z += 0.05; }); }));
      g.every(0.25, 8, (b: number) => {
        const R = g.aoe(17); const c = g.player.pos; let tg = g.enemies.filter((e: any) => !e.dead && e.pos.distanceTo(c) < R);
        const pts = tg.length ? tg.map((e: any) => e.pos.clone()) : [around(c, R), around(c, R)];
        for (const p of pts) { g.strike(p.x, p.z, { color: 0xa050ff, core: 0xf0e0ff, width: 0.9, n: 3, h: 80 }); g.damageRadius(p, 3.5, 9000, { stun: 0.3 }); }
        if (Math.random() < 0.12) { const n = rndi(1, 5); for (let i = 0; i < n; i++) { const t = around(pts[0], 14); fallingRock(g, t, 1.4, 90, 0x3a2f45, 0xb060ff, (p) => { explosion(g, p, g.aoe(7), { core: 0xe0b0ff, mid: 0x8030ff, smoke: 0x221433, debris: 0x3b2b4b }); g.damageRadius(p, g.aoe(7), 7000); }, 120); } }
        if (b === 0) g.toast('GRAVITATIONAL LIGHTNING', '#c89bff');
      });
    } },
    { name: 'Pressure Dereliction', cd: 7.5, info: '7 homing zones ×3 blasts / 0.5s', cast: (g) => {
      const tgts = g.pickTargets(7, g.player.pos, 200);
      for (let i = 0; i < 7; i++) {
        const tg = tgts[i % Math.max(1, tgts.length)] ?? null; const pos = g.player.pos.clone().setY(2);
        const grp = new THREE.Group(); const sph = new THREE.Mesh(GEO.sphere, alphaMat(0x2a0850, 0.55)); const rim = new THREE.Mesh(GEO.torus, addMat(0xb070ff, 0.9)); grp.add(sph, rim);
        let booms = 0, bt = 0; const fixed = around(g.player.pos, 30);
        g.add(new Timed(g, grp, 2.6, (_k, t, dt) => {
          const aimP = tg && !tg.dead ? tg.pos : fixed;
          pos.lerp(V(aimP.x, 2, aimP.z), Math.min(1, dt * 6)); grp.position.copy(pos);
          const R = g.aoe(9); sph.scale.setScalar(R * (0.4 + 0.1 * Math.sin(t * 20))); rim.scale.setScalar(R * 0.6); rim.rotation.x += dt * 5; rim.rotation.y += dt * 3;
          if (t > 0.5) { bt += dt; if (bt >= 0.5 && booms < 3) { bt = 0; booms++; const p = pos.clone().setY(0); explosion(g, p, R, { core: 0xf4e2ff, mid: 0x6a10d0, ring: 0xa060ff, smoke: 0x1a0c2a, debris: 0x302040, debrisCount: 8, spikes: 0 }); g.damageRadius(p, R, 14000, { stun: 0.4 }); } }
          (sph.material as any).opacity = booms >= 3 ? 0 : 0.55;
        }));
      }
    } },
    { name: 'Asteroid Rain', cd: 10, info: '8 asteroids / 0.3s · 5%/tick pits', cast: (g) => { g.anim('raise', 0.5); g.every(0.3, 8, () => { const t = around(g.aim, 70); fallingRock(g, t, 7.5, 115, 0x33261f, 0xff6a20, (p) => asteroidImpact(g, p, 25, 0.05, 28000), 220, 0.5); }); } },
    { name: 'Gravitational Punch', cd: 10, info: 'Pull, charged punch · 10m knock · 4×4 bolts on land', cast: (g) => {
      faceAim(g); g.anim('charge', 0.8); g.player.lockMove = 1.0; const P = g.player;
      const orb = new THREE.Mesh(GEO.sphere, addMat(0x9a50ff, 0.8)); const grp = new THREE.Group(); grp.add(orb);
      g.add(new Timed(g, grp, 0.8, (k, _t, dt) => { grp.position.copy(g.handPos()); orb.scale.setScalar(0.3 + k * 1.6);
        const R = g.aoe(10) * 1.6; for (const e of g.enemies) if (!e.dead && e.pos.distanceTo(P.pos) < R) { e.pos.lerp(P.pos.clone().addScaledVector(P.facing, 3), Math.min(1, dt * 3)); e.stun = Math.max(e.stun, 0.3); }
        for (let i = 0; i < 6; i++) { const a = Math.random() * 6.28, r = rnd(4, 12); g.fx.spawn(P.pos.x + Math.cos(a) * r, rnd(0.5, 4), P.pos.z + Math.sin(a) * r, -Math.cos(a) * r * 3, 0, -Math.sin(a) * r * 3, 0xc090ff, 0.5, 0.3, {}); } }));
      g.after(0.8, () => {
        g.anim('punch', 0.25); const f = P.facing.clone(); const c = P.pos.clone().addScaledVector(f, 4);
        g.shake(P.pos, 55, 1.0);
        shockwave(g, c, g.aoe(14), 0.6, 0xe8d8ff, 0.4);
        explosion(g, c, g.aoe(8), { core: 0xffffff, mid: 0x9a40ff, ring: 0xd0a0ff, smoke: 0x201030, debris: 0x40305a, noFlash: false, spikes: 6, shake: 1 });
        const hit = cone(g, g.aoe(10), 45000, { knock: knockFor(10), knockUp: 11, stun: 1 }, 0);
        for (const e of hit) e.onLand = (en: any) => { g.every(0.5, 4, () => { if (!en.dead || true) { const p = en.pos.clone(); for (let r = 0; r < 4; r++) g.strike(p.x + rnd(-1, 1), p.z + rnd(-1, 1), { color: 0xb060ff, core: 0xffffff, width: 1.2, n: 1, h: 90 }); g.damageRadius(p, 5, 12000, { stun: 0.5 }); } }); };
      });
    } },
  ],
};

export const GRAVITY_BLADE: ItemDef = {
  id: 'gblade', name: 'Gravity Blade', type: 'sword', color: '#8a5bff', glyph: '⚔',
  m1: { interval: 0.2, combo: 4, endLag: 0.4, onHit: (g, combo) => {
    faceAim(g); g.slashFx(0xa070ff, 3.2, 1.8, combo % 2 ? 0.6 : -0.6);
    cone(g, 7, 3500, {});
    if (combo === 4) { const c = g.player.pos.clone().addScaledVector(g.player.facing, 6); const n = rndi(6, 24);
      for (let i = 0; i < n; i++) { const p = around(c, 6); g.strike(p.x, p.z, { color: 0x9a5cff, core: 0xeeddff, width: 0.4, n: 1, h: rnd(18, 32), life: 0.3 }); g.damageRadius(p, 2.5, 1800, {}); } }
  } },
  skills: [
    { name: 'Superforce Lightning Gravitational of Force', cd: 3, info: 'Uses charge · instakill chance by range', cdMul: (g) => (g.lightningCharge <= 0 ? 0.5 : 1), cast: (g) => {
      faceAim(g); g.anim('raise', 1); g.player.lockMove = 1;
      const glow = new THREE.Mesh(GEO.sphere, addMat(0xd0b0ff, 0.9)); const grp = new THREE.Group(); grp.add(glow);
      g.add(new Timed(g, grp, 1, (k) => { grp.position.copy(g.handPos()).y += 1.2; glow.scale.setScalar(0.4 + k * 1.2 + Math.random() * 0.3); const h = grp.position; g.fx.spawn(h.x, h.y, h.z, rnd(-4, 4), rnd(-4, 4), rnd(-4, 4), 0xc8a0ff, 0.4, 0.3, {}); }));
      g.after(1, () => {
        const ch = g.lightningCharge; const tgt = g.nearest(g.aim, 30); const p = tgt ? tgt.pos.clone().setY(0) : g.aim.clone();
        const R = g.aoe(10 + ch * 0.25); let dmg = 4000 + ch * 900; const max = ch >= 100; let mega = false;
        if (max && Math.random() < 0.42) { dmg *= 20; mega = true; }
        const w = 1.2 + ch * 0.035;
        g.strike(p.x, p.z, { color: mega ? 0xff70ff : 0x9a60ff, core: 0xffffff, width: w, n: 5 + Math.floor(ch / 20), h: 160, life: 0.7, branches: 8, spread: 1.5 });
        explosion(g, p, R, { core: 0xffffff, mid: 0x8040ff, ring: 0xc090ff, smoke: 0x1c1030, debris: 0x302040, shake: 20 + ch * 0.2 });
        for (const e of g.enemies) {
          if (e.dead) continue; const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z); if (d > R) continue;
          const chance = Math.max(0, 1 - d / R); // lightningRangeFromBolt%
          if (Math.random() < chance) { if (e.kind === 'normal') { g.damage(e, 0, { percentMax: 1.01, blind: 10, noCharge: true }); } else g.damage(e, dmg, { percentMax: 0.5, blind: 10, noCharge: true }); }
          else g.damage(e, dmg, { blind: 10, noCharge: true });
        }
        g.lightningCharge = Math.max(0, ch - 10);
        g.toast(mega ? 'MAX CHARGE ×20 SUPERFORCE!' : `SUPERFORCE (${ch.toFixed(0)}% charge)`, mega ? '#ff80ff' : '#b59aff');
      });
    } },
    { name: 'Rainy Meteors', cd: 5, info: '80 meteors · 130m/s · 12m', cast: (g) => { g.anim('raise', 0.4); g.every(0.06, 80, () => { const t = around(g.aim, 40); fallingRock(g, t, 1.2, 130, 0x2e2a36, 0x8a60ff, (p) => { explosion(g, p, g.aoe(12), { core: 0xf0d8ff, mid: 0x6a3aff, ring: 0x9a70ff, smoke: 0x1d1a28, debris: 0x383048, debrisCount: 6, smokeCount: 6, shake: 3 }); g.damageRadius(p, g.aoe(12), 5000); }, 150, 0.45); }); } },
    { name: 'Rocks Extinction', cd: 7, info: '26 rocks rise 1.2s → slam targets / 0.15s · 24m', cast: (g) => {
      g.anim('raise', 1.2); const rocks: { m: THREE.Mesh; off: THREE.Vector3; h: number }[] = []; const grp = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.95, flatShading: true, emissive: 0x2a1040 });
      for (let i = 0; i < 26; i++) { const m = new THREE.Mesh(GEO.rock, mat); m.scale.setScalar(rnd(1.5, 3)); m.castShadow = true; grp.add(m); rocks.push({ m, off: V(rnd(-22, 22), 0, rnd(-22, 22)), h: rnd(10, 22) }); }
      const planner = new TargetPlanner(); let fired = 0, ft = 0;
      g.add(new Timed(g, grp, 1.2 + 26 * 0.15 + 0.2, (_k, t, dt) => {
        const P = g.player.pos;
        rocks.forEach((r, _i) => { if (!r.m.visible) return; const rise = Math.min(1, t / 1.2); r.m.position.set(P.x + r.off.x, r.h * (1 - Math.pow(1 - rise, 3)), P.z + r.off.z); r.m.rotation.x += dt; r.m.rotation.y += dt * 1.3;
          if (t < 1.2 && Math.random() < 0.3) g.debris.spawn(r.m.position.x, 0.5, r.m.position.z, rnd(-3, 3), rnd(4, 9), rnd(-3, 3), 0.3, 0x4a4038, 1.5); });
        if (t > 1.2) { ft += dt; while (ft >= 0.15 && fired < 26) { ft -= 0.15; const r = rocks[fired++]; r.m.visible = false; const from = r.m.position.clone();
          const e = planner.pick(g, P, 250, 22000); const tp = e ? e.pos.clone().setY(0) : around(P, 40);
          const pm = new THREE.Mesh(GEO.rock, mat); pm.userData.shared = true; pm.scale.copy(r.m.scale);
          g.add(new Projectile(g, { pos: from, vel: tp.clone().sub(from).normalize().multiplyScalar(110), mesh: pm, homing: () => (e && !e.dead ? e.pos : tp), turn: 10, hitEnemies: false, spin: 5, life: 5,
            onHit: (hp) => { const R = g.aoe(24); explosion(g, hp.setY(0), R, { core: 0xffd9a0, mid: 0xb04aff, ring: 0xff9a50, smoke: 0x2a2020, debris: 0x4a4038, spikes: 6, shake: 12 }); g.damageRadius(hp, R, 22000, { knock: 4 }); },
            trail: (p) => g.smoke.spawn(p.x, p.y, p.z, 0, 1, 0, 0x3a3030, 2.5, 0.8, { grow: 1, alpha: 0.5 }) })); } }
      }));
    } },
    { name: 'Death Slashes', cd: 3, info: '23 auto-aim slashes · 22% ×26 mega', cast: (g) => {
      faceAim(g); const planner = new TargetPlanner();
      g.every(0.15, 23, () => {
        const mega = Math.random() < 0.22; const dmg = 6000 * (mega ? 26 : 1); const speed = mega ? 930 : 186;
        const e = planner.pick(g, g.player.pos, 400, dmg * 2); const P = g.player.pos.clone().setY(1.5);
        const tp = e ? e.pos.clone().setY(1) : g.aim.clone().setY(1);
        const m = slashMesh(mega ? 0xff60ff : 0xb080ff, mega ? 6 : 3.5); const grp = new THREE.Group(); grp.add(m); m.rotation.z = rnd(-1, 1) + Math.PI / 4; m.rotation.x = Math.PI / 2;
        g.anim('slash', 0.12); g.slashFx(0xc0a0ff, 2.5, 1.5, rnd(-1, 1));
        const onHit = (hp: THREE.Vector3) => {
          const R = g.aoe(5 * (mega ? 26 : 1));
          explosion(g, hp.setY(0), R, { core: 0xffffff, mid: mega ? 0xff30d0 : 0x8a40ff, ring: 0xd090ff, smoke: 0x1a1025, debris: 0x302040, shake: (mega ? 3 : 1) * Math.min(25, 2 + R * 0.12), spikes: mega ? 10 : 3 });
          g.strike(hp.x, hp.z, { color: 0xb070ff, core: 0xffffff, width: mega ? 2 : 0.8, n: mega ? 3 : 1, h: 70 });
          g.damageRadius(hp, R, dmg, { crit: true, stun: 2, burn: 10, burnDps: (dmg * 2 * 0.27) / 10 });
          if (mega) g.toast('MEGA DEATH SLASH ×2600%', '#ff80ff');
        };
        g.add(new Projectile(g, { pos: P, vel: tp.clone().sub(P).normalize().multiplyScalar(speed), mesh: grp, homing: () => (e && !e.dead ? e.pos.clone().setY(1) : null), turn: 20, hitR: mega ? 3 : 1.8, hitGround: false, life: 3,
          onHit: (hp) => onHit(hp), trail: (p, _dt, self) => { grp.lookAt(p.clone().add(self.o.vel)); g.fx.spawn(p.x, p.y, p.z, 0, 0, 0, mega ? 0xff60ff : 0xa070ff, mega ? 2.5 : 1.2, 0.2, {}); } }));
      });
    } },
    { name: 'Super Slashes', cd: 4, info: 'Slash storm /0.01s · 50m · 3s · bleed stacks', cast: (g) => {
      g.toast('SUPER SLASHES', '#c9a2ff');
      g.every(0.01, 300, (i: number) => {
        const R = g.aoe(50); const p = around(g.player.pos, R); p.y = rnd(0.5, 4);
        const m = slashMesh(i % 3 ? 0xa070ff : 0xffffff, rnd(4, 8)); m.rotation.set(rnd(0, 6.28), rnd(0, 6.28), rnd(0, 6.28)); const grp = new THREE.Group(); grp.add(m); grp.position.copy(p);
        const s0 = m.scale.x; g.add(new Timed(g, grp, 0.16, (k) => { m.scale.setScalar(s0 * (0.6 + k * 0.6)); (m.material as any).opacity = 0.9 * (1 - k); m.rotateZ(0.35); }));
        const dmg = 2200; g.damageRadius(p.setY(0), 5, dmg, { bleed: 5, bleedDps: dmg * 0.01, noCharge: i % 4 !== 0 });
        if (i % 6 === 0) g.shake(g.player.pos, 3, 0.1);
      });
    } },
  ],
};

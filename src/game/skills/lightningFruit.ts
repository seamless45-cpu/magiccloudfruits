import * as THREE from 'three';
import type { ItemDef } from '../types';
import { explosion, shockwave, Timed, Projectile, GEO, addMat, alphaMat, V, rnd } from '../effects';
import { cone, around, faceAim } from './util';

const Y = 0xffe14a, CY = 0x7fe8ff;
let ball: { grp: THREE.Group; charge: number; acc: number; t: number } | null = null;
let cont: { t: number; acc: number; ring: THREE.Mesh } | null = null;

export const LIGHTNING_FRUIT: ItemDef = {
  id: 'lightning', name: 'Lightning Fruit', type: 'fruit', color: '#ffe14a', glyph: 'ϟ',
  skills: [
    { name: 'Bestia Relámpago', cd: 5, info: 'Auto-aim beast · 30m/s · 30m blast', cast: (g) => {
      faceAim(g); g.anim('punch', 0.3); const tg = g.autoAim(250); const P = g.handPos();
      const grp = new THREE.Group();
      const head = new THREE.Mesh(new THREE.ConeGeometry(1.4, 4.5, 6).rotateX(Math.PI / 2), addMat(0xfff4a0, 0.9)); const aura = new THREE.Mesh(GEO.sphere, addMat(Y, 0.35)); aura.scale.set(2.6, 2.2, 3.6);
      const e1 = new THREE.Mesh(GEO.sphereLo, addMat(0xffffff, 1)); e1.scale.setScalar(0.3); e1.position.set(0.6, 0.6, 1); const e2 = e1.clone(); e2.position.x = -0.6;
      const ear1 = new THREE.Mesh(GEO.cone, addMat(Y, 0.9)); ear1.scale.set(0.4, 1.6, 0.4); ear1.position.set(0.8, 1, -0.6); const ear2 = ear1.clone(); ear2.position.x = -0.8;
      grp.add(head, aura, e1, e2, ear1, ear2);
      const dir = (tg ? tg.pos.clone().setY(1.5) : g.aim.clone().setY(1.5)).sub(P).normalize();
      g.add(new Projectile(g, { pos: P.clone(), vel: dir.multiplyScalar(30), mesh: grp, homing: () => (tg && !tg.dead ? tg.pos.clone().setY(1.5) : null), turn: 4, hitR: 2.5, life: 10,
        onHit: (hp) => { const R = g.aoe(30); explosion(g, hp.setY(0), R, { core: 0xfffbe0, mid: Y, ring: CY, smoke: 0x2a2a30, debris: 0x55504a, spikes: 12, shake: 22 }); for (let i = 0; i < 8; i++) { const p = around(hp, R * 0.7); g.strike(p.x, p.z, { color: Y, core: 0xffffff, width: 0.8, h: 60 }); } g.damageRadius(hp, R, 30000, { stun: 1 }); },
        trail: (p, _dt, self) => { grp.lookAt(p.clone().add(self.o.vel)); aura.scale.set(2.6 + Math.random() * 0.5, 2.2 + Math.random() * 0.5, 3.6); g.fx.spawn(p.x + rnd(-1, 1), p.y + rnd(-1, 1), p.z + rnd(-1, 1), 0, 0, 0, Y, 1.2, 0.3, {});
          if (Math.random() < 0.5) g.bolt(p.clone(), p.clone().add(V(rnd(-4, 4), rnd(-3, 3), rnd(-4, 4))), { color: Y, width: 0.2, life: 0.12, segs: 8, branches: 1 }); } }));
    } },
    { name: 'Tormenta', cd: 8, info: '17 bolts / 0.22s · 4.5m', cast: (g) => { g.anim('raise', 0.5); const c = g.aim.clone(); g.every(0.22, 17, () => { const p = around(c, 30); const R = g.aoe(4.5); g.strike(p.x, p.z, { color: CY, core: 0xffffff, width: 0.9, n: 3, h: 95 }); explosion(g, p, R, { core: 0xffffff, mid: CY, ring: Y, smoke: 0x2a2f38, debris: 0x4a4a50, debrisCount: 4, smokeCount: 4, shake: 4 }); g.damageRadius(p, R, 11000, { stun: 0.3 }); }); } },
    { name: 'Juicio Celestial', cd: 12, info: 'Bolt barrage 7m · lift+stun 3s', cast: (g) => { g.anim('raise', 1.5); const c = g.aim.clone(); const R = g.aoe(7);
      const col = new THREE.Mesh(GEO.cyl, addMat(0xfff2a0, 0.25)); const grp = new THREE.Group(); grp.add(col); grp.position.copy(c);
      g.add(new Timed(g, grp, 1.8, (k) => { col.scale.set(R, 120, R); (col.material as any).opacity = 0.25 * (1 - k); }));
      g.every(0.05, 32, (i: number) => { const p = around(c, R); g.strike(p.x, p.z, { color: i % 2 ? Y : 0xfff6c0, core: 0xffffff, width: 1.1, n: 2, h: 130, life: 0.3 }); g.damageRadius(c, R, 6000, { lift: 3, stun: 3 }); if (i % 8 === 0) shockwave(g, c, R * 1.4, 0.4, 0xfff6c0, 0.3); g.shake(c, 6, 0.1); });
    } },
    { name: 'Destrucción de Bola de Trueno', cd: 20, info: 'HOLD to charge (+5%/0.05s) · release', holdStart: (g) => {
      const grp = new THREE.Group(); const core = new THREE.Mesh(GEO.sphere, new THREE.MeshStandardMaterial({ color: 0x050508, roughness: 0.3, metalness: 0.8, emissive: 0x110022 })); const aura = new THREE.Mesh(GEO.sphere, addMat(0x8a6aff, 0.3));
      const clouds = new THREE.Group(); for (let i = 0; i < 14; i++) { const c = new THREE.Mesh(GEO.sphereLo, new THREE.MeshStandardMaterial({ color: 0x1c1c24, roughness: 1, transparent: true, opacity: 0.9 })); const a = (i / 14) * 6.28; c.position.set(Math.cos(a) * 18, 10 + rnd(-2, 2), Math.sin(a) * 18); c.scale.setScalar(rnd(6, 9)); clouds.add(c); }
      grp.add(core, aura, clouds); g.scene.add(grp); ball = { grp, charge: 0, acc: 0, t: 0 }; g.anim('raise', 99);
    }, holdTick: (g, dt) => {
      if (!ball) return false; ball.acc += dt; ball.t += dt;
      while (ball.acc >= 0.05) { ball.acc -= 0.05; ball.charge = Math.min(100, ball.charge + 5); }
      const P = g.player.pos; const s = 3 + ball.charge * 0.22; ball.grp.position.set(P.x, 45 + s, P.z);
      const [core, aura, clouds] = ball.grp.children as any; core.scale.setScalar(s); aura.scale.setScalar(s * 1.3 + Math.random()); clouds.rotation.y += dt * 0.6;
      if (Math.random() < 0.7) { const a = ball.grp.position.clone(); g.bolt(a.clone().add(V(rnd(-s, s), rnd(-s, s), rnd(-s, s))), a.clone().add(V(rnd(-s, s) * 2, rnd(-s, s) * 2, rnd(-s, s) * 2)), { color: 0x9a80ff, width: 0.35, life: 0.12, segs: 10, branches: 1 }); }
      g.ui_charge = ball.charge;
    }, holdEnd: (g) => {
      if (!ball) return; const b = ball; ball = null; g.ui_charge = 0; g.anim('punch', 0.3);
      const tgt = g.aim.clone(); const from = b.grp.position.clone(); const s = 3 + b.charge * 0.22; const mesh = b.grp.children[0] as THREE.Mesh; const clouds = b.grp.children[2];
      b.grp.remove(mesh); g.scene.remove(b.grp);
      const cl = new THREE.Group(); cl.add(clouds); g.add(new Timed(g, cl, 3, (k) => { clouds.children.forEach((c: any) => c.material.opacity = 0.9 * (1 - k)); }));
      cl.position.copy(from);
      const grp = new THREE.Group(); grp.add(mesh);
      g.add(new Projectile(g, { pos: from, vel: tgt.clone().sub(from).normalize().multiplyScalar(50), mesh: grp, hitEnemies: false, life: 20,
        trail: (p) => { g.fx.spawn(p.x + rnd(-s, s), p.y + rnd(-s, s), p.z + rnd(-s, s), 0, 3, 0, 0x8a70ff, s * 0.3, 0.3, {}); },
        onHit: (hp) => {
          const c = hp.setY(0); const mul = 0.4 + b.charge / 100 * 1.6; g.shake(c, 35, 1);
          const dome = new THREE.Mesh(GEO.dome, alphaMat(0x120820, 0.7)); const shell = new THREE.Mesh(GEO.sphere, addMat(0x7a5aff, 0.35)); const G2 = new THREE.Group(); G2.add(dome, shell); G2.position.copy(c);
          let dt2 = 0;
          g.add(new Timed(g, G2, 5, (k, t, dt) => {
            const R = g.aoe(s + 15 * t); dome.scale.setScalar(R); shell.scale.set(R * 1.02, R * 0.5, R * 1.02); (dome.material as any).opacity = 0.7 * (1 - k * k); (shell.material as any).opacity = 0.35 * (1 - k);
            if (Math.random() < 0.8) { const a = Math.random() * 6.28; g.bolt(c.clone().setY(R * 0.4), V(c.x + Math.cos(a) * R, 0.2, c.z + Math.sin(a) * R), { color: 0xb49aff, width: 0.6, life: 0.15, segs: 14 }); }
            dt2 += dt; if (dt2 >= 0.2) { dt2 = 0; g.damageRadius(c, R, 9000 * mul, { stun: 0.4 }); }
          }));
          explosion(g, c, g.aoe(s * 2), { core: 0xe8e0ff, mid: 0x5a30c0, ring: 0x9a80ff, smoke: 0x0c0814, debris: 0x2a2530, spikes: 14, shake: 30 });
        } }));
    } },
    { name: 'Destello Eléctrico', cd: 1, charges: { max: 3, regen: 3 }, info: 'Dash 10m @240m/s · 3 charges', cast: (g) => {
      const P = g.player; const dir = P.facing.clone(); const start = P.pos.clone(); const dist = 10; const dur = dist / 240; const hit = new Set<any>();
      P.invincible = Math.max(P.invincible, dur + 0.1);
      g.add(new Timed(g, new THREE.Group(), dur, (k) => {
        P.pos.copy(start).addScaledVector(dir, dist * k);
        for (const e of g.enemies) if (!e.dead && !hit.has(e) && e.pos.distanceTo(P.pos) < 2.5 + e.radius) { hit.add(e); g.damage(e, 9000, { stun: 0.5 }); g.strike(e.pos.x, e.pos.z, { color: Y, width: 0.5, h: 25 }); }
      }));
      const end = start.clone().addScaledVector(dir, dist);
      for (let i = 0; i < 3; i++) g.bolt(start.clone().setY(1 + i * 0.3), end.clone().setY(1 + i * 0.3), { color: Y, core: 0xffffff, width: 0.35, life: 0.25, segs: 12, jag: 0.08, branches: 2 });
      for (let i = 0; i < 20; i++) { const p = start.clone().lerp(end, Math.random()); g.fx.spawn(p.x, rnd(0.5, 2), p.z, rnd(-2, 2), rnd(0, 3), rnd(-2, 2), Y, 0.5, 0.4, {}); }
    } },
    { name: 'Más Allá del Trueno', cd: 30, info: '120 thunderclouds · 16m · stun 3s', cast: (g) => {
      g.anim('raise', 1); g.toast('MÁS ALLÁ DEL TRUENO', '#ffe14a'); const C = g.player.pos.clone();
      const N = 120, PUFF = 5; const im = new THREE.InstancedMesh(GEO.sphereLo, new THREE.MeshStandardMaterial({ color: 0x23232d, roughness: 1, transparent: true, opacity: 0.95, emissive: 0x0a0a14 }), N * PUFF);
      const cps: THREE.Vector3[] = []; const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      for (let i = 0; i < N; i++) { const p = around(C, 190); p.y = rnd(70, 95); cps.push(p); }
      const grp = new THREE.Group(); grp.add(im); im.frustumCulled = false;
      const offs = Array.from({ length: N * PUFF }, () => V(rnd(-9, 9), rnd(-2, 3), rnd(-9, 9)));
      g.add(new Timed(g, grp, 0.1 * N + 3, (_k, t) => {
        const f = Math.min(1, t / 1.2) * Math.min(1, (0.1 * N + 3 - t) / 1.5);
        for (let i = 0; i < N * PUFF; i++) { const c = cps[Math.floor(i / PUFF)]; sc.setScalar(rnd(5.8, 6.2) * f + 0.001); m.compose(c.clone().add(offs[i]), q, sc); im.setMatrixAt(i, m); }
        im.instanceMatrix.needsUpdate = true;
      }));
      g.after(1, () => g.every(0.1, N, (i: number) => { const c = cps[i]; const p = V(c.x + rnd(-5, 5), 0, c.z + rnd(-5, 5)); const R = g.aoe(16);
        for (let n = 0; n < 3; n++) g.bolt(V(c.x + rnd(-4, 4), c.y - 3, c.z + rnd(-4, 4)), V(p.x + rnd(-0.6, 0.6), 0.1, p.z + rnd(-0.6, 0.6)), { color: Y, core: 0xffffff, width: 1, life: 0.35, segs: 18, jag: 0.04, branches: 2 });
        explosion(g, p, R, { core: 0xfffbe0, mid: 0xffc020, ring: Y, smoke: 0x2a2a30, debris: 0x4a4a45, debrisCount: 6, smokeCount: 5, shake: 6 }); g.damageRadius(p, R, 12000, { stun: 3 }); }));
    } },
  ],
};

export const POLE: ItemDef = {
  id: 'pole', name: 'Pole (Thunder)', type: 'sword', color: '#ffd23a', glyph: '⟊',
  m1: { interval: 0.1, combo: 4, onHit: (g, combo) => {
    faceAim(g);
    if (combo < 4) { g.slashFx(0xffe070, 3, 2, combo === 2 ? 0.5 : -0.5); cone(g, 7, 2800); }
    else { const tg = g.nearest(g.player.pos.clone().addScaledVector(g.player.facing, 6), 10); const p = tg ? tg.pos.clone() : g.player.pos.clone().addScaledVector(g.player.facing, 6);
      g.strike(p.x, p.z, { color: Y, core: 0xffffff, width: 0.45, h: 30, life: 0.3 }); g.damageRadius(p, 3, 6000, { stun: 0.3 }); }
  } },
  skills: [
    { name: 'Asalto Atronador', cd: 3, info: 'Cloud flies 1s then detonates · 2m', cast: (g) => {
      faceAim(g); g.anim('punch', 0.3); const grp = new THREE.Group();
      for (let i = 0; i < 6; i++) { const c = new THREE.Mesh(GEO.sphereLo, new THREE.MeshStandardMaterial({ color: 0x3a3a46, roughness: 1, emissive: 0x1a1a10 })); c.position.set(rnd(-1.2, 1.2), rnd(-0.4, 0.4), rnd(-1.2, 1.2)); c.scale.setScalar(rnd(0.8, 1.3)); grp.add(c); }
      const pos = g.handPos(); const vel = g.player.facing.clone().multiplyScalar(26); grp.position.copy(pos);
      let et = 0;
      g.add(new Timed(g, grp, 3, (k, t, dt) => {
        if (t < 1) { pos.addScaledVector(vel, dt); grp.position.copy(pos); if (Math.random() < 0.4) g.bolt(pos.clone(), pos.clone().add(V(rnd(-2, 2), rnd(-2, 0), rnd(-2, 2))), { color: Y, width: 0.15, life: 0.1, segs: 6, branches: 0 }); }
        else { et += dt; grp.scale.setScalar(1 + Math.sin(t * 40) * 0.1); while (et >= 0.1) { et -= 0.1; const p = pos.clone().add(V(rnd(-1.5, 1.5), 0, rnd(-1.5, 1.5))); const R = g.aoe(2);
          explosion(g, p, R, { core: 0xffffff, mid: Y, ring: 0xfff0a0, smoke: 0x303038, debrisCount: 2, smokeCount: 3, shake: 3 }); g.bolt(pos.clone(), V(p.x, 0.1, p.z), { color: Y, width: 0.3, life: 0.15, segs: 10 }); g.damageRadius(V(p.x, 0, p.z), R + 1, 4000, { stun: 0.3 }); } }
        grp.children.forEach((c: any) => c.material.opacity = 1); if (k > 0.9) grp.scale.setScalar((1 - k) * 10);
      }));
    } },
    { name: 'Juicio Continuo', cd: 10, info: 'HOLD · 1% HP per strike · stops <50% HP', holdStart: (g) => {
      const ring = new THREE.Mesh(GEO.ring, addMat(Y, 0.7)); g.scene.add(ring); cont = { t: 0, acc: 0, ring }; g.anim('raise', 99);
    }, holdTick: (g, dt) => {
      if (!cont) return false; const P = g.player; if (P.hp - P.maxHp * 0.01 < P.maxHp * 0.5) return false;
      cont.t += dt; cont.acc += dt; const buff = Math.min(0.5, 0.05 * cont.t); const R = g.aoe(8 * (1 + buff)); const suck = g.aoe(9 * (1 + buff)); const c = g.aim.clone();
      cont.ring.position.set(c.x, 0.1, c.z); cont.ring.scale.setScalar(R);
      for (const e of g.enemies) { if (e.dead) continue; const d = e.pos.distanceTo(c); if (d < suck + R && d > 0.5) e.pos.lerp(V(c.x, e.pos.y, c.z), Math.min(1, dt * 3)); }
      while (cont.acc >= 0.1) { cont.acc -= 0.1; P.hp -= P.maxHp * 0.01; const p = around(c, R * 0.6); g.strike(p.x, p.z, { color: Y, core: 0xffffff, width: 1.2 + buff * 2, n: 2, h: 120, life: 0.25 }); g.damageRadius(c, R, 8000, { stun: 0.3, noCharge: true }); g.shake(c, 5, 0.1); }
    }, holdEnd: (g) => { if (cont) { g.scene.remove(cont.ring); (cont.ring.material as any).dispose(); cont = null; } } },
  ],
};

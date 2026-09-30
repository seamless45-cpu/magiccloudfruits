import * as THREE from 'three';
import type { ItemDef } from '../types';
import { explosion, Timed, Projectile, GEO, V, rnd } from '../effects';
import { StormCloud, Tornado, Hurricane, Flood, Microburst } from '../weather';
import { cone, around, faceAim } from './util';

const puffMat = () => new THREE.MeshStandardMaterial({ color: 0xf4f6fa, roughness: 1, emissive: 0x20242c });
export const SUPERCELL_TYPES = [
  { id: 'LP', name: 'LP Supercell', size: 300, rain: 0.3, rainDmg: 90, hail: 1.2, bolts: 0.9, cd: 1 / 2.5, dmg: 0.5, color: 0xe4e8ee, shade: 1.05 },
  { id: 'N', name: 'Normal Supercell', size: 500, rain: 1.1, rainDmg: 220, hail: 2.5, bolts: 1.4, cd: 1, dmg: 1, color: 0xd4d9e0, shade: 0.85 },
  { id: 'HP', name: 'HP Supercell', size: 700, rain: 2.4, rainDmg: 480, hail: 4, bolts: 2, cd: 2.5, dmg: 2.2, color: 0xb5bcc6, shade: 0.62 },
];

export const CLOUD_FRUIT: ItemDef = {
  id: 'cloud', name: 'Cloud Fruit', type: 'fruit', color: '#dfe8f5', glyph: '☁',
  m1: { interval: 0.05, combo: 4, onHit: (g, combo) => {
    faceAim(g); const P = g.player; const h = g.handPos();
    const wind = g.windAt(h), forwardSpeed = 4 + wind.length() * 0.22;
    for (let i = 0; i < 4; i++) g.smoke.spawn(h.x, h.y, h.z,
      P.facing.x * forwardSpeed + wind.x * 0.7 + rnd(-0.8, 0.8), rnd(-1, 2),
      P.facing.z * forwardSpeed + wind.z * 0.7 + rnd(-0.8, 0.8), 0xf4f6fa, rnd(0.8, 1.6), 0.8,
      { alpha: 0.7, grow: 1.5, drag: 0.3, windX: wind.x, windZ: wind.z, windResponse: 2.2, windDynamic: true });
    cone(g, 6, 1500);
    if (combo === 4) {
      const tg = g.autoAim(150); const grp = new THREE.Group(); const mat = puffMat();
      for (let i = 0; i < 5; i++) { const c = new THREE.Mesh(GEO.sphereLo, mat); c.position.set(rnd(-0.8, 0.8), rnd(-0.3, 0.4), rnd(-0.8, 0.8)); c.scale.setScalar(rnd(0.6, 1)); grp.add(c); }
      const to = tg ? tg.pos.clone().setY(1.5) : g.aim.clone().setY(1.5);
      g.add(new Projectile(g, { pos: h.clone(), vel: to.clone().sub(h).normalize().multiplyScalar(45), mesh: grp, homing: () => (tg && !tg.dead ? tg.pos.clone().setY(1.5) : null), turn: 8, hitR: 1.6, life: 4,
        trail: (p) => { const w = g.windAt(p); g.smoke.spawn(p.x, p.y, p.z, w.x * 0.35, 0, w.z * 0.35, 0xeef2f8, 1.2, 0.5, { alpha: 0.5, grow: 1, windX: w.x, windZ: w.z, windResponse: 1.6, windDynamic: true }); },
        onHit: (p) => { const R = g.aoe(6); explosion(g, p.setY(0), R, { core: 0xffffff, mid: 0xcfe0ff, ring: 0xffffff, smoke: 0xe8ecf2, debrisCount: 2, shake: 2 }); g.damageRadius(p, R, 6000, {});
          if (Math.random() < 0.1) { g.add(new StormCloud(g, { pos: p.clone(), kind: 'stratus', size: 34, life: 3.5, grow: 0.3, rain: 0.45, rainDmg: 60, rainColor: 0xe8ecf2 })); g.toast('STRATUS DRIZZLE', '#dfe8f5'); } } }));
    }
  } },
  skills: [
    { name: 'Cumulus Growth', cd: 5, info: '10s growth humilis→Cb · 35% supercell · 2min', cast: (g) => {
      for (let i = 0; i < 3; i++) { const p = around(g.player.pos, 220); g.add(new StormCloud(g, { pos: p, kind: 'cumulus', size: rnd(260, 380), life: 120, grow: 10, rain: 0.8, rainDmg: 260, supercellChance: 0.35, boltDmg: 9000, hailDmg: 22000, hailShatter: 0.6, hailShatterDmg: 0.4 })); }
      g.toast('CUMULUS GROWTH', '#e6eef8');
    } },
    { name: 'Atmospheric Instability', cd: 5, info: 'Elevated squall shelf 2.6×0.9km · 10m/s · 120mph', cast: (g) => {
      const f = g.player.facing.clone(); const p = g.player.pos.clone().addScaledVector(f, -320);
      g.add(new StormCloud(g, { pos: p, kind: 'squall', size: 1000, length: 2600, depth: 900, bow: 0.1, life: 120, grow: 1.8, vel: f.clone().multiplyScalar(10), rain: 1.4, rainDmg: 200, wind: 120, windDmg: 3500, bolts: 0.9, boltDmg: 9000, superChance: 0.1, superMul: 3, superName: 'SUPERBOLT', shade: 0.9 }));
      g.toast('SQUALL LINE APPROACHING', '#cfd8e6');
    } },
    { name: 'Hailstorm', cd: 5, info: '4 Cb 280m · golf-ball hail · 8s', cast: (g) => {
      for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.28 + 0.6; const p = g.aim.clone().add(V(Math.cos(a) * 130, 0, Math.sin(a) * 130));
        g.add(new StormCloud(g, { pos: p, kind: 'hail', size: 280, life: 8, grow: 1.2, rain: 0.9, rainDmg: 150, hail: 6, hailDmg: 16000, hailShatter: 0.5, hailShatterDmg: 0.3, bolts: 0.8, boltDmg: 8000, shade: 0.75, rainColor: 0xd0d6de })); }
    } },
    { name: 'Derecho Swarm', cd: 5, info: '4 elevated derechos 3.2×1.4km · 24m/s · 105mph gusts', cast: (g) => {
      const c = g.player.pos.clone(); const dirs = [V(1, 0, 0), V(-1, 0, 0), V(0, 0, 1), V(0, 0, -1)];
      for (const d of dirs) { const start = c.clone().addScaledVector(d, 24 * 15); g.add(new StormCloud(g, { pos: start, kind: 'derecho', size: 1400, length: 3200, depth: 1400, bow: 0.3, life: 30, grow: 1.8, vel: d.clone().multiplyScalar(-24), rain: 1.6, rainDmg: 300, wind: 105, windDmg: 7000, bolts: 1.2, boltDmg: 10000, shade: 0.78 })); }
      g.toast('DERECHO SWARM', '#b9c6d8');
    } },
    { name: 'Tornado Destruction', cd: 5, info: 'Supercell 350m · 200mph tornado · 10s', cast: (g) => {
      const cl = new StormCloud(g, { pos: g.aim.clone(), kind: 'supercell', size: 350, life: 13, grow: 1.5, rain: 0.8, rainDmg: 150, bolts: 0.8, boltDmg: 9000, shade: 0.7, spin: 0.25 }); g.add(cl);
      g.after(1.5, () => g.add(new Tornado(g, cl, 9, 200, 10, undefined, 7000)));
      g.toast('TORNADO WARNING', '#ff9a5a');
    } },
    { name: 'Hurricane Storm', cd: 5, info: 'Warm-up 1s (invincible) · 25km · Category 5 · 165mph · 5min', cast: (g) => {
      const P = g.player; P.invincible = Math.max(P.invincible, 1.1); g.anim('raise', 1); P.lockMove = 1;
      g.add(new Timed(g, new THREE.Group(), 1, (k) => { const h = g.handPos(); for (let i = 0; i < 4; i++) { const a = Math.random() * 6.28, r = 3 * (1 - k) + 0.3; g.smoke.spawn(h.x + Math.cos(a) * r, h.y, h.z + Math.sin(a) * r, -Math.sin(a) * 8, 1, Math.cos(a) * 8, 0xf0f4fa, 0.6, 0.4, { alpha: 0.7 }); } }));
      g.after(1, () => { g.add(new Hurricane(g, P.pos.clone(), P.facing.clone(), 300, 5000)); g.toast('HURRICANE — CATEGORY 5 · 165 MPH', '#9fd0ff'); });
    } },
    { name: 'Microburst Bomb', cd: 5, info: 'Cells merge → 145mph downburst gust · 10s', cast: (g) => { g.add(new Microburst(g, g.aim.clone(), 150, 4500)); g.toast('MICROBURST', '#e0ecff'); } },
    { name: 'Nimbostratus Flooding', cd: 5, info: 'Nimbostratus 250m · rising floodwater', cast: (g) => {
      const c = g.aim.clone(); for (let i = 0; i < 5; i++) { const p = i === 0 ? c.clone() : around(c, 170); g.add(new StormCloud(g, { pos: p, kind: 'nimbo', size: 250, life: 32, grow: 2, rain: 1, rainDmg: 120, shade: 0.9, rainColor: 0xcdd3db })); }
      g.add(new Flood(g, c, 320, 32, 7, 3000)); g.toast('FLOOD WARNING', '#6fb0e0');
    } },
    { name: 'Supercell Spawner', cd: 5, info: 'Choose LP / Normal / HP', cdMul: (g) => SUPERCELL_TYPES[g.sel.supercell].cd, cast: (g) => {
      const T = SUPERCELL_TYPES[g.sel.supercell];
      g.add(new StormCloud(g, { pos: g.aim.clone(), kind: 'supercell', size: T.size, life: 60, grow: 2.5, rain: T.rain, rainDmg: T.rainDmg, hail: T.hail, hailDmg: 18000, bolts: T.bolts, boltDmg: 9000, superChance: 0.45, superMul: 12, superName: 'HYPERBOLT', tornado: true, tornadoRate: 0.08, dmgMul: T.dmg, shade: T.shade, rainColor: T.color, spin: 0.08 }));
      g.toast(T.name.toUpperCase(), '#ffb347');
    } },
    { name: 'Storm Suppression', cd: 5, info: 'Cells spawn faster & faster (15+) · 30s', cast: (g) => {
      const N = 18, anchor = g.player.pos.clone();
      for (let i = 0; i < N; i++) {
        const t = 30 * (1 - Math.sqrt(1 - i / N)) * 0.9;
        // Keep delayed cells near the cast point in a compact, evenly spaced cluster.
        // Sampling the moving player at each timer scattered them along the player's path.
        const a = i * 2.399963229728653, r = 62 * Math.sqrt((i + 0.5) / N);
        const p = V(anchor.x + Math.cos(a) * r, 0, anchor.z + Math.sin(a) * r);
        g.after(t, () => { g.add(new StormCloud(g, { pos: p, kind: 'cell', size: 125, life: Math.max(4, 30 - t) + 2, grow: 3, densityScale: 1.25, rain: 0.9, rainDmg: 150, bolts: 0.8, boltDmg: 8000, superChance: 0.25, superMul: 3, superName: 'SUPERBOLT', hail: 0.6, hailDmg: 12000 })); });
      }
      g.toast('STORM SUPPRESSION', '#cfd8e6');
    } },
  ],
};

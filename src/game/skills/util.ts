import * as THREE from 'three';
import { V, rnd } from '../effects';
import type { HitOpts } from '../types';

/** horizontal launch strength so enemy travels ~`m` meters (v=2.2k, vy=0.9k, g=30) */
export const knockFor = (m: number) => Math.sqrt(m / 0.132);

export function cone(g: any, range: number, dmg: number, o: HitOpts = {}, dotMin = 0.25) {
  const P = g.player; const f = g.forward(); const hit: any[] = [];
  for (const e of g.enemies) {
    if (e.dead) continue; const d = V(e.pos.x - P.pos.x, 0, e.pos.z - P.pos.z); const l = d.length();
    if (l > range + e.radius) continue; if (l > 1.2 && d.normalize().dot(f) < dotMin) continue;
    hit.push(e); g.damage(e, dmg, { from: P.pos.clone(), ...o });
  }
  return hit;
}
export function around(c: THREE.Vector3, r: number) { const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r; return V(c.x + Math.cos(a) * d, 0, c.z + Math.sin(a) * d); }
export function faceAim(g: any) { const d = g.aim.clone().sub(g.player.pos).setY(0); if (d.lengthSq() > 0.01) g.player.facing.copy(d.normalize()); }
export function spreadDir(base: THREE.Vector3, deg: number) { const a = THREE.MathUtils.degToRad(rnd(-deg / 2, deg / 2)); const c = Math.cos(a), s = Math.sin(a); return V(base.x * c - base.z * s, 0, base.x * s + base.z * c).normalize(); }
/** Distinct-target picker: re-targets an enemy only if planned damage won't kill it. */
export class TargetPlanner {
  planned = new Map<any, number>();
  pick(g: any, center: THREE.Vector3, r: number, dmg: number) {
    const cands = g.enemies.filter((e: any) => !e.dead && e.pos.distanceTo(center) < r && (this.planned.get(e) ?? 0) < e.hp);
    const fresh = cands.filter((e: any) => !this.planned.has(e));
    const pool = fresh.length ? fresh : cands;
    if (!pool.length) return null;
    const e = pool[Math.floor(Math.random() * pool.length)];
    this.planned.set(e, (this.planned.get(e) ?? 0) + dmg * g.dmgMul());
    return e;
  }
}

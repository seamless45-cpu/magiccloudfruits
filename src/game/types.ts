import type * as THREE from 'three';

export interface Effect {
  update(dt: number): boolean; // return false when finished
  dispose(): void;
}

export interface HitOpts {
  stun?: number; freeze?: number; burn?: number; burnDps?: number; bleed?: number; bleedDps?: number;
  knock?: number; knockUp?: number; lift?: number; imprison?: number; blind?: number; flee?: number;
  crit?: boolean; from?: THREE.Vector3; pull?: THREE.Vector3; noCharge?: boolean; source?: string;
  lowHpBonus?: boolean; percentMax?: number; skillHit?: boolean;
}

export type ItemType = 'fruit' | 'sword';

export interface SkillDef {
  name: string;
  cd: number;
  cast?: (g: any) => void;
  holdStart?: (g: any) => void;
  holdTick?: (g: any, dt: number) => boolean | void; // return false to force stop
  holdEnd?: (g: any) => void;
  charges?: { max: number; regen: number };
  cdMul?: (g: any) => number;
  info?: string;
}

export interface ItemDef {
  id: string; name: string; type: ItemType; color: string; glyph: string;
  m1?: { interval: number; combo?: number; endLag?: number; onHit: (g: any, combo: number) => void; gun?: boolean };
  skills: SkillDef[];
  passive?: string;
}

export interface GraphicsSettings {
  preset: 'low' | 'medium' | 'high' | 'ultra';
  sandbox: boolean;
  resolution: number; shadows: boolean; shadowRes: number; bloom: boolean; bloomStrength: number;
  particles: number; debris: number; maxBolts: number; fog: boolean; exposure: number;
  shake: number; positionShake: boolean; rotationShake: boolean; showFps: boolean; antialiasFxaa: boolean; frameInterpolation: boolean; drawDistance: number; clouds: number;
}

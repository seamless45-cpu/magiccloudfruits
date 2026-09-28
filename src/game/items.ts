import type { ItemDef } from './types';
import { GRAVITY_FRUIT, GRAVITY_BLADE } from './skills/gravity';
import { LIGHTNING_FRUIT, POLE } from './skills/lightningFruit';
import { QUAKE_FRUIT, BISENTO } from './skills/quake';
import { ALARM_FRUIT, ALARM_SWORD } from './skills/alarm';
import { RIME_FRUIT, WILDFIRE_FRUIT } from './skills/guns';
import { CLOUD_FRUIT } from './skills/cloud';

// Fruits and swords are separate inventory items.
export const ITEMS: ItemDef[] = [
  GRAVITY_FRUIT, LIGHTNING_FRUIT, QUAKE_FRUIT, ALARM_FRUIT, RIME_FRUIT, WILDFIRE_FRUIT, CLOUD_FRUIT,
  GRAVITY_BLADE, POLE, BISENTO, ALARM_SWORD,
];

// Оформления игрока (решение владельца 31.10.2026, issue 116, вариант Б; src/engine/looks.ts): что выбрано в
// настройках и что из этого показывать. Где оформления запираются — как «Узоры+» (`useGate`): сборка для
// RuStore и все 1.0; в сборках 0.x для проверки открыто всё. Купленное — товары из последнего ответа
// магазина; покупка навсегда — следующим шагом (0.18.1), до неё у игрока только бесплатные.
import { type CanvasLook, type FrameLook, shownLooks } from '../engine/looks';
import { useGate } from './plus';
import { useSettings } from './settings';

/** Купленные оформления: товары из последнего ответа магазина. Покупки — с 0.18.1. */
const OWNED: readonly string[] = [];

export interface Looks {
  /** что показывать: выбранное, если оно есть у игрока, иначе бесплатное */
  canvas: CanvasLook;
  frame: FrameLook;
  /** купленные товары */
  owned: readonly string[];
  /** сборка не запирает: все оформления открыты */
  open: boolean;
}

export function useLooks(): Looks {
  const { settings } = useSettings();
  const open = !useGate();
  return { ...shownLooks(settings, OWNED, open), owned: OWNED, open };
}

// Оформления игрока (решение владельца 31.10.2026, issue 116, вариант Б; src/engine/looks.ts): что выбрано в
// настройках, что куплено и что из этого показывать. Где оформления запираются — как «Узоры+» (`useGate`):
// сборка для RuStore и все 1.0; в сборках 0.x для проверки открыто всё. Купленное — товары навсегда из
// последнего ответа RuStore Pay (0.18.1): хранится и действует без сети; спросить заново — при запуске и при
// возвращении в игру, как о подписке (`useLooksRefresh`), и по «Восстановить покупки» на экране «Оформление».
// Возврат денег RuStore отдаёт списком без этой покупки — оформление снова заперто.
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { type CanvasLook, type FrameLook, ownedOf, shownLooks } from '../engine/looks';
import { billing } from './billing';
import { useGate } from './plus';
import { useSettings } from './settings';
import { KEYS, loadJson, saveJson } from './storage';

let owned: readonly string[] = [];
const subs = new Set<() => void>();
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
const snapshot = () => owned;

/** Купленные сейчас — для строки после «Восстановить покупки». */
export const ownedLooksNow = (): readonly string[] => owned;

/** Ответ магазина или покупки — сразу на экраны и в хранилище. */
export function setOwnedLooks(next: readonly string[]): void {
  owned = ownedOf(next);
  saveJson(KEYS.looks, owned);
  for (const f of subs) f();
}

let loaded: Promise<void> | null = null;
/** Сохранённое — один раз за запуск, до первого ответа магазина: без сети купленное остаётся. */
const load = () => (loaded ??= loadJson<unknown>(KEYS.looks).then((raw) => {
  const s = ownedOf(raw);
  if (s.length && !owned.length) {
    owned = s;
    for (const f of subs) f();
  }
}));

/** Спросить магазин, что куплено: true — ответил, null — не узнали (прежний ответ остался). */
export async function refreshLooks(): Promise<true | null> {
  await load();
  if (!billing.available) return null;
  const list = await billing.looks();
  if (!list) return null;
  setOwnedLooks(list);
  return true;
}

/** Спрашивать магазин при запуске и при возвращении в игру — как о подписке (src/state/plus.tsx). */
export function useLooksRefresh(): void {
  useEffect(() => {
    void refreshLooks();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void refreshLooks();
    });
    return () => sub.remove();
  }, []);
}

/** Купленные оформления — товары из последнего ответа магазина. */
export function useOwnedLooks(): readonly string[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

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
  const list = useOwnedLooks();
  return { ...shownLooks(settings, list, open), owned: list, open };
}

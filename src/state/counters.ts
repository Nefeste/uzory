// Счётчики суток на телефоне (docs/04-data-model.md, «Счётчики суток»; ADR 0012): за день игры —
// сколько картинок закончено и в скольких минутах был хотя бы один стежок. Итоги прошлого дня
// игры уходят с первым за день запросом каталога (src/state/net.ts) и обнуляются. Ничего больше
// не копится и никуда больше не уходит.
import { addFinished, addStitch, type Counters, normalizeCounters, NO_COUNTERS, type Store, takeCounters } from '../engine/counters';
import { APP_VERSION } from '../version';
import { STORE } from './net-env';
import { todayLocal } from './player';
import { KEYS, loadJson, saveJson } from './storage';

let state: Counters = NO_COUNTERS;
let loaded = false;
// правки идут друг за другом: стежки приходят быстрее, чем пишется хранилище
let queue: Promise<void> = Promise.resolve();

function change(f: (s: Counters) => Counters): Promise<void> {
  queue = queue.then(async () => {
    if (!loaded) {
      state = normalizeCounters(await loadJson<unknown>(KEYS.counters));
      loaded = true;
    }
    const next = f(state);
    if (next === state) return;
    state = next;
    await saveJson(KEYS.counters, next);
  }).catch(() => undefined);
  return queue;
}

/** Стежок: минута засчитывается один раз. */
export function noteStitch(now = Date.now()): void {
  void change((s) => addStitch(s, todayLocal(now), Math.floor(now / 60000)));
}

/** Картинка закончена. */
export function noteFinished(now = Date.now()): void {
  void change((s) => addFinished(s, todayLocal(now)));
}

/** Строка счётчиков для первой попытки дня; дальше в этот день — null. */
export async function counterQuery(today: string, installed: string, plus: boolean, store: Store = STORE): Promise<string | null> {
  let query: string | null = null;
  await change((s) => {
    const r = takeCounters(s, { v: APP_VERSION, store, installed, today, plus });
    query = r.query;
    return r.next;
  });
  return query;
}

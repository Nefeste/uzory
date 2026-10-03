// Запуски и сбои на этом телефоне (src/engine/sessions.ts): открыта ли игра сейчас — в хранилище,
// чтобы следующий запуск узнал, что прошлый оборвался. Никуда не уходит сам: только строкой в
// отчёт об ошибке, который игрок видит целиком и отправляет своими руками.
import { AppState } from 'react-native';
import { normalizeSessions, type Sessions, sessionEnd, sessionStart } from '../engine/sessions';
import { todayLocal } from './player';
import { KEYS, loadJson, saveJson } from './storage';

let state: Sessions | null = null;
// правки идут друг за другом: уход в фон и возвращение бывают быстрее записи
let queue: Promise<void> = Promise.resolve();

function change(f: (s: Sessions) => Sessions): void {
  queue = queue.then(async () => {
    const s = state ?? normalizeSessions(await loadJson<unknown>(KEYS.sessions), todayLocal());
    state = f(s);
    await saveJson(KEYS.sessions, state);
  }).catch(() => undefined);
}

/**
 * При запуске: сессия началась. Дальше — уход в фон её закрывает, возвращение из фона
 * начинает новую; «active» без ухода в фон перед ним (так бывает сразу после запуска) — нет.
 */
export function installSessions(): void {
  change(sessionStart);
  let away = false;
  AppState.addEventListener('change', (st) => {
    if (st === 'background') {
      away = true;
      change(sessionEnd);
    } else if (st === 'active' && away) {
      away = false;
      change(sessionStart);
    }
  });
}

/** Счёт для отчёта; null — не прочитался. */
export async function readSessions(): Promise<Sessions | null> {
  await queue;
  return state;
}

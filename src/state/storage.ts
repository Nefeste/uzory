// из votchina: src/state/storage.ts @ 1242776
// Хранилище настроек (перенос из «Вотчины»): JSON поверх AsyncStorage, который никогда
// не бросает — испорченное хранилище не должно ронять приложение.
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function loadJson<T>(key: string): Promise<T | null> {
  try {
    const s = await AsyncStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

export async function saveJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // хранилище переполнено или недоступно: игра работает, теряется только настройка
  }
}

export async function remove(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // нечего удалять — не страшно
  }
}

export const KEYS = {
  settings: 'uzory.settings.v1',
  /** журнал сбоев: последние ошибки для «Сообщить об ошибке»; никуда не уходит сам */
  crashlog: 'uzory.crashlog.v1',
  /**
   * игрок на этом телефоне: день первого запуска, самая поздняя виденная дата, закреплённые
   * картинки дня, первая картинка, подсказки (src/state/player.tsx)
   */
  player: 'uzory.player.v1',
  /** раздача картинок: когда спрашивали каталог, скачанные наборы, строка на главной (src/state/net.ts) */
  net: 'uzory.net.v1',
  /** счётчики суток: итоги дня игры для первого за день запроса каталога (src/state/counters.ts) */
  counters: 'uzory.counters.v1',
  /**
   * отбор картинок владельцем в листе: версия картинки (id@v) → «да», «нет», «позже» (src/state/picks.ts,
   * только 0.x). С 0.16.2 — по версии, а не по id: новая версия узора приходит на отбор без прежней отметки
   */
  picks: 'uzory.picks.v2',
  /** комментарии владельца к картинкам листа: версия картинки (id@v) → что поправить (src/state/picks.ts, только 0.x) */
  notes: 'uzory.notes.v2',
  /** подписка «Узоры+»: последний ответ RuStore Pay и когда спрашивали (src/state/plus.tsx) */
  plus: 'uzory.plus.v1',
  /** оформления навсегда: купленные товары из последнего ответа RuStore Pay (src/state/looks.ts, 0.18.1) */
  looks: 'uzory.looks.v1',
  /** запуски и оборвавшиеся сессии — строкой в отчёт об ошибке; никуда не уходит сам (src/state/sessions.ts) */
  sessions: 'uzory.sessions.v1',
};

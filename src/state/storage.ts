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
  /** дата первого запуска — начало календаря игрока */
  installed: 'uzory.installed.v1',
};

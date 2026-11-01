// из votchina: src/state/settings.tsx @ 1242776
// Настройки игрока (docs/08-game-design.md, «Настройки»; перенос механики из «Вотчины»).
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { type FrameId, FREE_FRAME } from '../engine/looks';
import { DARK, LIGHT, type Theme } from '../ui/theme';
import type { Ambience } from './ambience';
import { KEYS, loadJson, saveJson } from './storage';

export type StitchStyle = 'cross' | 'mosaic';

export interface Settings {
  style: StitchStyle;
  /** «Крупные номера»: масштаб открытия 36 dp вместо 28 */
  bigNumbers: boolean;
  /** подсветка выбранной нити: окраска или штриховка (для тех, кто плохо различает цвета) */
  highlight: 'tint' | 'hatch';
  /** заливка двойным касанием */
  fill: boolean;
  /** «Следующая нить сама» */
  autoNext: boolean;
  /** «Стежки на картинке „Поделиться“»: выключено — клетки ровным цветом (src/engine/share.ts) */
  shareStitches: boolean;
  hints: boolean;
  haptics: boolean;
  sound: boolean;
  music: boolean;
  /** фон вышивания — дождь за окном или печь (src/state/ambience.ts); сразу после установки выключен */
  ambience: Ambience;
  /** сборка 0.x для проверки: запирать картинки «Узоры+», как в 1.0 (образец экрана подписки) */
  previewLock: boolean;
  /**
   * Рамка на «Готово» и «Поделиться» (src/engine/looks.ts); показывается, только если есть у игрока. Канва с
   * 0.20.0 — у работы (src/state/works.ts), а не в настройках: прежнее поле `canvas` в записи настроек
   * больше не читается.
   */
  frame: FrameId;
}

export const DEFAULT_SETTINGS: Settings = {
  style: 'cross', bigNumbers: false, highlight: 'tint', fill: true, autoNext: true, shareStitches: false,
  hints: true, haptics: true, sound: true, music: true, ambience: 'off', previewLock: false,
  frame: FREE_FRAME,
};

interface Ctx {
  settings: Settings;
  loaded: boolean;
  update: (patch: Partial<Settings>) => void;
  theme: Theme;
}

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const scheme = useColorScheme();

  useEffect(() => {
    loadJson<Partial<Settings>>(KEYS.settings).then((s) => {
      setSettings({ ...DEFAULT_SETTINGS, ...(s && typeof s === 'object' ? s : {}) });
      setLoaded(true);
    });
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveJson(KEYS.settings, next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ settings, loaded, update, theme: scheme === 'dark' ? DARK : LIGHT }), [settings, loaded, update, scheme]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const c = useContext(SettingsContext);
  if (!c) throw new Error('SettingsProvider missing');
  return c;
}

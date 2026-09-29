// Игрок на этом телефоне (docs/04-data-model.md, «Телефон»; docs/specs/2026-09-first-picture.md,
// «Данные»): день первого запуска — начало его календаря, самая поздняя виденная дата,
// закреплённые картинки дня, вышита ли первая картинка, какие подсказки уже сделаны.
// Хранится, как настройки: испорченная запись не роняет игру, а начинается заново.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { localDate } from '../engine/dates';
import { normalizePlayer, type Player } from '../engine/player';
import { KEYS, loadJson, saveJson } from './storage';

export type { Player };

/** Сегодня по времени телефона, «2026-10-05»: движок сам дату не узнаёт (dates.ts). */
export const todayLocal = (now = Date.now()) => localDate(now, -new Date(now).getTimezoneOffset());

interface Ctx {
  player: Player;
  loaded: boolean;
  /** сегодня; меняется, когда приложение возвращается после полуночи */
  today: string;
  update: (patch: Partial<Player> | ((p: Player) => Partial<Player>)) => void;
}

const PlayerContext = createContext<Ctx | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [today, setToday] = useState(() => todayLocal());
  const [player, setPlayer] = useState<Player>(() => normalizePlayer(null, today));
  const [loaded, setLoaded] = useState(false);

  const update = useCallback((patch: Partial<Player> | ((p: Player) => Partial<Player>)) => {
    setPlayer((prev) => {
      const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) };
      saveJson(KEYS.player, next);
      return next;
    });
  }, []);

  useEffect(() => {
    void loadJson<unknown>(KEYS.player).then((raw) => {
      const p = normalizePlayer(raw, todayLocal());
      setPlayer(p);
      setLoaded(true);
      saveJson(KEYS.player, p);
    });
    // вернулись в игру на другой день — новая картинка дня, и `seen` растёт
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      const t = todayLocal();
      setToday(t);
      update((p) => (t > p.seen ? { seen: t } : {}));
    });
    return () => sub.remove();
  }, [update]);

  const value = useMemo(() => ({ player, loaded, today, update }), [player, loaded, today, update]);
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): Ctx {
  const c = useContext(PlayerContext);
  if (!c) throw new Error('PlayerProvider missing');
  return c;
}

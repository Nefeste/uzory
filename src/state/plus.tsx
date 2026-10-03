// Подписка «Узоры+» на этом телефоне (docs/specs/2026-09-plus.md): последний ответ RuStore Pay
// хранится и действует без сети по правилам движка (src/engine/plus.ts); спросить заново —
// при запуске, при возвращении в игру и по «Восстановить покупки». Где что заперто — `useGate`.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { normalizePlus, type PlusState, plusOpen } from '../engine/plus';
import { INTERNAL } from '../version';
import { billing } from './billing';
import { STORE } from './net-env';
import { useSettings } from './settings';
import { KEYS, loadJson, saveJson } from './storage';

interface Ctx {
  state: PlusState | null;
  /** открыта ли библиотека по подписке сейчас */
  open: boolean;
  /** спросить магазин: открыта ли теперь библиотека; null — не узнали, прежний ответ остался */
  refresh: () => Promise<boolean | null>;
  /** ответ покупки — сразу, без нового вопроса магазину */
  set: (s: PlusState) => void;
}

const PlusContext = createContext<Ctx | null>(null);

export function PlusProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlusState | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const set = useCallback((s: PlusState) => {
    setState(s);
    setNow(Date.now());
    saveJson(KEYS.plus, s);
  }, []);

  const refresh = useCallback(async () => {
    if (!billing.available) return null;
    const s = await billing.status();
    if (!s) return null;
    set(s);
    return plusOpen(s, Date.now());
  }, [set]);

  useEffect(() => {
    void loadJson<unknown>(KEYS.plus).then((raw) => {
      const s = normalizePlus(raw);
      if (s) setState(s);
      void refresh();
    });
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      setNow(Date.now());
      void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const value = useMemo(() => ({ state, open: plusOpen(state, now), refresh, set }), [state, now, refresh, set]);
  return <PlusContext.Provider value={value}>{children}</PlusContext.Provider>;
}

export function usePlus(): Ctx {
  const c = useContext(PlusContext);
  if (!c) throw new Error('PlusProvider missing');
  return c;
}

/**
 * Запирает ли сборка картинки «Узоры+» (docs/specs/2026-09-plus.md, «Где что заперто»): сборка
 * для RuStore и все сборки 1.0 — да; сборки 0.x для проверки — нет (метки «Узоры+» стоят), если
 * владелец не включил «Как в 1.0» на образце экрана подписки.
 */
export function useGate(): boolean {
  const { settings } = useSettings();
  return STORE === 'rustore' || !INTERNAL || settings.previewLock;
}

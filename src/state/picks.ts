// Отбор картинок владельцем (docs/09-content.md, §8; docs/05-process.md): у каждой картинки
// листа — «да», «нет» или «позже», на этом телефоне или в этом браузере. Решения уходят
// ассистенту текстом, и он ставит `approved` в карточки. Только в сборках для проверки (0.x).
import { useCallback, useEffect, useState } from 'react';
import { KEYS, loadJson, saveJson } from './storage';

export type Pick = 'yes' | 'no' | 'later';

const PICKS: readonly Pick[] = ['yes', 'no', 'later'];

export function usePicks(): { picks: Readonly<Record<string, Pick>>; setPick: (id: string, v: Pick | null) => void } {
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  useEffect(() => {
    void loadJson<Record<string, unknown>>(KEYS.picks).then((raw) => {
      const out: Record<string, Pick> = {};
      for (const [id, v] of Object.entries(raw ?? {})) if (PICKS.includes(v as Pick)) out[id] = v as Pick;
      setPicks(out);
    });
  }, []);
  const setPick = useCallback((id: string, v: Pick | null) => {
    setPicks((prev) => {
      const next = { ...prev };
      if (v) next[id] = v;
      else delete next[id];
      saveJson(KEYS.picks, next);
      return next;
    });
  }, []);
  return { picks, setPick };
}

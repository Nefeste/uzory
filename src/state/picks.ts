// Отбор картинок владельцем (docs/09-content.md, §8; docs/05-process.md): у каждой картинки
// листа — «да», «нет» или «позже» и, если нужно, короткий комментарий — что поправить; всё это
// хранится на этом телефоне или в этом браузере, по версии картинки (pickKey: id@v). Решения уходят
// ассистенту текстом (src/state/decisions.ts), и он ставит `approved` в карточки. Только в сборках для
// проверки (0.x).
import { useCallback, useEffect, useRef, useState } from 'react';
import { cleanNote, cleanTune, type Pick, PICKS, type Tune } from './decisions';
import { KEYS, loadJson, saveJson } from './storage';

export type { Pick, Tune } from './decisions';

export function usePicks(): {
  picks: Readonly<Record<string, Pick>>;
  setPick: (key: string, v: Pick | null) => void;
  notes: Readonly<Record<string, string>>;
  setNote: (key: string, text: string) => void;
  /** настройки, при которых владелец согласен (0.24.1): пустые — как сейчас */
  tunes: Readonly<Record<string, Tune>>;
  setTune: (key: string, t: Tune | null) => void;
} {
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [tunes, setTunes] = useState<Record<string, Tune>>({});
  // комментарий записывается и тогда, когда лист уже закрывается и поле уходит вместе с ним:
  // запись не ждёт состояния экрана
  const notesNow = useRef<Record<string, string>>({});
  useEffect(() => {
    void loadJson<Record<string, unknown>>(KEYS.picks).then((raw) => {
      const out: Record<string, Pick> = {};
      for (const [id, v] of Object.entries(raw ?? {})) if (PICKS.includes(v as Pick)) out[id] = v as Pick;
      setPicks(out);
    });
    void loadJson<Record<string, unknown>>(KEYS.notes).then((raw) => {
      const out: Record<string, string> = {};
      for (const [id, v] of Object.entries(raw ?? {})) {
        const note = typeof v === 'string' ? cleanNote(v) : '';
        if (note) out[id] = note;
      }
      notesNow.current = { ...out, ...notesNow.current };
      setNotes(notesNow.current);
    });
    void loadJson<Record<string, unknown>>(KEYS.tunes).then((raw) => {
      const out: Record<string, Tune> = {};
      for (const [id, v] of Object.entries(raw ?? {})) {
        const t = typeof v === 'object' && v ? cleanTune(v as Tune) : undefined;
        if (t) out[id] = t;
      }
      setTunes((cur) => ({ ...out, ...cur }));
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
  const setNote = useCallback((id: string, text: string) => {
    const note = cleanNote(text);
    if ((notesNow.current[id] ?? '') === note) return;
    const next = { ...notesNow.current };
    if (note) next[id] = note;
    else delete next[id];
    notesNow.current = next;
    saveJson(KEYS.notes, next);
    setNotes(next);
  }, []);
  const setTune = useCallback((id: string, t: Tune | null) => {
    setTunes((prev) => {
      const next = { ...prev };
      const clean = t ? cleanTune(t) : undefined;
      if (clean) next[id] = clean;
      else delete next[id];
      saveJson(KEYS.tunes, next);
      return next;
    });
  }, []);
  return { picks, setPick, notes, setNote, tunes, setTune };
}

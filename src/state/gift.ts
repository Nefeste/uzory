// «Тайна от друга» (0.23.0; владелец 01.11.2026, issue 145): файл тайны → свой узор в «Моих узорах»
// (src/state/mine.ts, `saveGift`) и работа «Тайной»; начатую тайну тот же файл продолжает. Подпись
// отправителя запоминается на телефоне — в следующий раз она уже в поле.
import { type GiftNote, readGift } from '../engine/gift';
import type { Pattern } from '../engine/pattern';
import { mineKey, saveGift } from './mine';
import { KEYS, loadJson, saveJson } from './storage';
import { loadIndex } from './works';

export interface OpenedGift {
  pattern: Pattern;
  /** название узора — откроется на «Готово» */
  title: string;
  gift: GiftNote;
  /** начатая работа этой тайны — продолжить */
  workId?: string;
  /** тайна ещё не вышита до конца — новая работа «Тайной»; вышита — обычной, записка остаётся */
  secret: boolean;
}

/** Байты файла тайны → узор и работа, которую продолжить; не тайна или испорчена — GiftError. */
export async function openGift(bytes: Uint8Array, now: number): Promise<OpenedGift> {
  const { entry, pattern } = await saveGift(readGift(bytes), now);
  // указатель работ — от свежих к старым: первая незаконченная этой тайны и есть последняя
  const own = (await loadIndex()).filter((w) => w.pattern === mineKey(entry.id));
  const work = own.find((w) => !w.finished);
  return { pattern, title: entry.title, gift: entry.gift ?? {}, secret: !own.some((w) => w.finished), ...(work ? { workId: work.id } : {}) };
}

/** Подпись отправителя из прошлого раза; нет — пусто. */
export async function lastFrom(): Promise<string> {
  const v = await loadJson<{ from?: unknown }>(KEYS.gift);
  return typeof v?.from === 'string' ? v.from : '';
}

export async function rememberFrom(from: string): Promise<void> {
  await saveJson(KEYS.gift, { from });
}

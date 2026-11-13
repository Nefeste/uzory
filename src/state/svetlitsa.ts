// «Светлица» (1.1.0, docs/specs/2026-11-svetlitsa.md): какие работы висят на стенах — все готовые, и картинки
// библиотеки, и свои узоры; новые — первыми. Работа, чьей картинки больше нет, не висит (она — в «Моих работах»
// с пометкой «Картинка недоступна»).
import type { GiftNote } from '../engine/gift';
import { type CanvasLook, workCanvas } from '../engine/looks';
import type { PackPicture } from '../engine/pack';
import type { Pattern } from '../engine/pattern';
import { patternByKey } from './library';
import { isMineKey, listMine, loadMine } from './mine';
import { loadIndex } from './works';

export interface HungWork {
  /** id работы */
  id: string;
  pattern: Pattern;
  title: string;
  /** картинка библиотеки; у своего узора — нет */
  pic?: PackPicture;
  /** тайна от друга — записка на «Готово» */
  gift?: GiftNote;
  canvas: CanvasLook;
  finished: number;
}

export async function loadHung(): Promise<HungWork[]> {
  const works = (await loadIndex()).filter((w) => !!w.finished).sort((a, b) => (b.finished ?? 0) - (a.finished ?? 0));
  const mine = works.some((w) => isMineKey(w.pattern)) ? await listMine() : [];
  const out: HungWork[] = [];
  for (const w of works) {
    if (isMineKey(w.pattern)) {
      const id = w.pattern.replace(/@.*$/, '');
      const entry = mine.find((m) => m.id === id);
      const pattern = entry ? await loadMine(id) : null;
      if (!entry || !pattern) continue;
      out.push({ id: w.id, pattern, title: entry.title, gift: entry.gift, canvas: workCanvas(w.canvas, pattern), finished: w.finished! });
      continue;
    }
    const found = patternByKey(w.pattern);
    if (!found) continue;
    out.push({ id: w.id, pattern: found.pattern, title: found.pic.title, pic: found.pic, canvas: workCanvas(w.canvas, found.pattern), finished: w.finished! });
  }
  return out;
}

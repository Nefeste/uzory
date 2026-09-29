// «Перенос» (docs/specs/2026-09-plus.md, «Перенос»; docs/04-data-model.md, «Резервная копия
// и перенос»): все работы и свои узоры — одним файлом, и обратно — на другом телефоне или
// в веб-версии. Совпавшие по id работы не дублируются: остаётся та, где вышито больше.
import { type BackupEntry, makeBackup, planImport, readBackup } from '../engine/backup';
import { utf8Decode, utf8Encode } from '../engine/utf8';
import { decodeWork } from '../engine/workfile';
import { readFile } from './files';
import { listMine, type MineFile, mineKey, putMine, readMineFile } from './mine';
import { loadIndex, putWorks } from './works';

export { BackupError } from '../engine/backup';

/** Файл переноса: `uzory-2026-09-29.uzw`. Работа с испорченным файлом стежков берётся из `.bak`. */
export async function exportWorks(today: string): Promise<{ name: string; bytes: Uint8Array; works: number }> {
  const works: { entry: BackupEntry; log: Uint8Array }[] = [];
  for (const entry of await loadIndex()) {
    for (const name of [`${entry.id}.log`, `${entry.id}.log.bak`]) {
      const log = await readFile(name).catch(() => null);
      if (!log) continue;
      try {
        decodeWork(log);
      } catch {
        continue;
      }
      works.push({ entry, log });
      break;
    }
  }
  const mine: MineFile[] = [];
  for (const m of await listMine()) {
    const f = await readMineFile(m.id);
    if (f) mine.push(f);
  }
  return { name: `uzory-${today}.uzw`, bytes: utf8Encode(makeBackup(today, works, mine)), works: works.length };
}

export interface ImportResult {
  /** работ добавлено или заменено на более вышитые */
  added: number;
  /** своих узоров добавлено */
  mine: number;
  /** уже были */
  same: number;
  /** не разобрались или без своего узора */
  bad: number;
}

/** Добавляет работы из файла. Не файл работ «Узоров» — BackupError; сбой записи — исключение. */
export async function importWorks(bytes: Uint8Array): Promise<ImportResult> {
  const file = readBackup(utf8Decode(bytes));
  const index = await loadIndex();
  const plan = planImport(file, {
    works: new Map(index.map((w) => [w.id, w.done])),
    mine: new Set((await listMine()).map((m) => mineKey(m.id))),
  });
  // сначала узоры: работа своего узора без него не откроется
  await putMine(plan.mine);
  await putWorks(plan.works);
  return { added: plan.works.length, mine: plan.mine.length, same: plan.same, bad: file.bad + plan.orphan };
}

// Файлы работ на телефоне (docs/04-data-model.md, «Телефон»): папка приложения,
// запись целиком через временный файл и переименование, прошлая версия — `.bak`.
// В вебе — src/state/files.web.ts (IndexedDB браузера).
import { Directory, File, Paths } from 'expo-file-system';

const dir = () => {
  const d = new Directory(Paths.document, 'works');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
};

/** Читает файл; нет файла — null. */
export async function readFile(name: string): Promise<Uint8Array | null> {
  const f = new File(dir(), name);
  if (!f.exists) return null;
  return f.bytes();
}

/**
 * Записывает целиком: сначала `name.tmp`, затем прошлая версия становится `name.bak`,
 * и временный файл получает имя. Сбой посреди записи оставляет либо старый файл, либо копию.
 */
export async function writeFile(name: string, bytes: Uint8Array, keepBak = true): Promise<void> {
  const d = dir();
  const tmp = new File(d, `${name}.tmp`);
  if (tmp.exists) tmp.delete();
  tmp.create();
  tmp.write(bytes);
  const cur = new File(d, name);
  if (cur.exists) {
    if (keepBak) cur.moveSync(new File(d, `${name}.bak`), { overwrite: true });
    else cur.delete();
  }
  tmp.moveSync(new File(d, name));
}

export async function removeFile(name: string): Promise<void> {
  for (const n of [name, `${name}.bak`, `${name}.tmp`]) {
    const f = new File(dir(), n);
    if (f.exists) f.delete();
  }
}

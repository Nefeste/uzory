// Скачанные наборы на телефоне (docs/04-data-model.md, «Телефон»): папка `packs/` рядом с
// `works/`; файл пишется через временный и переименование. В вебе — packfiles.web.ts.
import { Directory, File, Paths } from 'expo-file-system';

const dir = () => {
  const d = new Directory(Paths.document, 'packs');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
};

export async function readPackFile(name: string): Promise<Uint8Array | null> {
  const f = new File(dir(), name);
  return f.exists ? f.bytes() : null;
}

export async function writePackFile(name: string, bytes: Uint8Array): Promise<void> {
  const d = dir();
  const tmp = new File(d, `${name}.tmp`);
  if (tmp.exists) tmp.delete();
  tmp.create();
  tmp.write(bytes);
  const cur = new File(d, name);
  if (cur.exists) cur.delete();
  tmp.moveSync(cur);
}

export async function removePackFile(name: string): Promise<void> {
  const f = new File(dir(), name);
  if (f.exists) f.delete();
}

/** Свободно на диске, байт; не узнать — null. */
export function freeSpace(): number | null {
  try {
    return Paths.availableDiskSpace;
  } catch {
    return null;
  }
}

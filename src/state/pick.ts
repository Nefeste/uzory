// Выбор файла на телефоне для «Загрузить из файла» (docs/specs/2026-09-plus.md, «Перенос»):
// системное окно Android (SAF) — разрешений не нужно. В вебе — pick.web.ts.
import { File } from 'expo-file-system';

/** Файл работ больше этого — не наш: чужое не читается в память целиком. */
export const PICK_MAX = 64 * 1024 * 1024;

export class PickTooBig extends Error {}

/** Открывает выбор файла; отказался — null; слишком большой — PickTooBig. */
export async function pickFile(): Promise<Uint8Array | null> {
  const r = await File.pickFileAsync();
  if (r.canceled) return null;
  if ((r.result.size ?? 0) > PICK_MAX) throw new PickTooBig();
  return r.result.bytes();
}

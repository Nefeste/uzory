// «Поделиться» на телефоне (docs/specs/2026-09-library.md, «Готово»): PNG кладётся во временную
// папку приложения и уходит в «Поделиться» Android — разрешений не нужно. В вебе — share.web.ts.
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Отдаёт картинку системному «Поделиться»; false — делиться на этом телефоне нечем. */
export async function sharePng(bytes: Uint8Array, name: string, title: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const f = new File(Paths.cache, name);
  if (f.exists) f.delete();
  f.create();
  f.write(bytes);
  await Sharing.shareAsync(f.uri, { mimeType: 'image/png', dialogTitle: title, UTI: 'public.png' });
  return true;
}

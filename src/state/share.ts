// «Поделиться» на телефоне (docs/specs/2026-09-library.md, «Готово»; «Перенос» — docs/specs/2026-09-plus.md):
// файл кладётся во временную папку приложения и уходит в «Поделиться» Android — разрешений
// не нужно. В вебе — share.web.ts.
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Отдаёт файл системному «Поделиться»; false — делиться на этом телефоне нечем. */
export async function shareFile(bytes: Uint8Array, name: string, mimeType: string, title: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const f = new File(Paths.cache, name);
  if (f.exists) f.delete();
  f.create();
  f.write(bytes);
  await Sharing.shareAsync(f.uri, { mimeType, dialogTitle: title, UTI: mimeType === 'image/png' ? 'public.png' : 'public.data' });
  return true;
}

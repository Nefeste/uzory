// Файл, которым открыли игру (0.23.0; «Тайна от друга», issue 145, вариант Б): на Android касание файла
// тайны в мессенджере открывает «Узоры» (фильтр намерений в app.json, `intentFilters`) — адрес файла
// приходит в Linking (getInitialURL и событие «url»). Читается тем же File, что и выбор файла
// (expo-file-system): content:// он читает через ContentResolver. В вебе — incoming.web.ts.
import { File } from 'expo-file-system';
import { GIFT_MAX_BYTES, GiftError } from '../engine/gift';

/** Адрес — файл, а не ссылка: его стоит открыть как тайну. */
export const isFileUrl = (url: string | null | undefined): url is string => !!url && /^(content|file):\/\//.test(url);

/** Байты файла по адресу из Linking; больше подарка — GiftError('tooBig'): чужое не читается в память. */
export async function readIncoming(url: string): Promise<Uint8Array> {
  const f = new File(url);
  if ((f.size ?? 0) > GIFT_MAX_BYTES) throw new GiftError('tooBig');
  return f.bytes();
}

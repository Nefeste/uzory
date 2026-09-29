// Текст — наружу: на телефоне через «Поделиться» (мессенджер, почта, заметки), в вебе —
// в буфер обмена (clip.web.ts). false — не вышло: текст остаётся на экране, его можно выделить.
import { Share } from 'react-native';

export async function copyText(text: string): Promise<boolean> {
  try {
    await Share.share({ message: text });
    return true;
  } catch {
    return false;
  }
}

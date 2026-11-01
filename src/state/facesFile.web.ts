// Каскад детектора лиц в вебе (facesFile.ts — на телефоне): файл сборки рядом со страницей, тем же запросом,
// что и шрифты; снимок никуда не уходит.
import { Asset } from 'expo-asset';

export async function cascadeBytes(): Promise<Uint8Array> {
  // `.bin` — ресурс, как картинки и звуки (metro.config.js), а в списке ресурсов правила его нет
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const asset = Asset.fromModule(require('../../assets/faces/facefinder.bin'));
  const res = await fetch(asset.uri);
  if (!res.ok) throw new Error(`faces: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

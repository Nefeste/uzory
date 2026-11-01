// Каскад детектора лиц «Найти лица» на телефоне (0.24.0): ресурс assets/faces/facefinder.bin едет в APK и
// читается файлом (expo-asset, expo-file-system); в вебе — запросом к своей же папке, facesFile.web.ts.
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

export async function cascadeBytes(): Promise<Uint8Array> {
  // `.bin` — ресурс, как картинки и звуки (metro.config.js), а в списке ресурсов правила его нет
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const asset = Asset.fromModule(require('../../assets/faces/facefinder.bin'));
  await asset.downloadAsync();
  return new File(asset.localUri ?? asset.uri).bytes();
}

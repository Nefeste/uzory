// Веб-сборка — стенд для сценариев (docs/06-testing.md, §5): «файлы» работ живут
// в хранилище браузера строками base64. Поведение — как у src/state/files.ts.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { base64Decode, base64Encode } from '../engine/base64';

const key = (name: string) => `uzory.files.${name}`;

export async function readFile(name: string): Promise<Uint8Array | null> {
  const s = await AsyncStorage.getItem(key(name));
  return s === null ? null : base64Decode(s);
}

export async function writeFile(name: string, bytes: Uint8Array, keepBak = true): Promise<void> {
  const prev = await AsyncStorage.getItem(key(name));
  if (prev !== null && keepBak) await AsyncStorage.setItem(key(`${name}.bak`), prev);
  await AsyncStorage.setItem(key(name), base64Encode(bytes));
}

export async function removeFile(name: string): Promise<void> {
  await AsyncStorage.multiRemove([key(name), key(`${name}.bak`)]);
}

// Скачанные наборы в веб-версии: та же база IndexedDB, что у работ (src/state/files.web.ts),
// с приставкой `packs/`. Места браузер не сообщает — `freeSpace` не знает.
import { readFile, removeFile, writeFile } from './files';

export const readPackFile = (name: string) => readFile(`packs/${name}`);

export const writePackFile = (name: string, bytes: Uint8Array) => writeFile(`packs/${name}`, bytes, false);

export const removePackFile = (name: string) => removeFile(`packs/${name}`);

export const freeSpace = (): number | null => null;

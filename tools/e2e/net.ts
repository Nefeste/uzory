// Поддельная раздача для сценария (docs/specs/2026-09-packs.md, «Критерии приёмки»): наборы
// с маленькими узорами и каталог, подписанный ключом сценария. Закрытая половина ключа
// выводится из строки ниже — поэтому открытая (src/state/keys.ts, E2E_KEY) действует только
// в веб-сборке, открытой с этого же компьютера.
import { sha256 } from '@noble/hashes/sha2.js';
import { base64Encode } from '../../src/engine/base64';
import { utf8Encode } from '../../src/engine/utf8';
import type { CollectionId } from '../../src/engine/library';
import { writePack } from '../../src/engine/pack';
import type { Pattern } from '../../src/engine/pattern';

export const E2E_SECRET = base64Encode(sha256(utf8Encode('uzory-e2e-only: не для выпуска')));

/** Узор-шахматка квадратами 2 × 2 в две нити — проходит все проверки набора. */
function checker(key: string, side: number): Pattern {
  const cells = new Uint8Array(side * side);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) cells[y * side + x] = ((x >> 1) + (y >> 1)) & 1;
  return { key, w: side, h: side, threads: [{ rgb: 0xb3162f, name: 'кумачовая' }, { rgb: 0x1f3c34, name: 'еловая' }], cells };
}

/** Набор сценария: картинки-шахматки, вышедшие `added`. */
export function e2ePack(id: string, pics: { id: string; title: string; collection?: CollectionId }[], added: string): Uint8Array {
  return writePack({
    id, created: added,
    pictures: pics.map((p, i) => ({
      picture: {
        id: p.id, v: 1, title: p.title, collection: p.collection ?? 'ornaments', order: 1 + i, size: 'S',
        source: { url: '', basis: 'сценарий tools/e2e' }, added,
      },
      pattern: checker(`${p.id}@1`, 12),
    })),
  });
}

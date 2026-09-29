// Пара ключей подписи каталога (docs/03-server-api.md, «Подпись каталога»). Запускает владелец
// у себя, один раз и при смене ключа:
//
//   bun tools/content/keygen.ts
//
// Закрытый ключ — в секрет репозитория CATALOG_SIGNING_KEY (Settings → Secrets and variables →
// Actions) и больше никуда: не в чат, не в файл, не в репозиторий. Открытый — в
// src/state/keys.ts (CATALOG_KEYS): он не секрет, его можно прислать ассистенту.
import { newKeyPair } from '../../src/engine/sign';

const k = newKeyPair();
console.log(`Открытый ключ — в src/state/keys.ts, CATALOG_KEYS:\n  ${k.public}\n`);
console.log(`Закрытый ключ — только в секрет CATALOG_SIGNING_KEY:\n  ${k.secret}`);

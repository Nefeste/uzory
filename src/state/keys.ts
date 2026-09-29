// Открытые ключи подписи каталога (docs/03-server-api.md, «Подпись каталога»): нынешний и
// следующий — для смены ключа. Закрытые — только в секретах CI у владельца (docs/05-process.md,
// «Выкладывание наборов»; пару делает tools/content/keygen.ts). Пока ключей нет, ни один
// каталог не принимается: игра живёт встроенным набором.
import { LOCAL_TEST } from './net-env';

export const CATALOG_KEYS: readonly string[] = [];

/**
 * Ключ сценария tools/e2e (tools/e2e/net.ts): его закрытая половина выводится из строки в
 * репозитории, поэтому он действует только в веб-сборке, открытой с этого же компьютера.
 */
export const E2E_KEY = 'VZFOdk1M/xixWS3o/lpQHBZGZjHGOZHzfLw8TJbTle8=';

export const trustedKeys = (): readonly string[] => (LOCAL_TEST ? [...CATALOG_KEYS, E2E_KEY] : CATALOG_KEYS);

// Откуда телефон берёт каталог и наборы (docs/03-server-api.md): сервер студии, только HTTPS.
// В вебе — net-env.web.ts.
export const NET_BASE = 'https://gornitsa.games/uzory/v1/';

/** Открыто ли с этого же компьютера: ключ сценария tools/e2e на телефоне не действует никогда. */
export const LOCAL_TEST = false;

// Веб-версия берёт каталог с того же сайта, откуда открыта: правила безопасности сайта (CSP)
// пускают только туда — gornitsa.games/uzory/v1/. Сценарий tools/e2e поднимает поддельный
// сервер на 127.0.0.1: там и только там действует его ключ (src/state/keys.ts).
const here = typeof location === 'undefined' ? null : location;

export const NET_BASE = here ? `${here.origin}/uzory/v1/` : 'https://gornitsa.games/uzory/v1/';

export const LOCAL_TEST = !!here && (here.hostname === '127.0.0.1' || here.hostname === 'localhost');

/** Для счётчиков: закрытая веб-версия. */
export const STORE = 'web' as const;

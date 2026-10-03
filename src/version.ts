// Номер версии приложения — один на всё приложение. Поднимается вместе с app.json
// и package.json (docs/05-process.md, «Версии»); сверяет tools/test/version.test.ts.
export const APP_VERSION = '0.12.0';
/** Номер сборки (`versionCode` в app.json) — для отчёта об ошибке. */
export const APP_BUILD = 1;
/** Внутренние сборки 0.x — для проверки: раздел «Для проверки» на главной (docs/05-process.md, «Версии»). */
export const INTERNAL = APP_VERSION.startsWith('0.');

// Настройки Expo живут в app.json. Здесь — только адрес веб-сборки для сайта студии
// (docs/specs/2026-09-web.md): `UZORY_WEB_BASE=/uzory/test npm run export:web` собирает
// её для папки gornitsa.games/uzory/test/. Без переменной всё как в app.json.
module.exports = ({ config }) => {
  const base = process.env.UZORY_WEB_BASE;
  return base ? { ...config, experiments: { ...config.experiments, baseUrl: base } } : config;
};

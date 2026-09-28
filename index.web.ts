// из anamnez: index.web.ts @ 3d76cf5
// Точка входа веб-сборки (стенд для сценариев, docs/06-testing.md, §5, и закрытая
// веб-версия, docs/specs/2026-09-web.md; перенос из «Анамнеза»). Skia в браузере — это
// CanvasKit (WASM), а модуль Skia в вебе создаёт свой API при первом выполнении. Поэтому
// сначала загружается CanvasKit, и только потом выполняется приложение: `require` внутри
// then() — Metro кладёт модуль в тот же бандл, но выполняет его в момент вызова.
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { registerRootComponent } from 'expo';

// Сборка для папки сайта (`experiments.baseUrl`, app.config.js) ищет canvaskit.wasm в своей
// папке, а не в корне сайта; Expo подставляет адрес папки при сборке.
const base = process.env.EXPO_BASE_URL ?? '';

LoadSkiaWeb({ locateFile: (file: string) => `${base}/${file}` }).then(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  registerRootComponent(require('./App').default);
});

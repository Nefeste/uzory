// из anamnez: index.web.ts @ 3d76cf5
// Точка входа веб-сборки (стенд для сценариев, docs/06-testing.md, §5; перенос из
// «Анамнеза»). Skia в браузере — это CanvasKit (WASM), а модуль Skia в вебе создаёт свой
// API при первом выполнении. Поэтому сначала загружается CanvasKit, и только потом
// выполняется приложение: `require` внутри then() — Metro кладёт модуль в тот же бандл,
// но выполняет его в момент вызова.
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { registerRootComponent } from 'expo';

LoadSkiaWeb({ locateFile: (file: string) => `/${file}` }).then(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  registerRootComponent(require('./App').default);
});

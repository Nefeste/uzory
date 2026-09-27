// https://docs.expo.dev/guides/using-eslint/
// Кроме правил Expo и React Compiler — границы слоёв (docs/06-testing.md, §1): движок —
// чистый TypeScript без платформы, времени и случайности (ADR 0002, 0010).
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const ENGINE_PURE = 'Движок — чистый TypeScript без React, Expo и src/state (docs/02-architecture.md)';
const DETERMINISM = 'В движке нет Date.now() и Math.random(): время и зерно — аргументы (ADR 0010)';

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', 'dist-web/*', 'src/content/generated/*', 'research/*', 'public/*'] },
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['react', 'react-*', 'react-native', 'react-native-*', 'expo', 'expo-*', '@shopify/*', '@react-native-*/*'], message: ENGINE_PURE },
          { group: ['**/state/*', '**/ui/*', '**/render/*', '**/canvas/*', '**/screens/*', '**/i18n/*', '**/content/*'], message: ENGINE_PURE },
        ],
      }],
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: DETERMINISM },
        { object: 'Date', property: 'now', message: DETERMINISM },
        { object: 'performance', property: 'now', message: DETERMINISM },
      ],
      // new Date(число) детерминирован и нужен календарю; без аргументов — «сейчас»
      'no-restricted-syntax': ['error', { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: DETERMINISM }],
    },
  },
]);

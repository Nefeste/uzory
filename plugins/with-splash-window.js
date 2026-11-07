// из nardy: plugins/with-splash-window.js @ 0000bc3 — второй фон заставки, твёрдое правило устава (docs/05-rules.md, «Вид и тексты»).
// Заставка без белой вспышки (docs/08-game-design.md, «Вид»). Тема заставки
// `Theme.App.SplashScreen` (плагин expo-splash-screen) задаёт фон самой заставки, но фон окна
// (`android:windowBackground`) наследует от `Theme.SplashScreen` из androidx core-splashscreen, а та
// на Android 12+ — от системной `Theme.DeviceDefault.DayNight`: в светлой теме телефона он белый.
// HyperOS (Xiaomi 14T, Android 16; найдено на «Нардах» 1.2.0) при анимации запуска сначала рисует фон
// окна — белая вспышка до заставки. Здесь фон окна темы заставки — тот же цвет, что и фон заставки:
// лён в светлой теме, ночной — в тёмной (`splashscreen_background` есть в values и values-night).
//
// Моды Expo выполняются в обратном порядке списка плагинов: этот плагин стоит в app.json ПЕРЕД
// expo-splash-screen, иначе тот пересоздаст тему поверх (проверяет tools/test/splash.test.ts).
const { withAndroidStyles } = require('expo/config-plugins');

const THEME = 'Theme.App.SplashScreen';
const ITEM = 'android:windowBackground';
const VALUE = '@color/splashscreen_background';

/** styles.xml: у темы заставки — свой фон окна; темы нет — ничего не меняется. */
function styles(xml) {
  const style = (xml.resources.style ?? []).find(s => s.$.name === THEME);
  if (!style) return xml;
  style.item = (style.item ?? []).filter(i => i.$.name !== ITEM);
  style.item.unshift({ $: { name: ITEM }, _: VALUE });
  return xml;
}

const withSplashWindow = config => withAndroidStyles(config, c => {
  c.modResults = styles(c.modResults);
  return c;
});

module.exports = withSplashWindow;
module.exports.transforms = { styles, THEME, ITEM, VALUE };

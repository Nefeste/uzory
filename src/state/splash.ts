// Нативная заставка (expo-splash-screen, плагин в app.json; картинка — tools/store/splash.ts): «Узоры» и
// кайма рушника на льне держатся, пока главная не готова целиком — игрок и указатель работ прочитаны, —
// чтобы главная не собиралась на глазах (разбор оформления 31.10.2026, 1.1 и Б2). Не дольше SPLASH_MAX_MS:
// что бы ни случилось с главной, заставка не повиснет. В вебе заставки нет, вызовы ничего не делают.
import * as SplashScreen from 'expo-splash-screen';
import { logError } from './crashlog';

const SPLASH_MAX_MS = 4000;
let hidden = false;

/** Из App.tsx при загрузке модуля: заставка не уходит сама, когда появляется первый кадр. */
export function keepSplash(): void {
  SplashScreen.preventAutoHideAsync().catch((e: unknown) => logError('render', e, 'splash keep'));
  setTimeout(hideSplash, SPLASH_MAX_MS);
}

/** Главная готова — заставка уходит; второй вызов ничего не делает. */
export function hideSplash(): void {
  if (hidden) return;
  hidden = true;
  SplashScreen.hideAsync().catch((e: unknown) => logError('render', e, 'splash hide'));
}

// Заставка (разбор оформления 31.10.2026, 1.1; src/state/splash.ts): плагин expo-splash-screen в app.json —
// поле цветом темы, картинка — «Узоры» и кайма рушника (tools/store/splash.ts). Android 12 и новее
// показывает картинку заставки в круге 192 dp из поля 288 dp: всё нарисованное — внутри этого круга.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { DARK, LIGHT } from '../../src/ui/theme';

const ROOT = join(import.meta.dir, '..', '..');
const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'));
const plugin = (app.expo.plugins as unknown[]).find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen') as
  | [string, { backgroundColor: string; image: string; imageWidth: number; dark: { backgroundColor: string; image: string } }]
  | undefined;

describe('заставка', () => {
  test('плагин в app.json: поле — фон темы, картинки на месте, ширина не больше поля 288 dp', () => {
    expect(plugin).toBeDefined();
    const cfg = plugin![1];
    expect(cfg.backgroundColor.toLowerCase()).toBe(LIGHT.bg.toLowerCase());
    expect(cfg.dark.backgroundColor.toLowerCase()).toBe(DARK.bg.toLowerCase());
    expect(existsSync(join(ROOT, cfg.image))).toBe(true);
    expect(existsSync(join(ROOT, cfg.dark.image))).toBe(true);
    expect(cfg.imageWidth).toBeLessThanOrEqual(288);
  });

  test('всё нарисованное — внутри круга, который показывает Android 12', async () => {
    const cfg = plugin![1];
    for (const file of [cfg.image, cfg.dark.image]) {
      const { data, info } = await sharp(join(ROOT, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(info.width).toBe(info.height);
      // круг 192 dp из картинки шириной imageWidth dp — в точках картинки
      const r = (info.width / 2) * (192 / cfg.imageWidth);
      let outside = 0;
      let inked = 0;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          if (data[(y * info.width + x) * 4 + 3] === 0) continue;
          inked++;
          if (Math.hypot(x + 0.5 - info.width / 2, y + 0.5 - info.height / 2) > r) outside++;
        }
      }
      expect(inked, file).toBeGreaterThan(1000);
      expect(outside, file).toBe(0);
    }
  });

  test('второй фон: у темы заставки фон окна — цвет заставки (правило устава), плагин — перед expo-splash-screen', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { transforms: t } = require('../../plugins/with-splash-window.js') as {
      transforms: { styles: (x: Styles) => Styles; THEME: string; ITEM: string; VALUE: string };
    };
    type Styles = { resources: { style: { $: { name: string }; item?: { $: { name: string }; _: string }[] }[] } };
    const xml: Styles = { resources: { style: [
      { $: { name: 'AppTheme' }, item: [{ $: { name: 'android:windowBackground' }, _: '@color/activityBackground' }] },
      { $: { name: t.THEME }, item: [{ $: { name: 'windowSplashScreenBackground' }, _: '@color/splashscreen_background' }] },
    ] } };
    const out = t.styles(xml).resources.style;
    expect(out.find((s) => s.$.name === t.THEME)!.item!.filter((i) => i.$.name === t.ITEM).map((i) => i._)).toEqual(['@color/splashscreen_background']);
    expect(out.find((s) => s.$.name === 'AppTheme')!.item![0]._).toBe('@color/activityBackground');
    // моды Expo — в обратном порядке: плагин раньше в списке — его правка ложится поверх темы expo-splash-screen
    const names = (app.expo.plugins as unknown[]).map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names.indexOf('./plugins/with-splash-window')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('./plugins/with-splash-window')).toBeLessThan(names.indexOf('expo-splash-screen'));
  });
});

// Картинка заставки (docs/08-game-design.md, «Вид»; разбор оформления 31.10.2026, 1.1): «Узоры» шрифтом
// Kurale кумачом и под ним кайма рушника крестиками, на прозрачном поле — цвет поля заставка берёт из
// app.json (лён, в тёмной теме — ночной фон темы). Всё — в круге в две трети стороны: Android 12 и новее
// показывает картинку заставки в круглом окне, края обрезаются.
//
//   bun tools/store/splash.ts → assets/splash-icon.png и assets/splash-icon-dark.png (1024 × 1024)
//
// Кайма — узор «kayma-rushnika» из встроенного набора (src/content/generated, `bun tools/content/build.ts`),
// стежки — две косые черты на клетку, без канвы: на тёмном поле канвы быть не должно.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { base64Decode } from '../../src/engine/base64';
import { openPack, packPattern } from '../../src/engine/pack';
import { CANVAS } from '../../src/engine/pattern';
import { DARK, LIGHT } from '../../src/ui/theme';
import { BASE_PACK } from '../../src/content/generated/pack';
import { canvasKit } from '../canvas/ck';

const ROOT = join(import.meta.dir, '..', '..');
const SIDE = 1024;
/** Видимый круг Android 12 — две трети стороны; содержимое — с запасом внутри него. */
const SAFE = (SIDE * 2) / 3 - 40;

const pack = openPack(base64Decode(BASE_PACK));
const pics = pack.json.pictures.filter((p) => p.id === 'kayma-rushnika');
if (!pics.length) throw new Error('во встроенном наборе нет «kayma-rushnika»: bun tools/content/build.ts');
const band = packPattern(pack, pics.reduce((a, b) => (b.v > a.v ? b : a)));

const WORD = 'Узоры';

/** Заставка со словом цвета `color`: в светлой теме — кумач, в тёмной — светлый кумач тёмной темы. */
async function splash(color: string): Promise<Uint8Array> {
  const word = WORD;
  const CK = await canvasKit();
  const kurale = CK.Typeface.MakeTypefaceFromData(readFileSync(join(ROOT, 'node_modules/@expo-google-fonts/kurale/400Regular/Kurale_400Regular.ttf')).buffer);
  const surface = CK.MakeSurface(SIDE, SIDE);
  const c = surface.getCanvas();
  c.clear(CK.TRANSPARENT);
  const paint = new CK.Paint();
  paint.setAntiAlias(true);

  // слово — по ширине безопасного круга с запасом под кайму
  let size = 200;
  const font = new CK.Font(kurale, size);
  const widthAt = () => font.getGlyphWidths(font.getGlyphIDs(word)).reduce((a: number, b: number) => a + b, 0);
  while (widthAt() > SAFE * 0.9) font.setSize((size -= 4));
  const w = widthAt();
  // кайма: столько повторов узора, сколько влезает в ширину слова
  const cell = Math.max(6, Math.floor(w / (band.w * 3)));
  const reps = Math.max(1, Math.floor(w / (band.w * cell)));
  const bw = band.w * reps * cell;
  const bh = band.h * cell;
  const gap = size * 0.25;
  const total = size * 0.8 + gap + bh;
  const top = (SIDE - total) / 2;

  paint.setColor(CK.parseColorString(color));
  c.drawText(word, (SIDE - w) / 2, top + size * 0.8, paint, font);

  const x0 = (SIDE - bw) / 2;
  const y0 = top + size * 0.8 + gap;
  paint.setStyle(CK.PaintStyle.Stroke);
  paint.setStrokeCap(CK.StrokeCap.Round);
  paint.setStrokeWidth(cell * 0.32);
  const e = cell * 0.18;
  for (let r = 0; r < reps; r++) {
    for (let y = 0; y < band.h; y++) {
      for (let x = 0; x < band.w; x++) {
        const t = band.cells[y * band.w + x];
        if (t === CANVAS) continue;
        const rgb = band.threads[t].rgb;
        paint.setColor(CK.Color((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 1));
        const cx = x0 + (r * band.w + x) * cell;
        const cy = y0 + y * cell;
        c.drawLine(cx + e, cy + e, cx + cell - e, cy + cell - e, paint);
        c.drawLine(cx + cell - e, cy + e, cx + e, cy + cell - e, paint);
      }
    }
  }
  surface.flush();
  return surface.makeImageSnapshot().encodeToBytes() as Uint8Array;
}

writeFileSync(join(ROOT, 'assets', 'splash-icon.png'), await splash(LIGHT.accent));
// тёмный кумач на ночном фоне не читается — слово светлым кумачом тёмной темы
writeFileSync(join(ROOT, 'assets', 'splash-icon-dark.png'), await splash(DARK.accent));
console.log('assets/splash-icon.png, assets/splash-icon-dark.png');

// Знаки интерфейса (разбор оформления 31.10.2026, 3.3): свои, нарисованы кодом — тонкие линии со
// скруглёнными концами в поле 24 × 24, белым на прозрачном; цвет темы им даёт `tintColor`
// (src/ui/Icon.tsx). Чужого набора иконок и новой зависимости ради трёх знаков нет. Иконка самой игры —
// tools/store/icons.ts.
//
//   bun tools/store/ui-icons.ts → assets/ui/<имя>.png (72 × 72: 24 dp при плотности 3)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canvasKit } from '../canvas/ck';

const ROOT = join(import.meta.dir, '..', '..');
const SCALE = 3;
const STROKE = 2;

/** Линии — путями SVG в поле 24 × 24; точки — кружками [x, y, r]. */
export const UI_ICONS: Record<string, { lines?: string[]; dots?: [number, number, number][] }> = {
  // назад: шеврон влево
  back: { lines: ['M15 4.5 L7.5 12 L15 19.5'] },
  // меню: три точки столбиком
  more: { dots: [[12, 5, 2], [12, 12, 2], [12, 19, 2]] },
  // «Где ещё?»: лупа
  search: { lines: ['M17 10.5 A6.5 6.5 0 1 1 4 10.5 A6.5 6.5 0 1 1 17 10.5 Z', 'M15.3 15.3 L20 20'] },
};

if (import.meta.main) {
  const CK = await canvasKit();
  const out = join(ROOT, 'assets', 'ui');
  mkdirSync(out, { recursive: true });
  for (const [name, icon] of Object.entries(UI_ICONS)) {
    const surface = CK.MakeSurface(24 * SCALE, 24 * SCALE);
    const c = surface.getCanvas();
    c.clear(CK.TRANSPARENT);
    c.scale(SCALE, SCALE);
    const paint = new CK.Paint();
    paint.setAntiAlias(true);
    paint.setColor(CK.WHITE);
    paint.setStyle(CK.PaintStyle.Stroke);
    paint.setStrokeWidth(STROKE);
    paint.setStrokeCap(CK.StrokeCap.Round);
    paint.setStrokeJoin(CK.StrokeJoin.Round);
    for (const d of icon.lines ?? []) {
      const path = CK.Path.MakeFromSVGString(d);
      if (!path) throw new Error(`путь знака ${name}: ${d}`);
      c.drawPath(path, paint);
    }
    paint.setStyle(CK.PaintStyle.Fill);
    for (const [x, y, r] of icon.dots ?? []) c.drawCircle(x, y, r, paint);
    surface.flush();
    writeFileSync(join(out, `${name}.png`), surface.makeImageSnapshot().encodeToBytes() as Uint8Array);
  }
  console.log(Object.keys(UI_ICONS).map((n) => `assets/ui/${n}.png`).join(', '));
}

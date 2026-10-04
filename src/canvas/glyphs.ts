// Атлас цифр канвы: ячейка и шрифт. Без Skia — эти числа нужны и тестам (номер не мельче 13 sp,
// tools/test/canvas.test.ts), и канве на CanvasKit (tools/canvas/ck.ts).

/** Ячейка атласа цифр, точки. Цифра — белая, прозрачный фон. */
export const GLYPH_W = 32;
export const GLYPH_H = 48;

/** Размер шрифта цифр для атласа: высота цифры — 0,75 ячейки. */
export const DIGIT_FONT_SIZE = 50;

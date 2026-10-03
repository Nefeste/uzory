// Раскладка картинки «Поделиться» (docs/specs/2026-09-library.md, «Готово»): где на ней работа,
// рамка, паспарту и строки подписи, какого они цвета. Рисует src/render/share.ts; сценарий
// Playwright по той же раскладке разбирает скачанный PNG (tools/e2e/smoke.ts).
// Чистый TypeScript: без React, платформы, времени и случайности (ADR 0002, 0010).

/** Работа — длинная сторона не больше стольких точек; с рамкой и подписью — не больше 2000. */
export const SHARE_PICTURE_MAX = 1600;
/** Клетка работы — не больше стольких точек. */
export const SHARE_CELL_MAX = 64;
/** Поле вокруг рамки, рамка, паспарту и место под подпись, в точках. */
const OUT = 72;
const FRAME = 18;
const MAT = 44;
const CAPTION = 190;

/** Цвета картинки: льняной фон, тёмное дерево рамки, бумажное паспарту, строки подписи. */
export const SHARE_COLORS = {
  background: '#ecede6',
  frame: '#6f5641',
  mat: '#f7f7f2',
  title: '#1a1b1e',
  caption: '#4b4f4c',
  mark: '#b3162f',
} as const;

export interface ShareRect { x: number; y: number; w: number; h: number }

export interface ShareLayout {
  /** точек на клетку работы */
  cell: number;
  /** размер всей картинки */
  width: number;
  height: number;
  frame: ShareRect;
  mat: ShareRect;
  work: ShareRect;
  /** базовые линии строк по центру под рамкой: название, подпись картины, «Вышито в „Узорах“» */
  title: number;
  caption: number;
  mark: number;
  /** «Вышито в „Узорах“», когда подписи нет (свои работы студии) */
  markAlone: number;
}

/** Раскладка для узора w × h клеток. */
export function shareLayout(w: number, h: number): ShareLayout {
  const cell = Math.max(1, Math.min(SHARE_CELL_MAX, Math.floor(SHARE_PICTURE_MAX / Math.max(w, h))));
  const pw = w * cell;
  const ph = h * cell;
  const base = OUT + ph + 2 * (MAT + FRAME);
  return {
    cell,
    width: pw + 2 * (MAT + FRAME + OUT),
    height: ph + 2 * (MAT + FRAME) + OUT + CAPTION,
    frame: { x: OUT, y: OUT, w: pw + 2 * (MAT + FRAME), h: ph + 2 * (MAT + FRAME) },
    mat: { x: OUT + FRAME, y: OUT + FRAME, w: pw + 2 * MAT, h: ph + 2 * MAT },
    work: { x: OUT + FRAME + MAT, y: OUT + FRAME + MAT, w: pw, h: ph },
    title: base + 72,
    caption: base + 118,
    mark: base + 164,
    markAlone: base + 130,
  };
}

// Раскладка картинки «Поделиться» (docs/specs/2026-09-library.md, «Готово»): где на ней работа,
// рамка, паспарту и строки подписи, какого они цвета. Рисует src/render/share.ts; сценарий
// Playwright по той же раскладке разбирает скачанный PNG (tools/e2e/smoke.ts).
// Чистый TypeScript: без React, платформы, времени и случайности (ADR 0002, 0010).

/** Работа — длинная сторона не больше стольких точек; с рамкой и подписью — не больше 2000. */
export const SHARE_PICTURE_MAX = 1600;
/** Клетка работы — не больше стольких точек. */
export const SHARE_CELL_MAX = 64;
/**
 * Стежки — крестик или плитка — с клетки в столько точек; мельче — ровным цветом, как канва
 * издалека. На канве стиль виден вместе с номерами, с 18 dp, а номеров на законченной работе нет:
 * порог свой, выбран по образцам (решение владельца 09.10.2026).
 */
export const SHARE_STITCHES_FROM = 14;

/**
 * Стежки на картинке: игрок включил «Стежки на картинке „Поделиться“» (по умолчанию выключено —
 * владелец считает их лишними, 15.10.2026) и клетка не мельче `SHARE_STITCHES_FROM`; иначе клетки
 * ровным цветом в любом стиле.
 */
export function shareStitches(cell: number, wanted: boolean): boolean {
  return wanted && cell >= SHARE_STITCHES_FROM;
}

/** Поле вокруг рамки, рамка, паспарту и место под подпись, в точках. */
const OUT = 72;
const FRAME = 18;
const MAT = 44;
const CAPTION = 190;
/** Пяльцы (оформление «Пяльцы», src/engine/looks.ts): обод и поля ткани от углов узора до обода. */
export const HOOP_RING = 22;
const HOOP_PAD = 36;

/** Цвета картинки: льняной фон, бумажное паспарту, строки подписи; рамка — оформления (src/engine/looks.ts). */
export const SHARE_COLORS = {
  background: '#ecede6',
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

/**
 * Раскладка для узора w × h клеток. В рамке — рамка, паспарту, работа. В пяльцах (`hoop`) — квадраты,
 * описанные вокруг кругов: `frame` — обода, `mat` — ткани; работа в середине, её углы — внутри круга ткани.
 */
export function shareLayout(w: number, h: number, hoop = false): ShareLayout {
  // в пяльцах до SHARE_PICTURE_MAX — диагональ работы: она поперёк круга ткани
  const cell = Math.max(1, Math.min(SHARE_CELL_MAX, Math.floor(SHARE_PICTURE_MAX / (hoop ? Math.hypot(w, h) : Math.max(w, h)))));
  const pw = w * cell;
  const ph = h * cell;
  if (hoop) {
    const din = Math.ceil(Math.hypot(pw, ph)) + 2 * HOOP_PAD;
    const dout = din + 2 * HOOP_RING;
    const base = OUT + dout;
    return {
      cell,
      width: dout + 2 * OUT,
      height: dout + OUT + CAPTION,
      frame: { x: OUT, y: OUT, w: dout, h: dout },
      mat: { x: OUT + HOOP_RING, y: OUT + HOOP_RING, w: din, h: din },
      work: { x: OUT + HOOP_RING + Math.floor((din - pw) / 2), y: OUT + HOOP_RING + Math.floor((din - ph) / 2), w: pw, h: ph },
      title: base + 72,
      caption: base + 118,
      mark: base + 164,
      markAlone: base + 130,
    };
  }
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

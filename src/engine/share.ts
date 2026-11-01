// Раскладка картинки «Поделиться» (docs/specs/2026-09-library.md, «Готово»): где на ней работа,
// рамка, паспарту и строки подписи, какого они цвета. Рисует src/render/share.ts; сценарий
// Playwright по той же раскладке разбирает скачанный PNG (tools/e2e/smoke.ts).
// Чистый TypeScript: без React, платформы, времени и случайности (ADR 0002, 0010).

/** Работа — длинная сторона не больше стольких точек; с рамкой и подписью — не больше SHARE_MAX. */
export const SHARE_PICTURE_MAX = 1600;
export const SHARE_MAX = 2000;
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

/** Поле вокруг рамки, рамка (резная — шире), паспарту или поле ткани без него и место под подпись, в точках. */
const OUT = 72;
const FRAME = 18;
const CARVED = 30;
const MAT = 44;
const FABRIC = 28;
const CAPTION = 190;
/** Точек «Поделиться» на dp сцены «Готово» (src/render/scene.ts): винт, бант, гвоздь, скос паспарту — у работы до SHARE_BASE. */
export const SHARE_K = 2;
/**
 * Рама, паспарту, обод и поля растут вместе с работой (с 0.21.0): у работы больше стольких точек — во столько
 * раз толще; на картинке в 2000 точек рама в 18 точек выглядела ниткой.
 */
export const SHARE_BASE = 800;
/** Пяльцы (оформление «Пяльцы», src/engine/looks.ts): обод и поля ткани от углов узора до обода. */
export const HOOP_RING = 22;
const HOOP_PAD = 36;

/**
 * Цвета картинки: льняной фон (без стены), бумажное паспарту, строки подписи; рамка и стена — оформления
 * (src/engine/looks.ts); на стене строки подписи — на светлой табличке.
 */
export const SHARE_COLORS = {
  background: '#ecede6',
  mat: '#f7f7f2',
  plaque: '#f4efe4',
  title: '#1a1b1e',
  caption: '#4b4f4c',
  mark: '#b3162f',
} as const;

export interface ShareRect { x: number; y: number; w: number; h: number }

export interface ShareLayout {
  /** точек на клетку работы */
  cell: number;
  /** точек на dp сцены (src/render/scene.ts): винт, бант, гвоздь, скос паспарту */
  k: number;
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
 * Раскладка для узора w × h клеток. В рамке — рамка, паспарту (без него — поле ткани канвы), работа; резная
 * рамка шире (с 0.21.0). В пяльцах (`hoop`) — квадраты, описанные вокруг кругов: `frame` — обода, `mat` —
 * ткани; работа в середине, её углы — внутри круга ткани.
 */
export function shareLayout(w: number, h: number, hoop = false, o: { mat?: boolean; carved?: boolean } = {}): ShareLayout {
  // в пяльцах до SHARE_PICTURE_MAX — диагональ работы: она поперёк круга ткани
  const cell = Math.max(1, Math.min(SHARE_CELL_MAX, Math.floor(SHARE_PICTURE_MAX / (hoop ? Math.hypot(w, h) : Math.max(w, h)))));
  return hoop ? hoopLayout(w, h, cell) : frameLayout(w, h, cell, o);
}

/**
 * Во сколько раз рама, паспарту и поля толще, чем у работы до SHARE_BASE: как работа больше SHARE_BASE, но так,
 * чтобы картинка осталась не больше SHARE_MAX — клетка работы от рамы не мельчает (с неё зависят стежки).
 * `across` — поля поперёк (сумма по обе стороны), `along` — по высоте без строк подписи, при толщине 1.
 */
function grow(side: number, pw: number, ph: number, across: number, along: number): number {
  return Math.max(1, Math.min(side / SHARE_BASE, (SHARE_MAX - pw) / across, (SHARE_MAX - CAPTION - ph) / along));
}

/** В пяльцах: квадраты, описанные вокруг кругов, — `frame` обода, `mat` ткани; работа в середине. */
function hoopLayout(w: number, h: number, cell: number): ShareLayout {
  const pw = w * cell;
  const ph = h * cell;
  const din0 = Math.ceil(Math.hypot(pw, ph));
  const q = grow(din0, din0, din0, 2 * (HOOP_PAD + HOOP_RING + OUT), 2 * (HOOP_PAD + HOOP_RING) + OUT);
  // вниз: поля с округлением вверх могли бы вывести картинку за SHARE_MAX
  const ring = Math.floor(HOOP_RING * q);
  const pad = Math.floor(HOOP_PAD * q);
  const out = Math.floor(OUT * q);
  const din = din0 + 2 * pad;
  const dout = din + 2 * ring;
  const base = out + dout;
  return {
    cell,
    k: SHARE_K * q,
    width: dout + 2 * out,
    height: dout + out + CAPTION,
    frame: { x: out, y: out, w: dout, h: dout },
    mat: { x: out + ring, y: out + ring, w: din, h: din },
    work: { x: out + ring + Math.floor((din - pw) / 2), y: out + ring + Math.floor((din - ph) / 2), w: pw, h: ph },
    title: base + 72,
    caption: base + 118,
    mark: base + 164,
    markAlone: base + 130,
  };
}

/** В раме: рама, паспарту (без него — поле ткани канвы), работа. */
function frameLayout(w: number, h: number, cell: number, o: { mat?: boolean; carved?: boolean }): ShareLayout {
  const pw = w * cell;
  const ph = h * cell;
  const F0 = o.carved ? CARVED : FRAME;
  const M0 = o.mat === false ? FABRIC : MAT;
  const q = grow(Math.max(pw, ph), pw, ph, 2 * (M0 + F0 + OUT), 2 * (M0 + F0) + OUT);
  const F = Math.floor(F0 * q);
  const M = Math.floor(M0 * q);
  const out = Math.floor(OUT * q);
  const base = out + ph + 2 * (M + F);
  return {
    cell,
    k: SHARE_K * q,
    width: pw + 2 * (M + F + out),
    height: ph + 2 * (M + F) + out + CAPTION,
    frame: { x: out, y: out, w: pw + 2 * (M + F), h: ph + 2 * (M + F) },
    mat: { x: out + F, y: out + F, w: pw + 2 * M, h: ph + 2 * M },
    work: { x: out + F + M, y: out + F + M, w: pw, h: ph },
    title: base + 72,
    caption: base + 118,
    mark: base + 164,
    markAlone: base + 130,
  };
}

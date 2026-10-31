// Оформления (решение владельца 31.10.2026, issue 116, вариант Б; docs/08-game-design.md, «Оформления»):
// цвет канвы и рамка на «Готово» и «Поделиться» — навсегда, по 99 ₽, «Все оформления» — 299 ₽.
// Библиотеку и подписку они не трогают. Кремовая канва и тёмное дерево — у всех, как было до 0.18.0.
// Цвета — sRGB 0…1, как константы шейдера (src/canvas/shader.ts): кремовая — ровно прежние CLOTH, HOLE
// и GHOST, поэтому без покупки игра выглядит, как прежде, до точки.

export type CanvasId = 'cream' | 'white' | 'linen' | 'black' | 'blue';
export type FrameId = 'walnut' | 'baguette' | 'birch' | 'hoop';
export type LookId = CanvasId | FrameId;

export type Rgb = readonly [number, number, number];

export interface CanvasLook {
  id: CanvasId;
  /** нить канвы */
  cloth: Rgb;
  /** дырочки в углах клеток — тень в глубине плетения */
  hole: Rgb;
  /** невышитая клетка издалека — светлее канвы, под серым тоном своей нити */
  ghost: Rgb;
}

export interface FrameLook {
  id: FrameId;
  /** скошенная рамка или круглые пяльцы */
  kind: 'bevel' | 'hoop';
  /** грань к свету (сверху слева) и в тени (снизу справа) */
  light: string;
  dark: string;
  /** тонкая полоска по внутреннему краю: золочение багета; нет — без неё */
  inner?: string;
}

/** Тень дырочки — во столько темнее нити канвы, по каналам: как у кремовой, тёплая. */
const HOLE_K: Rgb = [0.63, 0.612, 0.574];
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const holeOf = (c: Rgb): Rgb => [c[0] * HOLE_K[0], c[1] * HOLE_K[1], c[2] * HOLE_K[2]];
/** Невышитое издалека — на четверть пути к белому у светлой канвы, на десятую — у тёмной. */
const ghostOf = (c: Rgb): Rgb => {
  const t = luminance(c) > 0.3 ? 0.25 : 0.1;
  return [c[0] + (1 - c[0]) * t, c[1] + (1 - c[1]) * t, c[2] + (1 - c[2]) * t];
};

/** Относительная яркость sRGB (WCAG). */
export function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const canvas = (id: CanvasId, color: string): CanvasLook => {
  const cloth = hex(color);
  return { id, cloth, hole: holeOf(cloth), ghost: ghostOf(cloth) };
};

/** Канвы: первая — у всех. Аида настоящих цветов: белая, небелёный лён, чёрная, голубая. */
export const CANVASES: readonly CanvasLook[] = [
  // прежние константы шейдера, до точки
  { id: 'cream', cloth: [0.953, 0.941, 0.902], hole: [0.6, 0.576, 0.518], ghost: [0.965, 0.965, 0.949] },
  canvas('white', '#fbfbf8'),
  canvas('linen', '#cfc1a3'),
  canvas('black', '#262628'),
  canvas('blue', '#c6d9e8'),
];

/** Рамки на «Готово» и «Поделиться»: первая — у всех. */
export const FRAMES: readonly FrameLook[] = [
  { id: 'walnut', kind: 'bevel', light: '#8b6d52', dark: '#4e3b2b' },
  { id: 'baguette', kind: 'bevel', light: '#e3c47e', dark: '#8c6a27', inner: '#f6e7b8' },
  { id: 'birch', kind: 'bevel', light: '#e6cfa8', dark: '#b2916a' },
  { id: 'hoop', kind: 'hoop', light: '#dcbb8f', dark: '#9e7c54' },
];

export const FREE_CANVAS: CanvasId = 'cream';
export const FREE_FRAME: FrameId = 'walnut';
const FREE: readonly LookId[] = [FREE_CANVAS, FREE_FRAME];

/** Товары навсегда в консоли RuStore: по одному на оформление и «Все оформления». */
export const ALL_LOOKS = 'uzory_looks_all';
export const productOf = (id: LookId) => `uzory_look_${id}`;
/** Все товары оформлений — для вопроса магазину о ценах и покупках. */
export const LOOK_PRODUCTS: readonly string[] = [
  ...CANVASES.filter((c) => !FREE.includes(c.id)).map((c) => productOf(c.id)),
  ...FRAMES.filter((f) => !FREE.includes(f.id)).map((f) => productOf(f.id)),
  ALL_LOOKS,
];

export const isFree = (id: LookId) => FREE.includes(id);

/** Сохранённое и ответ магазина → купленные товары: только наши, без повторов, в порядке каталога; чужое — пусто. */
export function ownedOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return LOOK_PRODUCTS.filter((id) => raw.includes(id));
}

/**
 * Есть ли у игрока оформление: бесплатное — у всех; `open` — сборка не запирает (0.x для проверки);
 * иначе — купленное отдельно или «Все оформления». `owned` — товары из последнего ответа магазина.
 */
export function lookOwned(id: LookId, owned: readonly string[], open: boolean): boolean {
  return isFree(id) || open || owned.includes(ALL_LOOKS) || owned.includes(productOf(id));
}

/** Канва по id; незнакомая (из будущей версии, испорченная настройка) — бесплатная. */
export function canvasLook(id: unknown): CanvasLook {
  return CANVASES.find((c) => c.id === id) ?? CANVASES[0];
}

/** Рамка по id; незнакомая — бесплатная. */
export function frameLook(id: unknown): FrameLook {
  return FRAMES.find((f) => f.id === id) ?? FRAMES[0];
}

/**
 * Что показывать: выбранное, если оно есть у игрока, иначе бесплатное. Так покупка, которую магазин
 * больше не подтверждает (возврат денег), и выбор, сделанный в сборке для проверки, не остаются.
 */
export function shownLooks(chosen: { canvas: unknown; frame: unknown }, owned: readonly string[], open: boolean): { canvas: CanvasLook; frame: FrameLook } {
  const c = canvasLook(chosen.canvas);
  const f = frameLook(chosen.frame);
  return {
    canvas: lookOwned(c.id, owned, open) ? c : canvasLook(FREE_CANVAS),
    frame: lookOwned(f.id, owned, open) ? f : frameLook(FREE_FRAME),
  };
}

// Оформления (решение владельца 31.10.2026, issue 116, вариант Б; docs/08-game-design.md, «Оформления»).
// С 0.20.0 (владелец 01.11.2026: «делай канву фоном узора») канва — часть работы, а не товар: пять цветов
// бесплатно, у каждой работы свой (src/state/works.ts), по умолчанию — подходящий узору (`suitedCanvas`):
// невышитый фон орнамента, «Детям», старинной схемы и «Своего узора» с фоном «не вышивать» — это ткань
// канвы. Навсегда продаются рамки и (с 0.21.0) стены на «Готово» и «Поделиться», по 99 ₽, «Все оформления» —
// 299 ₽; тёмное дерево и светлый фон без стены — у всех, паспарту и лента на пяльцах — бесплатно (владелец
// 01.11.2026: «делай А, Б, В, Г и Д» — паспарту, резная рама, пяльцы с лентой, работа на стене, подпись).
// Библиотеку и подписку оформления не трогают. Цвета — sRGB 0…1, как константы шейдера
// (src/canvas/shader.ts): кремовая — ровно прежние CLOTH, HOLE и GHOST, поэтому у узора без невышитого
// фона игра выглядит, как прежде, до точки.
import { deltaOK, rgbToLab } from './color';
import { CANVAS, type Pattern } from './pattern';

export type CanvasId = 'cream' | 'white' | 'linen' | 'black' | 'blue';
export type FrameId = 'walnut' | 'baguette' | 'birch' | 'hoop' | 'carved';
/** Стена за работой на «Готово» и «Поделиться» (с 0.21.0): без стены — светлый фон, как было. */
export type WallId = 'plain' | 'izba' | 'city' | 'dacha';
/** То, что продаётся: рамки и стены. */
export type LookId = FrameId | WallId;

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
  /** резная рама (0.21.0): волокно дерева по граням и розетки по углам */
  carved?: true;
  /** пяльцы (0.21.0): лента бантом на винте, её цвет */
  ribbon?: string;
}

export interface WallLook {
  id: WallId;
  /** основной тон стены и тень швов (брёвна, доски, рисунок обоев) */
  base: string;
  shade: string;
  /** светлый тон: блик на бревне, рисунок обоев, свет из окна */
  light: string;
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

/** Канвы — бесплатно; первая, кремовая, — по умолчанию. Аида настоящих цветов: белая, небелёный лён, чёрная, голубая. */
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
  { id: 'hoop', kind: 'hoop', light: '#dcbb8f', dark: '#9e7c54', ribbon: '#b3162f' },
  { id: 'carved', kind: 'bevel', light: '#8f6743', dark: '#3e2717', inner: '#d6b260', carved: true },
];

/** Стены (0.21.0): первая — у всех, светлый фон без стены, как до 0.21.0. */
export const WALLS: readonly WallLook[] = [
  { id: 'plain', base: '#ecede6', shade: '#ecede6', light: '#ecede6' },
  { id: 'izba', base: '#b88c5a', shade: '#5a3d22', light: '#d9b47f' },
  { id: 'city', base: '#9fb3a2', shade: '#7f9583', light: '#c7d4c3' },
  { id: 'dacha', base: '#e8e1cf', shade: '#b9ae93', light: '#fbf7ec' },
];

export const FREE_CANVAS: CanvasId = 'cream';
export const FREE_FRAME: FrameId = 'walnut';
export const FREE_WALL: WallId = 'plain';

/** Товары навсегда в консоли RuStore: по одному на платную рамку и стену и «Все оформления». */
export const ALL_LOOKS = 'uzory_looks_all';
export const productOf = (id: LookId) => `uzory_look_${id}`;
/**
 * Все товары оформлений — для вопроса магазину о ценах и покупках. С 0.20.0 канв среди них нет; с 0.21.0 —
 * резная рама и три стены.
 */
export const LOOK_PRODUCTS: readonly string[] = [
  ...FRAMES.filter((f) => f.id !== FREE_FRAME).map((f) => productOf(f.id)),
  ...WALLS.filter((w) => w.id !== FREE_WALL).map((w) => productOf(w.id)),
  ALL_LOOKS,
];

export const isFree = (id: LookId) => id === FREE_FRAME || id === FREE_WALL;

/** Сохранённое и ответ магазина → купленные товары: только наши, без повторов, в порядке каталога; чужое — пусто. */
export function ownedOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return LOOK_PRODUCTS.filter((id) => raw.includes(id));
}

/**
 * Есть ли у игрока рамка или стена: бесплатная — у всех; `open` — сборка не запирает (0.x для проверки); иначе —
 * купленная отдельно или «Все оформления». `owned` — товары из последнего ответа магазина.
 */
export function lookOwned(id: LookId, owned: readonly string[], open: boolean): boolean {
  return isFree(id) || open || owned.includes(ALL_LOOKS) || owned.includes(productOf(id));
}

/** Канва по id; незнакомая (из будущей версии, испорченная запись) — кремовая. */
export function canvasLook(id: unknown): CanvasLook {
  return CANVASES.find((c) => c.id === id) ?? CANVASES[0];
}

/** Знакомый id канвы — для записи работы и файла переноса. */
export const isCanvasId = (id: unknown): id is CanvasId => CANVASES.some((c) => c.id === id);

/** Рамка по id; незнакомая — бесплатная. */
export function frameLook(id: unknown): FrameLook {
  return FRAMES.find((f) => f.id === id) ?? FRAMES[0];
}

/**
 * Какую рамку показывать: выбранную, если она есть у игрока, иначе бесплатную. Так покупка, которую магазин
 * больше не подтверждает (возврат денег), и выбор, сделанный в сборке для проверки, не остаются.
 */
export function shownFrame(chosen: unknown, owned: readonly string[], open: boolean): FrameLook {
  const f = frameLook(chosen);
  return lookOwned(f.id, owned, open) ? f : frameLook(FREE_FRAME);
}

/** Стена по id; незнакомая — без стены. */
export function wallLook(id: unknown): WallLook {
  return WALLS.find((w) => w.id === id) ?? WALLS[0];
}

/** Какую стену показывать: выбранную, если она есть у игрока, иначе без стены — как рамку. */
export function shownWall(chosen: unknown, owned: readonly string[], open: boolean): WallLook {
  const w = wallLook(chosen);
  return lookOwned(w.id, owned, open) ? w : wallLook(FREE_WALL);
}

/**
 * Нить видна на канве: в OKLab не ближе стольких к её ткани. Кумач, мёд и ель на кремовой — 0,2 и дальше;
 * белая, молочная и бежевая нить на кремовой — ближе 0,1: стежки теряются в ткани.
 */
export const CANVAS_CONTRAST = 0.1;
/**
 * Кремовая остаётся, пока теряется не больше этой доли края фона. Светлая кайма в одну клетку у края цветка
 * старинной схемы — бумага скана, и на кремовой она и должна быть едва видна; а белое кружево орнамента —
 * весь его край: такому узору нужна канва, на которой кружево видно.
 */
export const CANVAS_LOST = 0.2;

/** Ткань канвы — 0xRRGGBB: для превью и для сравнения с нитями. Кремовая — 0xf3f0e6, как превью до 0.20.0. */
export const clothRgb = (c: CanvasLook) => (Math.round(c.cloth[0] * 255) << 16) | (Math.round(c.cloth[1] * 255) << 8) | Math.round(c.cloth[2] * 255);
const clothLab = (c: CanvasLook) => rgbToLab(clothRgb(c));

/**
 * Канва, подходящая узору (владелец 01.11.2026: фон канвы — «реально фон, который не нужно вышивать и
 * зависеть от узора»). Невышитые клетки узора — ткань канвы, и нити по краю фона должны быть на ней видны.
 * Край фона — касания вышиваемых клеток с невышитыми; теряется та его доля, чья нить ближе CANVAS_CONTRAST
 * к ткани. Кремовая — если теряется не больше CANVAS_LOST края; иначе светлая канва, на которой теряется
 * меньше всего, а при равенстве — та, где хуже всех видная нить видна лучше: бежевая лисичка — на белой,
 * белая кошка «Своего узора» с фоном «не вышивать» — на суровом льне. Узор без невышитых клеток — на
 * кремовой, как было: ткань у него видна только до стежков и полем вокруг.
 */
export function suitedCanvas(p: Pattern): CanvasId {
  const touch = new Array<number>(p.threads.length).fill(0);
  let total = 0;
  const add = (i: number) => {
    const t = p.cells[i];
    if (t === CANVAS || t >= touch.length) return;
    touch[t]++;
    total++;
  };
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      if (p.cells[y * p.w + x] !== CANVAS) continue;
      if (x > 0) add(y * p.w + x - 1);
      if (x + 1 < p.w) add(y * p.w + x + 1);
      if (y > 0) add((y - 1) * p.w + x);
      if (y + 1 < p.h) add((y + 1) * p.w + x);
    }
  }
  if (!total) return FREE_CANVAS;
  const edge = p.threads.map((t, i) => ({ lab: rgbToLab(t.rgb), n: touch[i] })).filter((e) => e.n > 0);
  const judge = (c: CanvasLook) => {
    const cl = clothLab(c);
    let lost = 0;
    let worst = Infinity;
    for (const e of edge) {
      const d = deltaOK(e.lab, cl);
      if (d < CANVAS_CONTRAST) lost += e.n;
      worst = Math.min(worst, d);
    }
    return { lost: lost / total, worst };
  };
  if (judge(CANVASES[0]).lost <= CANVAS_LOST) return FREE_CANVAS;
  // только светлые: картинки библиотеки нарисованы на светлой бумаге, и бледные туманы у тюльпанов Зойтера на
  // чёрной стали бы белыми пятнами; чёрную канву игрок выбирает сам
  let best: { id: CanvasId; lost: number; worst: number } | null = null;
  for (const c of CANVASES) {
    if (luminance(c.cloth) < 0.3) continue;
    const j = { id: c.id, ...judge(c) };
    // меньше теряется, а поровну — хуже всех видная нить видна лучше
    if (!best || j.lost < best.lost - 1e-9 || (Math.abs(j.lost - best.lost) <= 1e-9 && j.worst > best.worst)) best = j;
  }
  return best ? best.id : FREE_CANVAS;
}

/** Канва работы: записанная у неё, а нет записи (работа до 0.20.0, незнакомый id) — подходящая узору. */
export const workCanvas = (id: unknown, p: Pattern): CanvasLook => canvasLook(isCanvasId(id) ? id : suitedCanvas(p));

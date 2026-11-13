// «Светлица» (1.1.0, docs/specs/2026-11-svetlitsa.md): готовые работы висят на стенах комнаты, как в музее, — рядами,
// в рамах, с табличкой под каждой. Здесь — раскладка: какие работы на какой стене, где рама, гвоздь и табличка.
// Рисует src/render/gallery.ts, показывает src/screens/SvetlitsaScreen.tsx.
// Чистый TypeScript: без React, платформы, времени и случайности (ADR 0002, 0010).
import { FRAMES, type FrameId, type FrameLook } from './looks';
import type { Rect } from './scene';
import { hash32 } from './seed';

/** Работа, которую вешают: id работы, узор в клетках и рама — пяльцы круглые. */
export interface HangItem {
  id: string;
  w: number;
  h: number;
  hoop: boolean;
  /** большая и огромная картинка — «центр стены»: висит одна в ряду и выше прочих */
  big: boolean;
}

export interface Hung {
  id: string;
  /** рама — внешний край; у пялец — квадрат вокруг обода */
  frame: Rect;
  nail: { x: number; y: number };
  /** табличка с названием под рамой */
  plaque: Rect;
}

export interface WallPlan {
  items: Hung[];
}

/** Размеры комнаты, dp. */
export const ROOM = {
  /** рушник по верху стены */
  band: 30,
  /** пол внизу */
  floor: 46,
  /** поля стены */
  pad: 16,
  /** между рамами в ряду и между рядами */
  gap: 18,
  /** над рамой — гвоздь и бечёвка */
  hang: 20,
  /** под рамой — табличка */
  plaque: 22,
  /** рядов на стене — не больше; на низкой стене (карточка на главной) их меньше */
  rows: 3,
  /** рама обычной работы — не выше, dp */
  frame: 110,
  /** большая картинка — во столько выше обычной */
  big: 1.35,
  /** самая вытянутая работа: шире — висит как такая */
  aspect: 2.4,
} as const;

/** Клеток больше — большая или огромная картинка (docs/08-game-design.md, «Размеры узоров»: средняя — до 4 900). */
export const BIG_CELLS = 4900;

const aspectOf = (it: HangItem) => (it.hoop ? 1 : Math.min(ROOM.aspect, Math.max(1 / ROOM.aspect, it.w / it.h)));

interface Row { items: HangItem[]; h: number; full: number }

/**
 * Раскладка работ по стенам `W` × `H` (dp), в данном порядке: ряды по ширине стены, рамы в ряду одной высоты; ряд
 * собирается, пока рамы помещаются в высоте обычного ряда, иначе становится ниже, чтобы влезть. Большие картинки
 * висят своими рядами, выше обычных. Стена — сколько рядов влезает; блок рядов — посередине стены.
 * Пустой список — ни одной стены.
 */
export function hangWalls(items: readonly HangItem[], W: number, H: number): WallPlan[] {
  const x0 = ROOM.pad;
  const innerW = Math.max(1, W - 2 * ROOM.pad);
  const y0 = ROOM.band + ROOM.pad;
  const innerH = Math.max(1, H - ROOM.band - ROOM.floor - 2 * ROOM.pad);
  const extra = ROOM.hang + ROOM.plaque;
  // высота рамы обычного ряда: ряды с гвоздями, табличками и промежутками — во всю стену, но не выше `frame`: на
  // высокой стене телефона — три ряда по три работы, лишнее место — поровну сверху и снизу
  const rows = Math.max(1, Math.min(ROOM.rows, Math.floor((innerH + ROOM.gap) / (ROOM.frame * 0.75 + extra + ROOM.gap))));
  const th = Math.max(24, Math.min(ROOM.frame, (innerH - rows * extra - (rows - 1) * ROOM.gap) / rows));
  const bigH = rows > 1 ? th * ROOM.big : th;
  const lines: Row[] = [];
  let cur: HangItem[] = [];
  let curBig = false;
  const close = () => {
    if (!cur.length) return;
    const sum = cur.reduce((s, it) => s + aspectOf(it), 0);
    const h = Math.min(curBig ? bigH : th, (innerW - (cur.length - 1) * ROOM.gap) / sum, innerH - extra);
    lines.push({ items: cur, h, full: h + extra });
    cur = [];
  };
  for (const it of items) {
    // большие висят рядами больших, обычные — обычных; ряд другого роста начинается с новой строки
    if (cur.length && it.big !== curBig) close();
    curBig = it.big;
    const sum = cur.reduce((s, x) => s + aspectOf(x), 0) + aspectOf(it);
    if (cur.length && sum * (curBig ? bigH : th) + cur.length * ROOM.gap > innerW) close();
    cur.push(it);
  }
  close();

  const walls: WallPlan[] = [];
  let block: Row[] = [];
  let used = 0;
  const place = () => {
    if (!block.length) return;
    let y = y0 + (innerH - used) / 2;
    const out: Hung[] = [];
    for (const row of block) {
      const widths = row.items.map((it) => row.h * aspectOf(it));
      const rowW = widths.reduce((s, w) => s + w, 0) + (row.items.length - 1) * ROOM.gap;
      let x = x0 + (innerW - rowW) / 2;
      const fy = y + ROOM.hang;
      row.items.forEach((it, i) => {
        const frame = { x: Math.round(x), y: Math.round(fy), w: Math.round(widths[i]), h: Math.round(row.h) };
        // табличка — чуть шире рамы, но не шире её места в ряду: соседние не сходятся
        const pw = Math.min(frame.w + ROOM.gap - 4, innerW);
        out.push({
          id: it.id,
          frame,
          nail: { x: frame.x + frame.w / 2, y: frame.y - ROOM.hang * 0.75 },
          plaque: { x: Math.round(Math.max(x0, Math.min(x0 + innerW - pw, frame.x + frame.w / 2 - pw / 2))), y: frame.y + frame.h + 5, w: Math.round(pw), h: ROOM.plaque - 7 },
        });
        x += widths[i] + ROOM.gap;
      });
      y += row.full + ROOM.gap;
    }
    walls.push({ items: out });
    block = [];
    used = 0;
  };
  for (const row of lines) {
    const add = (block.length ? ROOM.gap : 0) + row.full;
    if (block.length && used + add > innerH) place();
    used += (block.length ? ROOM.gap : 0) + row.full;
    block.push(row);
  }
  place();
  return walls;
}

/** Номер стены, где висит работа; нет такой — −1. */
export function wallOf(walls: readonly WallPlan[], id: string): number {
  return walls.findIndex((w) => w.items.some((h) => h.id === id));
}

/**
 * Рама работы на стене: свои рамы игрока вперемешку — у каждой работы всегда одна и та же (по id работы), бесплатная
 * тёмная — у всех. `frames` — рамы, которые у игрока есть; пусто — бесплатная.
 */
export function frameFor(id: string, frames: readonly FrameId[]): FrameLook {
  if (!frames.length) return FRAMES[0];
  const want = frames[hash32(id) % frames.length];
  return FRAMES.find((f) => f.id === want) ?? FRAMES[0];
}

/**
 * Окно рамы — где ткань с работой: у рамы — внутри толщины рамы и паспарту, у пялец — круг внутри обода (квадрат
 * вокруг него). Толщины — в долю меньшей стороны рамы, чтобы маленькие рамы не были одной рамой.
 */
export function openingOf(frame: Rect, look: FrameLook, mat: boolean): { mat: Rect; cloth: Rect } {
  const side = Math.min(frame.w, frame.h);
  const t = look.kind === 'hoop' ? Math.max(4, side * 0.07) : Math.max(4, Math.min(look.carved ? 14 : 8, side * (look.carved ? 0.12 : 0.07)));
  const inner = { x: frame.x + t, y: frame.y + t, w: frame.w - 2 * t, h: frame.h - 2 * t };
  if (look.kind === 'hoop' || !mat) return { mat: inner, cloth: inner };
  const m = Math.max(3, Math.min(14, side * 0.09));
  return { mat: inner, cloth: { x: inner.x + m, y: inner.y + m, w: inner.w - 2 * m, h: inner.h - 2 * m } };
}

/** Узор `w` × `h` клеток в ткани `cloth` с полем: у пялец — диагональ поперёк круга, как на «Готово». */
export function pictureIn(cloth: Rect, w: number, h: number, hoop: boolean): Rect {
  const margin = Math.max(2, Math.min(cloth.w, cloth.h) * 0.05);
  const s = hoop ? (cloth.w - 2 * margin) / Math.hypot(w, h) : Math.min((cloth.w - 2 * margin) / w, (cloth.h - 2 * margin) / h);
  const pw = w * s;
  const ph = h * s;
  return { x: cloth.x + (cloth.w - pw) / 2, y: cloth.y + (cloth.h - ph) / 2, w: pw, h: ph };
}

// Нарисованные узоры (docs/specs/2026-09-content-pipeline.md, «Орнаменты и „Детям“»):
// текстовая сетка из карточки или генератор по мотивам народной вышивки — ромбы по
// «манхэттенскому» расстоянию, восьмиконечная звезда, древо, кайма рушника. Всё — своя
// работа студии; генераторы детерминированы.
import { CANVAS } from '../../src/engine/pattern';

export interface Drawn {
  w: number;
  h: number;
  /** индекс нити легенды или CANVAS */
  cells: Uint8Array;
}

/** Текстовая сетка: строки одной длины, символ — нить из легенды, точка — канва. */
export function fromGrid(grid: string, keys: string[]): Drawn {
  const rows = grid.split('\n').map((r) => r.trimEnd()).filter((r) => r.length);
  const w = rows[0]?.length ?? 0;
  if (!w || rows.some((r) => r.length !== w)) throw new Error('строки сетки разной длины');
  const cells = new Uint8Array(w * rows.length);
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') cells[y * w + x] = CANVAS;
    else {
      const k = keys.indexOf(ch);
      if (k < 0) throw new Error(`символа «${ch}» нет в легенде (строка ${y + 1})`);
      cells[y * w + x] = k;
    }
  }));
  return { w, h: rows.length, cells };
}

type Gen = (p: Record<string, number | number[]>) => Drawn;

function make(w: number, h: number, f: (x: number, y: number) => number): Drawn {
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells[y * w + x] = f(x, y);
  return { w, h, cells };
}

const num = (v: number | number[] | undefined, d: number) => (typeof v === 'number' ? v : d);
const list = (v: number | number[] | undefined, d: number[]) => (Array.isArray(v) ? v : d);

export const GENERATORS: Record<string, Gen> = {
  /**
   * Узор-пример с сайта студии (site/assets/site.js, «пяльцы»): ромбы вокруг центра,
   * малые ромбы в углах. Нити: 0 — кумачовая, 1 — еловая, 2 — льняная.
   */
  hoop: (p) => {
    const n = num(p.size, 17);
    const c = (n - 1) / 2;
    return make(n, n, (x, y) => {
      const dr = Math.abs(y - c);
      const dc = Math.abs(x - c);
      const d = dr + dc;
      const axis = dr === 0 || dc === 0;
      const diag = dr === dc;
      if (d <= 1) return 0;
      if (d === 2) return axis ? 0 : 2;
      if (d === 4) return 1;
      if (d === 6) return 0;
      if (d === 7) return axis ? 2 : CANVAS;
      if (d === 8) return axis ? 0 : diag ? 2 : CANVAS;
      if (diag && d === 10) return 2;
      if (dr === 6 && dc === 6) return 0;
      if ((dr === 6 && Math.abs(dc - 6) === 1) || (dc === 6 && Math.abs(dr - 6) === 1)) return 1;
      if (dr === 8 && dc === 8) return 2;
      return CANVAS;
    });
  },

  /**
   * Ромб кольцами: `rings[d]` — нить кольца на расстоянии d от центра (−1 — канва),
   * по кругу до `radius`; дальше — канва. Кольца в две клетки шириной связаны по сторонам.
   */
  'rhombus-rings': (p) => {
    const n = num(p.size, 21);
    const rings = list(p.rings, [0, 0, 1, 1, -1, 2, 2, -1]);
    const c = (n - 1) / 2;
    const radius = num(p.radius, c);
    return make(n, n, (x, y) => {
      const d = Math.abs(x - c) + Math.abs(y - c);
      if (d > radius) return CANVAS;
      const t = rings[d % rings.length];
      return t < 0 ? CANVAS : t;
    });
  },

  /**
   * Первая картинка: ромб кольцами в две клетки и малые ромбы по углам — три нити,
   * ни одной одиночной клетки: вся картинка проходится кистью.
   */
  first: (p) => {
    const n = num(p.size, 19);
    const c = (n - 1) / 2;
    const rings = [0, 0, 2, 2, -1, 1, 1, -1, 0, 0];
    const corners = [[2, 2], [n - 3, 2], [2, n - 3], [n - 3, n - 3]];
    return make(n, n, (x, y) => {
      const d = Math.abs(x - c) + Math.abs(y - c);
      if (d < rings.length) return rings[d] < 0 ? CANVAS : rings[d];
      for (const [cx, cy] of corners) if (Math.abs(x - cx) + Math.abs(y - cy) <= 1) return 1;
      return CANVAS;
    });
  },

  /** Розетка: восемь ромбов-лепестков вокруг ромба-сердцевины. */
  rosette: (p) => {
    const n = num(p.size, 27);
    const c = (n - 1) / 2;
    const r = num(p.petal, 3);
    const dist = num(p.dist, 8);
    const k = Math.round(dist / Math.SQRT2);
    const petals: [number, number, number][] = [
      [c, c - dist, 0], [c, c + dist, 0], [c - dist, c, 0], [c + dist, c, 0],
      [c - k, c - k, 1], [c + k, c - k, 1], [c - k, c + k, 1], [c + k, c + k, 1],
    ];
    return make(n, n, (x, y) => {
      if (Math.abs(x - c) + Math.abs(y - c) <= 2) return 2;
      for (const [px, py, t] of petals) if (Math.abs(x - px) + Math.abs(y - py) <= r) return t;
      return CANVAS;
    });
  },

  /** Восьмиконечная звезда: квадрат и ромб одного центра; контур, заливка, сердцевина. */
  star8: (p) => {
    const n = num(p.size, 25);
    const c = (n - 1) / 2;
    const r = c - 1;
    const sq = Math.round(r * 0.62);
    const inside = (x: number, y: number) => Math.abs(x - c) + Math.abs(y - c) <= r || Math.max(Math.abs(x - c), Math.abs(y - c)) <= sq;
    return make(n, n, (x, y) => {
      if (!inside(x, y)) return CANVAS;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      if (edge) return 0;
      const d = Math.abs(x - c) + Math.abs(y - c);
      if (d <= 2) return 2;
      if (d === 4 || (Math.abs(x - c) === Math.abs(y - c) && d <= 8)) return 0;
      return 1;
    });
  },

  /** Кайма рушника: ромбы в две клетки с раппортом `step` между двумя сплошными полосами. */
  border: (p) => {
    const w = num(p.width, 45);
    const h = num(p.height, 13);
    const step = num(p.step, 11);
    const c = (h - 1) / 2;
    return make(w, h, (x, y) => {
      if (y <= 1 || y >= h - 2) return 1;
      const px = x % step;
      const d = Math.abs(px - (step - 1) / 2) + Math.abs(y - c);
      if (d <= 1) return 2;
      if (d >= 3 && d <= 4) return 0;
      return CANVAS;
    });
  },
};

export function generate(name: string, params: Record<string, number | number[]> = {}): Drawn {
  const g = GENERATORS[name];
  if (!g) throw new Error(`генератора «${name}» нет: ${Object.keys(GENERATORS).join(', ')}`);
  return g(params);
}

// Подпись мастерицы (0.21.0; владелец 01.11.2026: «делай … Д» — инициалы и год крестиком под работой, как
// на старинных образцах). Игрок вводит инициалы на «Готово» и сам вышивает подпись на маленькой канве
// (src/screens/SignScreen.tsx); вышитая подпись встаёт под работой на «Готово» и «Поделиться» — строками
// клеток под узором, той же нитью узора. Шрифт — пять клеток в высоту, как у вышитых азбук.
// Чистый TypeScript: без React, платформы, времени и случайности (ADR 0002, 0010).
import { deltaOK, rgbToLab } from './color';
import { CANVAS, type Pattern } from './pattern';

/** Буквы и цифры крестиком, пять строк: X — стежок. Ё — как Е, Й — как И: над ними нет места. */
const GLYPHS: Record<string, readonly string[]> = {
  А: ['.X.', 'X.X', 'XXX', 'X.X', 'X.X'],
  Б: ['XXX', 'X..', 'XXX', 'X.X', 'XXX'],
  В: ['XX.', 'X.X', 'XX.', 'X.X', 'XX.'],
  Г: ['XXX', 'X..', 'X..', 'X..', 'X..'],
  Д: ['.XXX.', '.X.X.', '.X.X.', 'XXXXX', 'X...X'],
  Е: ['XXX', 'X..', 'XX.', 'X..', 'XXX'],
  Ж: ['X.X.X', 'X.X.X', '.XXX.', 'X.X.X', 'X.X.X'],
  З: ['XX.', '..X', '.X.', '..X', 'XX.'],
  И: ['X..X', 'X..X', 'X.XX', 'XX.X', 'X..X'],
  К: ['X..X', 'X.X.', 'XX..', 'X.X.', 'X..X'],
  Л: ['.XXX', '.X.X', '.X.X', '.X.X', 'X..X'],
  М: ['X...X', 'XX.XX', 'X.X.X', 'X...X', 'X...X'],
  Н: ['X.X', 'X.X', 'XXX', 'X.X', 'X.X'],
  О: ['XXX', 'X.X', 'X.X', 'X.X', 'XXX'],
  П: ['XXX', 'X.X', 'X.X', 'X.X', 'X.X'],
  Р: ['XX.', 'X.X', 'XX.', 'X..', 'X..'],
  С: ['XXX', 'X..', 'X..', 'X..', 'XXX'],
  Т: ['XXX', '.X.', '.X.', '.X.', '.X.'],
  У: ['X.X', 'X.X', '.XX', '..X', 'XX.'],
  Ф: ['.XXX.', 'X.X.X', 'X.X.X', '.XXX.', '..X..'],
  Х: ['X.X', 'X.X', '.X.', 'X.X', 'X.X'],
  Ц: ['X.X.', 'X.X.', 'X.X.', 'XXXX', '...X'],
  Ч: ['X.X', 'X.X', 'XXX', '..X', '..X'],
  Ш: ['X.X.X', 'X.X.X', 'X.X.X', 'X.X.X', 'XXXXX'],
  Щ: ['X.X.X', 'X.X.X', 'X.X.X', 'XXXXX', '....X'],
  Ъ: ['XX..', '.X..', '.XX.', '.X.X', '.XX.'],
  Ы: ['X...X', 'X...X', 'XX..X', 'X.X.X', 'XX..X'],
  Ь: ['X..', 'X..', 'XX.', 'X.X', 'XX.'],
  Э: ['XX.', '..X', '.XX', '..X', 'XX.'],
  Ю: ['X..X.', 'X.X.X', 'XXX.X', 'X.X.X', 'X..X.'],
  Я: ['.XX', 'X.X', '.XX', 'X.X', 'X.X'],
  '0': ['XXX', 'X.X', 'X.X', 'X.X', 'XXX'],
  '1': ['.X.', 'XX.', '.X.', '.X.', 'XXX'],
  '2': ['XXX', '..X', 'XXX', 'X..', 'XXX'],
  '3': ['XXX', '..X', '.XX', '..X', 'XXX'],
  '4': ['X.X', 'X.X', 'XXX', '..X', '..X'],
  '5': ['XXX', 'X..', 'XXX', '..X', 'XXX'],
  '6': ['.XX', 'X..', 'XXX', 'X.X', 'XXX'],
  '7': ['XXX', '..X', '.X.', '.X.', '.X.'],
  '8': ['XXX', 'X.X', 'XXX', 'X.X', 'XXX'],
  '9': ['XXX', 'X.X', 'XXX', '..X', 'XX.'],
  '.': ['.', '.', '.', '.', 'X'],
  ' ': ['..', '..', '..', '..', '..'],
};

/** Строк в букве; между строками подписи — одна пустая, между узором и подписью — две. */
export const SIGN_ROWS = 5;
export const SIGN_GAP = 2;
/** Инициалов — не больше стольких букв. */
export const SIGN_LETTERS = 3;

/** Буквы, которые игра умеет вышить: русские заглавные (Ё и Й — как Е и И). */
export const SIGN_ALPHABET = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';

/** Инициалы из того, что ввёл игрок: только русские буквы, заглавными, не больше трёх; Ё → Е, Й → И. */
export function cleanInitials(input: string): string {
  return [...input.toUpperCase()]
    .map((ch) => (ch === 'Ё' ? 'Е' : ch === 'Й' ? 'И' : ch))
    .filter((ch) => GLYPHS[ch] !== undefined && /[А-Я]/.test(ch))
    .slice(0, SIGN_LETTERS)
    .join('');
}

/** Ширина строки в клетках: буквы через пустой столбец. */
export function lineWidth(line: string): number {
  return [...line].reduce((w, ch, i) => w + (GLYPHS[ch]?.[0].length ?? 0) + (i ? 1 : 0), 0);
}

/**
 * Строки подписи для узора шириной `w`: «Е.К. 2026» одной строкой, если влезает; иначе инициалы и год
 * двумя строками; иначе только инициалы; не влезают и они — подписи нет.
 */
export function signLines(initials: string, year: number, w: number): string[] | null {
  const letters = cleanInitials(initials);
  if (!letters) return null;
  const name = [...letters].map((ch) => `${ch}.`).join('');
  const y = String(Math.max(0, Math.min(9999, Math.trunc(year))));
  for (const lines of [[`${name} ${y}`], [name, y], [name]]) if (lines.every((l) => lineWidth(l) <= w)) return lines;
  return null;
}

export interface SignGrid {
  w: number;
  h: number;
  /** 1 — стежок подписи */
  cells: Uint8Array;
}

/** Клетки подписи: строки друг под другом через пустую строку, по правому краю. */
export function signGrid(lines: readonly string[]): SignGrid {
  const w = Math.max(...lines.map(lineWidth));
  const h = lines.length * SIGN_ROWS + (lines.length - 1);
  const cells = new Uint8Array(w * h);
  lines.forEach((line, li) => {
    let x = w - lineWidth(line);
    const y0 = li * (SIGN_ROWS + 1);
    for (const ch of line) {
      const g = GLYPHS[ch];
      for (let r = 0; r < SIGN_ROWS; r++) for (let c = 0; c < g[r].length; c++) if (g[r][c] === 'X') cells[(y0 + r) * w + x + c] = 1;
      x += g[0].length + 1;
    }
  });
  return { w, h, cells };
}

/**
 * Нить подписи — нить узора, лучше всех видная на ткани канвы (`cloth` — 0xRRGGBB): тёмная на светлой
 * канве, светлая на чёрной.
 */
export function signThread(p: Pattern, cloth: number): number {
  const c = rgbToLab(cloth);
  let best = 0;
  let far = -1;
  p.threads.forEach((t, i) => {
    const d = deltaOK(rgbToLab(t.rgb), c);
    if (d > far) {
      far = d;
      best = i;
    }
  });
  return best;
}

/** Подпись работы — запись в указателе работ (src/state/works.ts). */
export interface Sign {
  /** инициалы, русские заглавные */
  initials: string;
  year: number;
  /** номер нити узора */
  thread: number;
  /** вышитые клетки подписи — номера в её сетке (`signGrid`) */
  done: number[];
}

/** Клеток в сетке подписи не бывает больше: две строки по пять, не шире предельного узора. */
const SIGN_CELLS_MAX = 11 * 1024;

/**
 * Подпись из записи работы или файла переноса — только знакомые поля и разумные значения, иначе нет:
 * чужая или испорченная запись не ломает «Готово».
 */
export function signOf(raw: unknown): Sign | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const { initials, year, thread, done } = r;
  if (typeof initials !== 'string' || !initials || cleanInitials(initials) !== initials) return undefined;
  if (!Number.isInteger(year) || (year as number) < 0 || (year as number) > 9999) return undefined;
  if (!Number.isInteger(thread) || (thread as number) < 0 || (thread as number) >= 64) return undefined;
  if (!Array.isArray(done) || done.length > SIGN_CELLS_MAX) return undefined;
  const cells = [...new Set(done.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < SIGN_CELLS_MAX))];
  return { initials, year: year as number, thread: thread as number, done: cells };
}

/** Маленький узор подписи — для канвы, на которой её вышивают: одна нить, клетки букв. */
export function signPattern(p: Pattern, sign: Pick<Sign, 'initials' | 'year' | 'thread'>): Pattern | null {
  const lines = signLines(sign.initials, sign.year, p.w);
  const thread = p.threads[sign.thread];
  if (!lines || !thread) return null;
  const g = signGrid(lines);
  return { key: `${p.key}#sign`, w: g.w, h: g.h, threads: [thread], cells: Uint8Array.from(g.cells, (v) => (v ? 0 : CANVAS)) };
}

/** Подпись вышита вся: каждая её клетка — в `done`. */
export function signDone(p: Pattern, sign: Sign): boolean {
  const lines = signLines(sign.initials, sign.year, p.w);
  if (!lines) return false;
  const g = signGrid(lines);
  const done = new Set(sign.done);
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i] && !done.has(i)) return false;
  return true;
}

/**
 * Узор с подписью под ним — для «Готово» и «Поделиться»: те же нити, ниже узора — две пустые строки и
 * строки подписи по правому краю; вышитые клетки подписи — нитью подписи, остальные — канва. Номера клеток
 * узора не меняются: строки добавляются снизу. Подписи нет или она не влезает — узор как есть.
 */
export function withSign(p: Pattern, sign: Sign | undefined): Pattern {
  if (!sign || !p.threads[sign.thread]) return p;
  const lines = signLines(sign.initials, sign.year, p.w);
  if (!lines) return p;
  const g = signGrid(lines);
  const done = new Set(sign.done);
  const h = p.h + SIGN_GAP + g.h;
  const cells = new Uint8Array(p.w * h).fill(CANVAS);
  cells.set(p.cells);
  const x0 = p.w - g.w;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = y * g.w + x;
      if (g.cells[i] && done.has(i)) cells[(p.h + SIGN_GAP + y) * p.w + x0 + x] = sign.thread;
    }
  }
  return { ...p, h, cells };
}

/** Клетки подписи в узоре `withSign` — по порядку вышивания: «Как вышивалось» кладёт их последними. */
export function signCells(p: Pattern, sign: Sign | undefined): number[] {
  if (!sign) return [];
  const lines = signLines(sign.initials, sign.year, p.w);
  if (!lines) return [];
  const g = signGrid(lines);
  const x0 = p.w - g.w;
  return sign.done.filter((i) => i >= 0 && i < g.cells.length && g.cells[i]).map((i) => (p.h + SIGN_GAP + Math.floor(i / g.w)) * p.w + x0 + (i % g.w));
}

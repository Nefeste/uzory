// Работа — список стежков (ADR 0005). Состояние (какие клетки вышиты, сколько осталось)
// не хранится, а выводится: движок принимает стежок, только если клетка этой нити
// и ещё не вышита, — поэтому испорченный файл или ошибка канвы не дают «лишней» клетки.
import { CANVAS, type Pattern } from './pattern';

export interface Stroke {
  /** индекс нити */
  thread: number;
  /** клетки в порядке, в каком легли стежки */
  cells: number[];
}

export interface Work {
  /** «w-<время начала в base36>-<4 знака>» — задаёт src/state, движку всё равно */
  id: string;
  /** ключ узора с версией: работа всегда на своей версии (ADR 0010) */
  pattern: string;
  /** мс, когда начали; движок время не читает — его передают */
  started: number;
  /** мс, когда лёг последний стежок */
  finished?: number;
  strokes: Stroke[];
}

/** Живое состояние вышивания: выводится из штрихов, меняется только через `apply`. */
export class Stitching {
  readonly pattern: Pattern;
  /** 1 — клетка вышита */
  readonly stitched: Uint8Array;
  /** сколько клеток осталось у каждой нити */
  readonly left: Uint32Array;
  /** всего вышиваемых клеток и сколько вышито */
  readonly total: number;
  private doneCount = 0;

  constructor(pattern: Pattern) {
    this.pattern = pattern;
    this.stitched = new Uint8Array(pattern.cells.length);
    this.left = new Uint32Array(pattern.threads.length);
    let total = 0;
    for (let i = 0; i < pattern.cells.length; i++) {
      const t = pattern.cells[i];
      if (t !== CANVAS) { this.left[t]++; total++; }
    }
    this.total = total;
  }

  get done(): number { return this.doneCount; }
  get finished(): boolean { return this.doneCount === this.total; }
  /** 0…100, целое вниз: 100 — только когда вышито всё */
  get percent(): number { return this.total ? Math.floor((this.doneCount * 100) / this.total) : 100; }

  /** Можно ли положить стежок нити `thread` в клетку `cell`. */
  fits(thread: number, cell: number): boolean {
    return cell >= 0 && cell < this.pattern.cells.length && this.pattern.cells[cell] === thread && !this.stitched[cell];
  }

  /**
   * Применяет штрих: принимает только подходящие клетки, в порядке штриха, повторы внутри
   * штриха отбрасывает. Возвращает принятые клетки — их и надо записать в работу.
   */
  apply(stroke: Stroke): number[] {
    const out: number[] = [];
    const t = stroke.thread;
    if (!Number.isInteger(t) || t < 0 || t >= this.pattern.threads.length) return out;
    for (const cell of stroke.cells) {
      if (!this.fits(t, cell)) continue;
      this.stitched[cell] = 1;
      this.left[t]--;
      this.doneCount++;
      out.push(cell);
    }
    return out;
  }
}

/** Переигрывает работу: то же состояние, что было, и только принятые штрихи. */
export function replay(pattern: Pattern, strokes: readonly Stroke[]): { state: Stitching; strokes: Stroke[] } {
  const state = new Stitching(pattern);
  const kept: Stroke[] = [];
  for (const s of strokes) {
    const cells = state.apply(s);
    if (cells.length) kept.push({ thread: s.thread, cells });
  }
  return { state, strokes: kept };
}

/** Все стежки по порядку одной лентой — для «Как вышивалось». */
export function stitchOrder(strokes: readonly Stroke[]): { thread: number; cell: number }[] {
  const out: { thread: number; cell: number }[] = [];
  for (const s of strokes) for (const cell of s.cells) out.push({ thread: s.thread, cell });
  return out;
}

/**
 * Длительность «Как вышивалось», мс: по миллисекунде на стежок, но не меньше 8 и не
 * больше 12 секунд (docs/08-game-design.md, «Готово»).
 */
export const replayMs = (stitches: number) => Math.min(12000, Math.max(8000, stitches));

// Стежки, заливка, «Где ещё?» (docs/06-testing.md, «Движок»).
import { describe, expect, test } from 'bun:test';
import { CANVAS, estimateMinutes, type Pattern, patternError, sizeClass, stitchable, threadCounts } from '../../src/engine/pattern';
import { fillRegion, nearestGroup, nextThread } from '../../src/engine/regions';
import { replay, replayMs, Stitching, stitchOrder } from '../../src/engine/work';
import { randomPattern, randomStrokes } from './helpers';

const grid = (rows: string[], key = 'grid@1'): Pattern => {
  const w = rows[0].length;
  const cells = new Uint8Array(w * rows.length);
  rows.join('').split('').forEach((ch, i) => (cells[i] = ch === '.' ? CANVAS : Number(ch)));
  const n = Math.max(...[...cells].filter((c) => c !== CANVAS)) + 1;
  return { key, w, h: rows.length, threads: Array.from({ length: n }, (_, t) => ({ rgb: t * 0x111111, name: `н${t}` })), cells };
};

describe('узор', () => {
  test('цельный узор проходит проверку, испорченный — нет', () => {
    const p = grid(['001', '1.2']);
    expect(patternError(p)).toBeNull();
    expect(patternError({ ...p, key: 'Без версии' })).toContain('ключ');
    expect(patternError({ ...p, cells: p.cells.slice(1) })).toContain('клеток');
    expect(patternError({ ...p, threads: [...p.threads, { rgb: 1, name: 'лишняя' }] })).toContain('не встречается');
    expect(patternError({ ...p, threads: p.threads.map((t) => ({ ...t, name: 'одна' })) })).toContain('повторяется');
    const bad = p.cells.slice();
    bad[0] = 7;
    expect(patternError({ ...p, cells: bad })).toContain('нить 7');
  });

  test('счёт клеток, размер и оценка времени', () => {
    const p = grid(['001', '1.2']);
    expect([...threadCounts(p)]).toEqual([2, 2, 1]);
    expect(stitchable(p)).toBe(5);
    expect(sizeClass(p)).toBe('S');
    expect(sizeClass(randomPattern(1, 70, 70, 20))).toBe('M');
    expect(sizeClass(randomPattern(1, 120, 120, 32))).toBe('L');
    expect(sizeClass(randomPattern(1, 121, 120, 32))).toBe('XL');
    expect(sizeClass(randomPattern(1, 200, 200, 45))).toBe('XL');
    // 14 400 клеток ÷ 4 + 32 × 15 с = 4080 с ≈ 70 мин (08-game-design: «25–70 мин»)
    expect(estimateMinutes(randomPattern(1, 120, 120, 32))).toBe(70);
    // 40 000 ÷ 4 + 45 × 15 = 10 675 с ≈ 3 ч («Огромная»: до 3 ч)
    expect(estimateMinutes(randomPattern(1, 200, 200, 45))).toBe(180);
    expect(estimateMinutes(p)).toBe(5);
  });
});

describe('стежки', () => {
  const p = grid(['001', '1.2']);

  test('чужая нить, канва, вне узора и повтор отбрасываются', () => {
    const s = new Stitching(p);
    expect(s.apply({ thread: 0, cells: [0, 2, 4, -1, 6, 0, 1, 1] })).toEqual([0, 1]);
    expect(s.done).toBe(2);
    expect(s.left[0]).toBe(0);
    expect(s.apply({ thread: 5, cells: [2] })).toEqual([]);
    expect(s.apply({ thread: 1.5, cells: [2] })).toEqual([]);
    expect(s.percent).toBe(40);
    expect(s.finished).toBe(false);
    s.apply({ thread: 1, cells: [2, 3] });
    s.apply({ thread: 2, cells: [5] });
    expect(s.finished).toBe(true);
    expect(s.percent).toBe(100);
  });

  test('прогресс — число уникальных принятых клеток, порядок штрихов сохраняется', () => {
    const q = randomPattern(7, 60, 40, 12, 0.1);
    const strokes = randomStrokes(8, q, 3000);
    const { state, strokes: kept } = replay(q, strokes);
    const seen = new Set<number>();
    for (const s of strokes) for (const c of s.cells) if (q.cells[c] === s.thread) seen.add(c);
    expect(state.done).toBe(seen.size);
    // принятые штрихи — подпоследовательность исходных, и переигрываются в то же состояние
    const again = replay(q, kept);
    expect([...again.state.stitched]).toEqual([...state.stitched]);
    expect(again.strokes).toEqual(kept);
    const order = stitchOrder(kept);
    expect(order.length).toBe(state.done);
    expect(new Set(order.map((o) => o.cell)).size).toBe(order.length);
  });

  test('«Как вышивалось» — от 8 до 12 секунд', () => {
    expect(replayMs(120)).toBe(8000);
    expect(replayMs(10000)).toBe(10000);
    expect(replayMs(14400)).toBe(12000);
  });
});

describe('заливка', () => {
  test('заливает связную область по сторонам, диагональ и канва — граница', () => {
    const p = grid([
      '0010',
      '0.10',
      '1001',
      '0000',
    ]);
    const st = new Uint8Array(p.cells.length);
    expect(fillRegion(p, st, 0).sort((a, b) => a - b)).toEqual([0, 1, 4]);
    // 3 и 7 — отдельная область (4 соседей нет по диагонали к 1)
    expect(fillRegion(p, st, 3).sort((a, b) => a - b)).toEqual([3, 7]);
    // нижняя область: 9, 10 и вся нижняя строка
    expect(fillRegion(p, st, 9).sort((a, b) => a - b)).toEqual([9, 10, 12, 13, 14, 15]);
    expect(fillRegion(p, st, 5)).toEqual([]); // канва
    st[13] = 1;
    // вышитая 13 область не разрывает: 12 заливается через неё
    expect(fillRegion(p, st, 9).sort((a, b) => a - b)).toEqual([9, 10, 12, 14, 15]);
  });

  test('двойное касание по только что вышитой клетке заливает остальное', () => {
    const p = grid([
      '0010',
      '0.10',
      '1001',
      '0000',
    ]);
    const st = new Uint8Array(p.cells.length);
    st[13] = 1; // первое касание
    expect(fillRegion(p, st, 13)).toEqual([12, 14, 9, 15, 10]);
    for (const c of [9, 10, 12, 14, 15]) st[c] = 1;
    expect(fillRegion(p, st, 13)).toEqual([]); // вся область вышита
  });

  test('обход в ширину: первой идёт начальная клетка, дальше — кругами', () => {
    const p = grid(['00000']);
    expect(fillRegion(p, new Uint8Array(5), 2)).toEqual([2, 1, 3, 0, 4]);
  });
});

describe('«Где ещё?»', () => {
  test('всегда указывает на невышитые клетки выбранной нити; законченная — null', () => {
    const p = randomPattern(3, 50, 50, 8);
    const s = new Stitching(p);
    for (let t = 0; t < 8; t++) {
      let guard = 0;
      while (s.left[t] > 0) {
        const g = nearestGroup(p, s.stitched, t, 25, 25);
        expect(g).not.toBeNull();
        for (const c of g!.cells) {
          expect(p.cells[c]).toBe(t);
          expect(s.stitched[c]).toBe(0);
        }
        s.apply({ thread: t, cells: g!.cells });
        if (++guard > 5000) throw new Error('не сходится');
      }
      expect(nearestGroup(p, s.stitched, t, 25, 25)).toBeNull();
    }
    expect(s.finished).toBe(true);
  });

  test('ближайшая группа — по расстоянию до её центра', () => {
    const p = grid([
      '0111111110',
      '1111111111',
    ]);
    const st = new Uint8Array(p.cells.length);
    expect(nearestGroup(p, st, 0, 1, 1)!.cells).toEqual([0]);
    expect(nearestGroup(p, st, 0, 9, 1)!.cells).toEqual([9]);
  });

  test('следующая нить — по кругу, с оставшимися клетками', () => {
    expect(nextThread([0, 3, 0, 1], 1)).toBe(3);
    expect(nextThread([0, 3, 0, 1], 3)).toBe(1);
    expect(nextThread([0, 0, 0, 0], 1)).toBe(-1);
  });
});

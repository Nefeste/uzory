// Файл стежков и набор (docs/06-testing.md, «Переигрывание», «Файлы»).
import { describe, expect, test } from 'bun:test';
import { base64Decode, base64Encode } from '../../src/engine/base64';
import type { Picture } from '../../src/engine/library';
import { openPack, packError, packPattern, writePack } from '../../src/engine/pack';
import { samplePattern } from '../../src/engine/sample';
import { rng } from '../../src/engine/seed';
import { utf8Decode, utf8Encode } from '../../src/engine/utf8';
import { Reader, Writer } from '../../src/engine/varint';
import { replay } from '../../src/engine/work';
import { decodeWork, encodeWork, WorkFileError, workFileFits } from '../../src/engine/workfile';
import { brushAll, randomPattern, randomStrokes } from './helpers';

describe('varint, UTF-8, base64', () => {
  test('числа до 2^53 и со знаком читаются как записаны', () => {
    const r = rng(1);
    const nums = [0, 1, 127, 128, 16383, 16384, 2 ** 31, 2 ** 32 + 5, 1790000000000, Number.MAX_SAFE_INTEGER];
    for (let i = 0; i < 500; i++) nums.push(Math.floor(r() * 2 ** (1 + (i % 52))));
    const w = new Writer(4);
    const half = (n: number) => Math.floor(n / 2); // со знаком — до 2^52
    for (const n of nums) { w.uint(n); w.int(0 - half(n) || 0); w.int(half(n)); }
    const rd = new Reader(w.finish());
    for (const n of nums) {
      expect(rd.uint()).toBe(n);
      expect(rd.int()).toBe(0 - half(n) || 0);
      expect(rd.int()).toBe(half(n));
    }
    expect(rd.done).toBe(true);
  });

  test('UTF-8 в обе стороны и строго', () => {
    for (const s of ['', 'abc', 'кумачовая', 'ёлка — «Узоры» 🧵', 'x'.repeat(10000)]) {
      const b = utf8Encode(s);
      expect(b).toEqual(new Uint8Array(Buffer.from(s, 'utf8')));
      expect(utf8Decode(b)).toBe(s);
    }
    expect(() => utf8Decode(Uint8Array.from([0xd0]))).toThrow();
    expect(() => utf8Decode(Uint8Array.from([0xc0, 0x80]))).toThrow();
    expect(() => utf8Decode(Uint8Array.from([0xff]))).toThrow();
  });

  test('base64 как у Buffer', () => {
    const r = rng(2);
    for (let n = 0; n < 40; n++) {
      const b = Uint8Array.from({ length: n * 7 + (n % 3) }, () => Math.floor(r() * 256));
      const s = base64Encode(b);
      expect(s).toBe(Buffer.from(b).toString('base64'));
      expect(base64Decode(s)).toEqual(b);
    }
    expect(() => base64Decode('ab$d')).toThrow();
  });
});

describe('файл стежков', () => {
  test('случайные работы: запись → разбор → те же клетки и тот же порядок', () => {
    for (const [seed, w, h] of [[1, 20, 20], [2, 70, 70], [3, 120, 120], [4, 150, 200]]) {
      const p = randomPattern(seed, w, h, 24, 0.05);
      const { strokes } = replay(p, randomStrokes(seed + 100, p, 10000));
      const bytes = encodeWork(p.key, 1790000000000 + seed, strokes);
      const f = decodeWork(bytes);
      expect(f.pattern).toBe(p.key);
      expect(f.started).toBe(1790000000000 + seed);
      expect(f.truncated).toBe(false);
      expect(f.strokes).toEqual(strokes);
      expect(workFileFits(p, f)).toBe(true);
    }
  });

  test('законченная работа 120 × 120 кистью — не больше 40 КБ (П4)', () => {
    const p = randomPattern(5, 120, 120, 32);
    const { state, strokes } = replay(p, brushAll(p));
    expect(state.finished).toBe(true);
    const bytes = encodeWork(p.key, 1790000000000, strokes);
    expect(bytes.length).toBeLessThanOrEqual(40 * 1024);
  });

  test('обрыв посреди штриха теряет только этот штрих', () => {
    const p = randomPattern(6, 40, 40, 10);
    const { strokes } = replay(p, randomStrokes(6, p, 300));
    const bytes = encodeWork(p.key, 1, strokes);
    const whole = encodeWork(p.key, 1, strokes.slice(0, -1)).length;
    for (let cut = whole + 1; cut < bytes.length; cut++) {
      const f = decodeWork(bytes.subarray(0, cut));
      expect(f.truncated).toBe(true);
      expect(f.strokes).toEqual(strokes.slice(0, -1));
    }
  });

  test('чужой файл, битый заголовок, клетка вне узора — ошибка', () => {
    const p = randomPattern(7, 10, 10, 3);
    expect(() => decodeWork(Uint8Array.from([1, 2, 3, 4, 5]))).toThrow(WorkFileError);
    const good = encodeWork(p.key, 5, [{ thread: 0, cells: [1, 2] }]);
    expect(() => decodeWork(good.subarray(0, 7))).toThrow(WorkFileError);
    const far = encodeWork(p.key, 5, [{ thread: 0, cells: [1, 99999] }]);
    expect(() => decodeWork(far)).toThrow(WorkFileError);
    const other = decodeWork(encodeWork('other@1', 5, [{ thread: 0, cells: [1] }]));
    expect(workFileFits(p, other)).toBe(false);
    const big = decodeWork(encodeWork(p.key, 5, [{ thread: 0, cells: [100] }]));
    expect(workFileFits(p, big)).toBe(false);
  });
});

describe('набор', () => {
  const pic = (id: string, order: number): Picture => ({
    id, v: 1, title: `Картинка ${id}`, collection: 'ornaments', order, size: 'S',
    source: { url: '', basis: 'своя работа студии' }, added: '2026-10-01',
  });

  test('запись и чтение: узор по смещению, палитра, календарь', () => {
    const pats = [randomPattern(1, 20, 20, 3), randomPattern(2, 7, 40, 12, 0.3), randomPattern(3, 120, 120, 32)];
    const pictures = pats.map((p, i) => {
      const picture = pic(`p${i}`, i);
      return { picture, pattern: { ...p, key: `p${i}@1` } };
    });
    const calendar = [{ date: '2026-10-02', picture: 'p0' }, { date: '2026-10-03', picture: 'p1' }];
    const bytes = writePack({ id: 'base-0.0', created: '2026-09-27', pictures, calendar });
    const pack = openPack(bytes);
    expect(packError(pack)).toBeNull();
    expect(pack.json.calendar).toEqual(calendar);
    // с конца к началу: каждый узор читается сам по себе
    for (let i = pictures.length - 1; i >= 0; i--) {
      const p = packPattern(pack, pack.json.pictures[i]);
      expect(p).toEqual(pictures[i].pattern);
    }
  });

  test('большой узор — 852 × 556, как «Утро» в четыре клетки на сантиметр: читается и сжат', () => {
    const pattern = { ...samplePattern(5, 852, 556, 30), key: 'big@1' };
    const picture = { ...pic('big', 0), size: 'XL' as const };
    const bytes = writePack({ id: 'x', created: '2026-09-27', pictures: [{ picture, pattern }] });
    const pack = openPack(bytes);
    expect(packError(pack)).toBeNull();
    expect(packPattern(pack, pack.json.pictures[0])).toEqual(pattern);
    // полосы «длина, нить» — меньше байта на клетку
    expect(bytes.length).toBeLessThan(pattern.w * pattern.h);
  });

  test('испорченный набор не проходит', () => {
    const pattern = { ...randomPattern(1, 10, 10, 3), key: 'a@1' };
    const bytes = writePack({ id: 'x', created: '2026-09-27', pictures: [{ picture: pic('a', 0), pattern }] });
    expect(() => openPack(bytes.subarray(0, 20))).toThrow();
    const cut = openPack(bytes.subarray(0, bytes.length - 1));
    expect(packError(cut)).toContain('за концом');
    const bad = bytes.slice();
    bad[bad.length - 1] = 9; // нить 9 при трёх нитях
    expect(packError(openPack(bad))).toContain('нить 9');
    expect(() => writePack({ id: 'x', created: '2026-09-27', pictures: [{ picture: pic('b', 0), pattern }] })).toThrow();
  });
});

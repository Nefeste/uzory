// Файл стежков и набор (docs/06-testing.md, «Переигрывание», «Файлы»).
import { describe, expect, test } from 'bun:test';
import { base64Decode, base64Encode, lazyBase64 } from '../../src/engine/base64';
import { BASE_PACK } from '../../src/content/generated/pack';
import type { Picture } from '../../src/engine/library';
import { openPack, packError, packPattern, writePack } from '../../src/engine/pack';
import { samplePattern } from '../../src/engine/sample';
import { rng } from '../../src/engine/seed';
import { utf8Decode, utf8Encode } from '../../src/engine/utf8';
import { Reader, Writer } from '../../src/engine/varint';
import { replay, Stitching, type Stroke } from '../../src/engine/work';
import { decodeWork, encodeWork, WorkFileError, workFileFits, WorkLog } from '../../src/engine/workfile';
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

  test('base64 по частям: байты те же, декодируется только то, о чём просили', () => {
    const r = rng(3);
    for (const n of [0, 1, 2, 3, 3071, 3072, 3073, 9218, 20000]) {
      // без нулей: незаполненное в `bytes` — нули
      const b = Uint8Array.from({ length: n }, () => 1 + Math.floor(r() * 255));
      const lazy = lazyBase64(base64Encode(b));
      expect(lazy.bytes.length).toBe(n);
      const a = Math.floor(n / 2);
      const z = Math.min(n, a + 10);
      lazy.fill(a, z);
      for (let i = a; i < z; i++) expect(lazy.bytes[i]).toBe(b[i]);
      if (n > 3 * 3072) expect(lazy.bytes[0]).toBe(0); // начало не тронуто
      lazy.fill(0, n);
      expect(lazy.bytes).toEqual(b);
    }
    expect(() => lazyBase64('abcde')).toThrow();
    const bad = lazyBase64(`${'A'.repeat(8000)}$AAA`);
    bad.fill(0, 10); // первый кусок цел
    expect(() => bad.fill(0, 6003)).toThrow();
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
    const far = encodeWork(p.key, 5, [{ thread: 0, cells: [1, 2_000_000] }]); // больше 1024 × 1024
    expect(() => decodeWork(far)).toThrow(WorkFileError);
    const other = decodeWork(encodeWork('other@1', 5, [{ thread: 0, cells: [1] }]));
    expect(workFileFits(p, other)).toBe(false);
    const big = decodeWork(encodeWork(p.key, 5, [{ thread: 0, cells: [100] }]));
    expect(workFileFits(p, big)).toBe(false);
  });
});

describe('файл растёт вместе с работой (WorkLog)', () => {
  /** Долгий штрих канва отдаёт частями, последнюю — с `final` и часто пустой (src/canvas/StitchCanvas.tsx). */
  function parts(r: () => number, s: Stroke): { cells: number[]; final: boolean }[] {
    const out: { cells: number[]; final: boolean }[] = [];
    for (let i = 0; i < s.cells.length;) {
      const n = 1 + Math.floor(r() * 12);
      out.push({ cells: s.cells.slice(i, i + n), final: false });
      i += n;
    }
    if (r() < 0.5) out.push({ cells: [], final: true });
    else out[out.length - 1].final = true;
    return out;
  }

  test('на каждой записи — те же байты, что у файла, собранного целиком', () => {
    for (const [seed, w, h] of [[21, 30, 30], [22, 120, 120], [23, 200, 150]]) {
      const p = randomPattern(seed, w, h, 12, 0.05);
      const r = rng(seed);
      const state = new Stitching(p);
      const log = new WorkLog(p.key, 1790000000000, []);
      let writes = 0;
      // случайные штрихи ложатся и на вышитое: бывает, что в части движок не принял ни стежка
      for (const s of randomStrokes(seed + 50, p, 2000)) {
        for (const part of parts(r, s)) {
          log.add(s.thread, state.apply({ thread: s.thread, cells: part.cells }), part.final);
          if (r() < 0.1) {
            expect(log.bytes()).toEqual(encodeWork(p.key, 1790000000000, log.strokes));
            writes++;
          }
        }
      }
      expect(writes).toBeGreaterThan(100);
      const f = decodeWork(log.bytes());
      expect(f.strokes).toEqual(log.strokes);
      expect(replay(p, f.strokes).state.stitched).toEqual(state.stitched);
    }
  });

  test('части одного долгого штриха — один штрих, и запись посреди него не теряет ни части', () => {
    const p = randomPattern(24, 10, 10, 1);
    const state = new Stitching(p);
    const log = new WorkLog(p.key, 5, []);
    log.add(0, state.apply({ thread: 0, cells: [10, 11] }), false);
    const mid = log.bytes();
    log.add(0, state.apply({ thread: 0, cells: [11] }), false); // по вышитому — ничего не принято
    log.add(0, state.apply({ thread: 0, cells: [12, 13] }), false);
    log.add(0, [], true);
    expect(log.strokes).toEqual([{ thread: 0, cells: [10, 11, 12, 13] }]);
    expect(decodeWork(mid).strokes).toEqual([{ thread: 0, cells: [10, 11] }]);
    expect(decodeWork(log.bytes()).strokes).toEqual(log.strokes);
  });

  test('штрих, в первой части которого не принято ни стежка, — новый, а не продолжение прежнего', () => {
    // иначе он дописался бы к штриху, уже записанному в файл, и при следующем открытии его стежков бы не было
    const p = randomPattern(25, 10, 10, 1);
    const state = new Stitching(p);
    const log = new WorkLog(p.key, 5, []);
    log.add(0, state.apply({ thread: 0, cells: [1, 2] }), true);
    const first = log.bytes();
    log.add(0, state.apply({ thread: 0, cells: [2] }), false);
    log.add(0, state.apply({ thread: 0, cells: [3, 4] }), true);
    expect(log.strokes).toEqual([{ thread: 0, cells: [1, 2] }, { thread: 0, cells: [3, 4] }]);
    const bytes = log.bytes();
    expect(bytes.subarray(0, first.length)).toEqual(first);
    expect(decodeWork(bytes).strokes).toEqual(log.strokes);
  });

  test('открытая из файла: новые штрихи — следом за его байтами, файл тот же, что собранный целиком', () => {
    const p = randomPattern(26, 120, 120, 16);
    const r = rng(26);
    const file = encodeWork(p.key, 7, replay(p, randomStrokes(26, p, 800)).strokes);
    const { state, strokes } = replay(p, decodeWork(file).strokes);
    const log = new WorkLog(p.key, 7, strokes, file);
    expect(log.bytes()).toEqual(file);
    for (const s of randomStrokes(27, p, 300)) {
      for (const part of parts(r, s)) log.add(s.thread, state.apply({ thread: s.thread, cells: part.cells }), part.final);
    }
    const bytes = log.bytes();
    expect(bytes.subarray(0, file.length)).toEqual(file);
    expect(bytes).toEqual(encodeWork(p.key, 7, log.strokes));
  });

  test('штрих файла, который переигрывание отбросило, не сбивает дописанное', () => {
    const p = randomPattern(28, 10, 10, 1);
    const file = encodeWork(p.key, 3, [{ thread: 0, cells: [1, 2] }, { thread: 0, cells: [2] }]); // второй — повтор
    const { state, strokes } = replay(p, decodeWork(file).strokes);
    expect(strokes).toHaveLength(1);
    const log = new WorkLog(p.key, 3, strokes, file);
    log.add(0, state.apply({ thread: 0, cells: [3] }), true);
    const again = replay(p, decodeWork(log.bytes()).strokes);
    expect(again.strokes).toEqual(log.strokes);
    expect(again.state.stitched).toEqual(state.stitched);
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

  test('набор из строки base64 по частям: открытие — заголовок и JSON, узор — тот же, что из целого', () => {
    const pats = [randomPattern(4, 120, 120, 32), randomPattern(5, 300, 200, 24), randomPattern(6, 20, 20, 3)];
    const pictures = pats.map((p, i) => ({ picture: pic(`q${i}`, i), pattern: { ...p, key: `q${i}@1` } }));
    const bytes = writePack({ id: 'base-lazy', created: '2026-10-12', pictures });
    const whole = openPack(bytes);
    const lazy = lazyBase64(base64Encode(bytes));
    const pack = openPack(lazy.bytes, lazy.fill);
    expect(pack.json).toEqual(whole.json);
    // узоры ещё не декодированы: в конце набора — нули, а не его байты
    expect(lazy.bytes.subarray(bytes.length - 100).every((x) => x === 0)).toBe(true);
    expect(bytes.subarray(bytes.length - 100).some((x) => x !== 0)).toBe(true);
    for (const p of pack.json.pictures) expect(packPattern(pack, p)).toEqual(packPattern(whole, p));
    expect(lazy.bytes).toEqual(bytes); // открыты все узоры — декодирован весь набор
    expect(packError(pack)).toBeNull();
  });

  test('встроенный набор приложения по частям — то же, что целиком', () => {
    const whole = openPack(base64Decode(BASE_PACK));
    const lazy = lazyBase64(BASE_PACK);
    const pack = openPack(lazy.bytes, lazy.fill);
    expect(pack.json).toEqual(whole.json);
    const all = whole.json.pictures;
    for (const p of [all[0], all[Math.floor(all.length / 2)], all[all.length - 1]]) {
      expect(packPattern(pack, p)).toEqual(packPattern(whole, p));
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

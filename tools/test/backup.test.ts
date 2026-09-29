// Файл переноса работ (docs/04-data-model.md, «Резервная копия и перенос»; docs/06-testing.md,
// «Перенос»): туда и обратно без потерь, чужой и испорченный файл не пишет на диск ничего
// лишнего, имена файлов из него безопасны, совпавшие работы не дублируются.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type BackupEntry, BackupError, type BackupMine, makeBackup, planImport, readBackup } from '../../src/engine/backup';
import { base64Encode } from '../../src/engine/base64';
import { CANVAS } from '../../src/engine/pattern';
import { encodeWork } from '../../src/engine/workfile';

const entry = (id: string, pattern: string, over: Partial<BackupEntry> = {}): BackupEntry => ({
  id, pattern, started: 1_790_000_000_000, done: 3, total: 6, opened: 1_790_000_100_000, ...over,
});
const log = (pattern: string, cells: number[]) => encodeWork(pattern, 1_790_000_000_000, [{ thread: 0, cells }]);
const mine = (id: string, over: Partial<BackupMine> = {}): BackupMine => ({
  key: `${id}@1`, title: 'Дача', created: 1_790_000_000_000, w: 3, h: 2,
  threads: [{ rgb: 0xb3162f, name: 'кумачовая' }, { rgb: 0x1f3c34, name: 'еловая' }],
  cells: base64Encode(Uint8Array.from([0, 1, 0, 1, CANVAS, 0])), ...over,
});
const file = (works: unknown[], mines: unknown[] = []) => JSON.stringify({ format: 'uzory-works', v: 1, created: '2026-09-29', works, mine: mines });

describe('файл переноса', () => {
  test('туда и обратно: записи, стежки и свои узоры те же; вышито — по стежкам файла', () => {
    const a = { entry: entry('w-mg5k2x-0a1b', 'rozetka@1', { done: 99, at: { x: 3.5, y: 7 } }), log: log('rozetka@1', [0, 1, 2]) };
    const b = { entry: entry('w-mg5k3y-0c2d', 'mine-mg5k1-00aa@1', { finished: 1_790_000_200_000, done: 5, total: 5 }), log: log('mine-mg5k1-00aa@1', [0, 1, 2, 3, 5]) };
    const r = readBackup(makeBackup('2026-09-29', [a, b], [mine('mine-mg5k1-00aa')]));
    expect(r.created).toBe('2026-09-29');
    expect(r.bad).toBe(0);
    expect(r.works.map((w) => w.entry)).toEqual([{ ...a.entry, done: 3 }, b.entry]);
    expect(r.works[0].log).toEqual(a.log);
    expect(r.mine).toEqual([mine('mine-mg5k1-00aa')]);
  });

  test('не файл работ «Узоров» — ошибка целиком', () => {
    expect(() => readBackup('не json')).toThrow(BackupError);
    expect(() => readBackup(JSON.stringify({ format: 'votchina-save', v: 1, works: [], mine: [] }))).toThrow(BackupError);
    expect(() => readBackup(JSON.stringify({ format: 'uzory-works', v: 2, works: [], mine: [] }))).toThrow(BackupError);
    expect(() => readBackup(JSON.stringify({ format: 'uzory-works', v: 1 }))).toThrow(BackupError);
    expect(() => readBackup('[]')).toThrow(BackupError);
  });

  test('имена файлов из файла безопасны: чужие id отбрасываются', () => {
    const ok = log('rozetka@1', [0]);
    const bad = ['../index', 'w-../x', 'w-a/b', 'W-ABC', 'w-', 'index.json', `w-${'a'.repeat(41)}`]
      .map((id) => ({ entry: entry(id, 'rozetka@1', { done: 1 }), log: base64Encode(ok) }));
    const r = readBackup(file(bad));
    expect(r.works).toEqual([]);
    expect(r.bad).toBe(bad.length);
    const m = readBackup(file([], [mine('../mine'), mine('mine-a/b'), { ...mine('mine-x'), key: 'mine-x@2' }]));
    expect(m.mine).toEqual([]);
    expect(m.bad).toBe(3);
  });

  test('испорченная работа или узор пропускаются, остальное — на месте', () => {
    const good = { entry: entry('w-good-0001', 'rozetka@1', { done: 1 }), log: base64Encode(log('rozetka@1', [0])) };
    const r = readBackup(file([
      good,
      { entry: entry('w-other-0002', 'rozetka@1'), log: base64Encode(log('zvezda-alatyr@1', [0])) }, // стежки другого узора
      { entry: entry('w-b64-0003', 'rozetka@1'), log: '***' }, // не base64
      { entry: entry('w-junk-0004', 'rozetka@1'), log: base64Encode(Uint8Array.from([1, 2, 3, 4, 5])) }, // не файл стежков
      { entry: entry('w-time-0005', 'rozetka@1', { started: -1 }), log: good.log },
      { entry: entry('w-over-0006', 'rozetka@1', { total: 1 }), log: base64Encode(log('rozetka@1', [0, 1])) }, // вышито больше, чем клеток
      { entry: entry('w-key-0007', 'Rozetka@1'), log: good.log },
      good, // тот же id второй раз
    ], [
      mine('mine-ok-01'),
      mine('mine-thread-02', { cells: base64Encode(Uint8Array.from([0, 1, 2, 0, 0, 0])) }), // нити 2 нет
      mine('mine-size-03', { w: 4 }), // клеток не w × h
      mine('mine-title-04', { title: '  ' }),
    ]));
    expect(r.works.map((w) => w.entry.id)).toEqual(['w-good-0001']);
    expect(r.mine.map((m) => m.key)).toEqual(['mine-ok-01@1']);
    expect(r.bad).toBe(7 + 3);
  });

  test('лишние поля записи не попадают в указатель', () => {
    const text = file([{ entry: { ...entry('w-x-0001', 'rozetka@1', { done: 1 }), path: '/etc' }, log: base64Encode(log('rozetka@1', [0])) }])
      .replace('"path":"/etc"', '"path":"/etc","__proto__":{"polluted":1}');
    const r = readBackup(text);
    expect(Object.keys(r.works[0].entry).sort()).toEqual(['done', 'id', 'opened', 'pattern', 'started', 'total']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('файлы прошлых версий формата загружаются (tools/test/fixtures/works/)', () => {
  const dir = join(import.meta.dir, 'fixtures', 'works');
  test.each(readdirSync(dir))('%s', (name) => {
    const r = readBackup(readFileSync(join(dir, name), 'utf8'));
    expect(r.bad).toBe(0);
    expect(r.works.length).toBeGreaterThan(0);
  });

  test('v1 из веб-версии 0.6.0: три работы — своя, орнамент и первая картинка — и свой узор', () => {
    const r = readBackup(readFileSync(join(dir, 'uzory-works-v1.uzw'), 'utf8'));
    expect(r.works.map((w) => [w.entry.pattern.replace(/^mine-.*/, 'mine'), w.entry.done, w.entry.finished !== undefined]))
      .toEqual([['mine', 0, false], ['romb-koltsa@1', 221, true], ['first-picture@1', 157, true]]);
    expect(r.mine.map((m) => [m.w, m.h, m.threads.length])).toEqual([[70, 53, 15]]);
  });
});

describe('что добавить из файла', () => {
  const w = (id: string, pattern: string, cells: number[]) => ({ entry: entry(id, pattern, { done: cells.length }), log: base64Encode(log(pattern, cells)) });

  test('новые — добавляются; совпавшие по id — остаётся та, где вышито больше', () => {
    const r = readBackup(file([w('w-new-0001', 'rozetka@1', [0]), w('w-same-0002', 'rozetka@1', [0, 1]), w('w-more-0003', 'rozetka@1', [0, 1, 2])]));
    const plan = planImport(r, { works: new Map([['w-same-0002', 2], ['w-more-0003', 1]]), mine: new Set() });
    expect(plan.works.map((x) => x.entry.id)).toEqual(['w-new-0001', 'w-more-0003']);
    expect(plan.same).toBe(1);
    // тот же файл второй раз — ничего нового
    const again = planImport(r, { works: new Map([['w-new-0001', 1], ['w-same-0002', 2], ['w-more-0003', 3]]), mine: new Set() });
    expect(again.works).toEqual([]);
    expect(again.same).toBe(3);
  });

  test('работа своего узора — только вместе с узором: из файла или уже на телефоне', () => {
    const r = readBackup(file([
      w('w-a-0001', 'mine-a-01@1', [0]),
      w('w-b-0002', 'mine-b-02@1', [0]),
      w('w-c-0003', 'mine-c-03@1', [0]),
    ], [mine('mine-a-01'), mine('mine-b-02')]));
    const plan = planImport(r, { works: new Map(), mine: new Set(['mine-b-02@1']) });
    expect(plan.mine.map((m) => m.key)).toEqual(['mine-a-01@1']);
    expect(plan.works.map((x) => x.entry.id)).toEqual(['w-a-0001', 'w-b-0002']);
    expect(plan.orphan).toBe(1);
  });
});

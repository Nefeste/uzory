// Набор недели (tools/content/week.ts; docs/05-process.md, «Выкладывание наборов»): что идёт в
// набор, как продолжается календарь картинок дня, каталог и подпись, золотой тест выпущенных
// узоров, чтение выпущенного с сервера.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCatalog } from '../../src/engine/catalog';
import { addDays } from '../../src/engine/dates';
import type { CalendarDay, CollectionId, Picture } from '../../src/engine/library';
import { openPack, writePack } from '../../src/engine/pack';
import type { Pattern, SizeClass } from '../../src/engine/pattern';
import { newKeyPair, verifyCatalog } from '../../src/engine/sign';
import { utf8Decode } from '../../src/engine/utf8';
import { makeCatalog, signJson } from '../content/catalog';
import {
  baseCatalog, freezeReleased, goldenErrors, isoWeek, loadReleased, NOTHING_RELEASED, patternDigest, reader, readWeek,
  type Released, type Source, weekPack, type WeekPlan,
} from '../content/week';

/** Шахматка квадратами 2 × 2 в две нити; `shift` меняет клетки местами. */
function checker(key: string, shift = 0): Pattern {
  const side = 12;
  const cells = new Uint8Array(side * side);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) cells[y * side + x] = ((x >> 1) + (y >> 1) + shift) & 1;
  return { key, w: side, h: side, threads: [{ rgb: 0xb3162f, name: 'кумачовая' }, { rgb: 0x1f3c34, name: 'еловая' }], cells };
}

const pic = (id: string, collection: CollectionId, o: { size?: SizeClass; v?: number; order?: number } = {}): Picture => ({
  id, v: o.v ?? 1, title: id, collection, order: o.order ?? 1, size: o.size ?? 'S',
  source: { url: '', basis: 'тест' }, added: '2026-10-01',
});
const src = (p: Picture, shift = 0): Source => ({ picture: p, pattern: checker(`${p.id}@${p.v}`, shift) });

/** Выпущенное: наборы по порядку, каталог — как его собирает CI. */
function released(packs: { id: string; sources: Source[]; calendar?: CalendarDay[]; builtin?: boolean; from?: string }[]): Released {
  const bytes = packs.map((p) => writePack({ id: p.id, created: '2026-10-01', pictures: p.sources, calendar: p.calendar }));
  const c = makeCatalog({ minApp: '1.0.0', packs: packs.map((p, i) => ({ id: p.id, bytes: bytes[i], builtin: p.builtin, from: p.from })) });
  const catalog = readCatalog(utf8Decode(c.json));
  return { catalog, json: c.json, packs: catalog.packs.map((entry, i) => ({ entry, pack: openPack(bytes[i]) })) };
}

const plan = (o: Partial<WeekPlan> = {}): WeekPlan => ({ id: 'w2026-42', from: '2026-10-12', days: 7, pin: new Map(), notice: null, minApp: null, ...o });

const A = pic('a-orn', 'ornaments', { order: 1 });
const B = pic('b-flo', 'flowers', { order: 1 });
const C = pic('c-kid', 'kids', { order: 1 });
const D = pic('d-orn', 'ornaments', { order: 2 });
const E = pic('e-flo', 'flowers', { order: 2 });
const BIG = pic('big-pai', 'painting', { size: 'L' });
const base = () => released([{
  id: 'base-1.0', builtin: true, sources: [A, B, C, D, E, BIG].map((p) => src(p)),
  calendar: [{ date: '2026-10-01', picture: A.id }, { date: '2026-10-02', picture: B.id }],
}]);

/** Ни одной пары соседних дней с картинками одной коллекции. */
function noSameInARow(days: CalendarDay[], all: Picture[]) {
  const col = new Map(all.map((p) => [p.id, p.collection]));
  for (let i = 1; i < days.length; i++) expect(col.get(days[i].picture)).not.toBe(col.get(days[i - 1].picture));
}

describe('неделя и content/week.yaml', () => {
  test('неделя по ISO: с понедельника, год — по четвергу', () => {
    expect(isoWeek('2026-10-12')).toBe('w2026-42');
    expect(isoWeek('2026-10-18')).toBe('w2026-42');
    expect(isoWeek('2026-01-01')).toBe('w2026-01');
    expect(isoWeek('2027-01-01')).toBe('w2026-53');
    expect(isoWeek('2024-12-30')).toBe('w2025-01');
  });

  test('план недели: id — неделя даты from, второй набор недели — с «-2»', () => {
    const ok = readWeek({ id: 'w2026-42', from: '2026-10-12', pin: { '2026-10-14': 'x' } });
    expect(ok.errors).toEqual([]);
    expect(ok.plan).toEqual(plan({ pin: new Map([['2026-10-14', 'x']]) }));
    expect(readWeek({ id: 'w2026-42-2', from: '2026-10-15', days: 3 }).plan?.days).toBe(3);
    expect(readWeek({ id: 'w2026-41', from: '2026-10-12' }).errors.join()).toContain('w2026-42');
    expect(readWeek({ id: 'w2026-42', from: '2026-10-12', days: 100 }).errors.join()).toContain('days');
    expect(readWeek({ id: 'w2026-42', from: '12.10.2026' }).plan).toBeNull();
    expect(readWeek({ id: 'w2026-42', from: '2026-10-12', min_app: '1.1' }).errors.join()).toContain('min_app');
  });
});

describe('набор недели', () => {
  test('в наборе — только новые картинки и новые версии, видны с from', () => {
    const B2 = pic('b-flo', 'flowers', { v: 2 });
    const F = pic('f-orn', 'ornaments', { order: 3 });
    const G = pic('g-kid', 'kids', { order: 2 });
    const built = [A, B, C, D, E, BIG].map((p) => src(p)).concat([src(B2, 1), src(F), src(G)]).filter((s) => s.picture !== B);
    const w = weekPack(base(), built, plan());
    expect(w.pictures.map((p) => `${p.id}@${p.v}`)).toEqual(['f-orn@1', 'b-flo@2', 'g-kid@1']);
    expect(w.pictures.every((p) => p.added === '2026-10-12')).toBe(true);
    const pack = openPack(w.bytes);
    expect(pack.json.id).toBe('w2026-42');
    expect(pack.json.created).toBe('2026-10-12');
  });

  test('календарь — с from, если выпущенный кончился раньше; бывшие картинкой дня не повторяются', () => {
    const F = pic('f-orn', 'ornaments', { order: 3 });
    const G = pic('g-kid', 'kids', { order: 2 });
    const w = weekPack(base(), [A, B, C, D, E, BIG, F, G].map((p) => src(p)), plan());
    // малые и средние, ещё не бывшие картинкой дня: C, D, E, F, G — пять дней из семи
    expect(w.calendar.map((d) => d.date)).toEqual([0, 1, 2, 3, 4].map((k) => addDays('2026-10-12', k)));
    expect(new Set(w.calendar.map((d) => d.picture))).toEqual(new Set(['c-kid', 'd-orn', 'e-flo', 'f-orn', 'g-kid']));
    noSameInARow(w.calendar, [C, D, E, F, G]);
  });

  test('календарь продолжает выпущенный без разрыва и без той же коллекции на стыке', () => {
    const r = released([{
      id: 'base-1.0', builtin: true, sources: [A, B, C, D, E].map((p) => src(p)),
      calendar: [{ date: '2026-10-20', picture: B.id }, { date: '2026-10-21', picture: A.id }],
    }]);
    const w = weekPack(r, [A, B, C, D, E, pic('f-kid', 'kids', { order: 2 })].map((p) => src(p)), plan({ days: 2 }));
    expect(w.calendar.map((d) => d.date)).toEqual(['2026-10-22', '2026-10-23']);
    expect(w.calendar[0].picture).not.toBe(D.id); // вчера — орнамент
  });

  test('дни из pin — ровно в свой день; вне недели или картинка уже была — ошибка', () => {
    const F = pic('f-orn', 'ornaments', { order: 3 });
    const all = [A, B, C, D, E, F].map((p) => src(p));
    const w = weekPack(base(), all, plan({ pin: new Map([['2026-10-14', 'f-orn']]) }));
    expect(w.calendar.find((d) => d.date === '2026-10-14')?.picture).toBe('f-orn');
    expect(w.calendar.filter((d) => d.picture === 'f-orn')).toHaveLength(1);
    expect(() => weekPack(base(), all, plan({ pin: new Map([['2026-10-30', 'f-orn']]) }))).toThrow('вне календаря');
    expect(() => weekPack(base(), all, plan({ pin: new Map([['2026-10-14', A.id]]) }))).toThrow('a-orn');
    // большая картинка дня не бывает; одна картинка — не на два дня
    expect(() => weekPack(base(), all.concat(src(BIG)), plan({ pin: new Map([['2026-10-14', BIG.id]]) }))).toThrow('big-pai');
    expect(() => weekPack(base(), all, plan({ pin: new Map([['2026-10-14', 'f-orn'], ['2026-10-15', 'f-orn']]) }))).toThrow('двух днях');
  });

  test('каталог: выпущенные наборы как были, новый — в конце, календарь до конца недели; подпись', () => {
    const r = base();
    const w = weekPack(r, [A, B, C, D, E, pic('f-orn', 'ornaments', { order: 3 })].map((p) => src(p)), plan({ notice: 'Праздники' }));
    const cat = readCatalog(utf8Decode(w.catalog.json));
    expect(cat.packs.map((p) => p.id)).toEqual(['base-1.0', 'w2026-42']);
    expect(cat.packs[0]).toEqual(r.catalog!.packs[0]);
    expect(cat.packs[1].from).toBe('2026-10-12');
    expect(cat.packs[1].builtin).toBeUndefined();
    expect(cat.calendar).toEqual({ pack: 'w2026-42', until: w.calendar.at(-1)!.date });
    expect(cat.minApp).toBe('1.0.0');
    expect(cat.notice).toBe('Праздники');
    const key = newKeyPair();
    expect(verifyCatalog(w.catalog.json, signJson(w.catalog.json, key.secret), [key.public])).toBe(true);
  });

  test('уже выпущенный id, нечего выпускать, нет каталога — ошибка', () => {
    expect(() => weekPack(base(), [A].map((p) => src(p)), plan({ id: 'base-1.0' }))).toThrow('уже выпущен');
    const done = released([{ id: 'base-1.0', sources: [A, B].map((p) => src(p)), calendar: [{ date: '2026-10-01', picture: A.id }, { date: '2026-10-02', picture: B.id }] }]);
    expect(() => weekPack(done, [A, B].map((p) => src(p)), plan())).toThrow('выпускать нечего');
    expect(() => weekPack(NOTHING_RELEASED, [A].map((p) => src(p)), plan())).toThrow('--base');
  });
});

describe('золотой тест и первый каталог', () => {
  test('выпущенный ключ собирается в те же клетки — иначе ошибка с ключом', () => {
    expect(goldenErrors(base(), [A, B, C].map((p) => src(p)))).toEqual([]);
    const errs = goldenErrors(base(), [src(A), src(B, 1)]);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('b-flo@1');
    // новая версия — не ошибка: это новый ключ
    expect(goldenErrors(base(), [src(pic('b-flo', 'flowers', { v: 2 }), 1)])).toEqual([]);
  });

  test('список выпущенного у теста пополняется, записанное не меняется', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'uzory-week-')), 'released.json');
    writeFileSync(file, JSON.stringify({ _: 'тест', patterns: {} }));
    expect(freezeReleased(file, [src(B), src(A)])).toBe(2);
    expect(freezeReleased(file, [src(A), src(C)])).toBe(3);
    const doc = JSON.parse(readFileSync(file, 'utf8')) as { patterns: Record<string, string> };
    expect(Object.keys(doc.patterns)).toEqual(['a-orn@1', 'b-flo@1', 'c-kid@1']);
    expect(doc.patterns['a-orn@1']).toBe(patternDigest(src(A).pattern));
    expect(() => freezeReleased(file, [src(A, 1)])).toThrow('a-orn@1');
  });

  test('первый каталог — встроенный набор; когда каталог есть — ошибка', () => {
    const bytes = writePack({ id: 'base-1.0', created: '2026-10-01', pictures: [src(A)], calendar: [{ date: '2026-10-05', picture: A.id }] });
    const cat = readCatalog(utf8Decode(baseCatalog(NOTHING_RELEASED, bytes, '1.0.0').json));
    expect(cat.packs).toHaveLength(1);
    expect(cat.packs[0].builtin).toBe(true);
    expect(cat.calendar).toEqual({ pack: 'base-1.0', until: '2026-10-05' });
    expect(() => baseCatalog(base(), bytes, '1.0.0')).toThrow('1.1');
  });
});

describe('выпущенное с сервера', () => {
  /** Папка с устройством сервера: catalog.json, catalog.sig, packs/. */
  function serverDir(r: Released, secret: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'uzory-week-'));
    mkdirSync(join(dir, 'packs'));
    for (const p of r.packs) writeFileSync(join(dir, p.entry.file), p.pack.bytes);
    writeFileSync(join(dir, 'catalog.json'), r.json!);
    writeFileSync(join(dir, 'catalog.sig'), signJson(r.json!, secret));
    return dir;
  }

  test('каталог с верной подписью и наборы читаются; чужая подпись, битый набор — ошибка', async () => {
    const key = newKeyPair();
    const r = base();
    const dir = serverDir(r, key.secret);
    const got = await loadReleased(reader(dir), [key.public]);
    expect(got.catalog).toEqual(r.catalog);
    expect(got.packs.map((p) => p.pack.json.id)).toEqual(['base-1.0']);
    await expect(loadReleased(reader(dir), [newKeyPair().public])).rejects.toThrow('подпись');
    writeFileSync(join(dir, r.packs[0].entry.file), new Uint8Array(10));
    await expect(loadReleased(reader(dir), [key.public])).rejects.toThrow('SHA-256');
  });

  test('каталога нет — ничего не выпущено; без ключей подпись не проверить — только для сверки', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'uzory-week-'));
    expect(await loadReleased(reader(empty), [])).toBe(NOTHING_RELEASED);
    const dir = serverDir(base(), newKeyPair().secret);
    await expect(loadReleased(reader(dir), [])).rejects.toThrow('ключей нет');
    expect((await loadReleased(reader(dir), [], true)).packs).toHaveLength(1);
  });
});

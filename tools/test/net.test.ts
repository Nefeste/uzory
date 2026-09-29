// Раздача картинок (docs/03-server-api.md; docs/06-testing.md, «Раздача»): каталог разбирается
// строго, подпись проверяется до разбора и с запасным ключом, наборы качаются только новые,
// ключ сценария на телефоне не действует.
import { describe, expect, test } from 'bun:test';
import { CatalogError, packsToFetch, readCatalog, versionLess } from '../../src/engine/catalog';
import type { Picture } from '../../src/engine/library';
import { libraryIndex, mergedCalendar, openPack, packError, packPattern, samePattern, writePack } from '../../src/engine/pack';
import type { Pattern } from '../../src/engine/pattern';
import { newKeyPair, publicKeyOf, sha256Hex, signCatalog, verifyCatalog } from '../../src/engine/sign';
import { utf8Decode, utf8Encode } from '../../src/engine/utf8';
import { CATALOG_KEYS, E2E_KEY, trustedKeys } from '../../src/state/keys';
import { makeCatalog } from '../content/catalog';
import { E2E_SECRET, e2ePack } from '../e2e/net';

const pack = (id: string) => e2ePack(id, [{ id: `${id}-uzor`, title: 'Узор' }], '2026-10-12');

describe('каталог', () => {
  test('собранный каталог разбирается: наборы, встроенный, дата, календарь', () => {
    const c = makeCatalog({
      minApp: '1.0.0', notice: ' Праздники ', calendar: { pack: 'w2026-41', until: '2027-02-14' },
      packs: [{ id: 'base-1.0', bytes: pack('base'), builtin: true }, { id: 'w2026-41', bytes: pack('w'), from: '2026-10-12' }],
    });
    const r = readCatalog(utf8Decode(c.json));
    expect(r.packs.map((p) => [p.id, !!p.builtin, p.from ?? null])).toEqual([['base-1.0', true, null], ['w2026-41', false, '2026-10-12']]);
    expect(r.packs[1].file).toBe(`packs/w2026-41.${r.packs[1].sha256.slice(0, 8)}.pack`);
    expect(c.files.get(r.packs[1].file)).toEqual(pack('w'));
    expect(r.calendar).toEqual({ pack: 'w2026-41', until: '2027-02-14' });
    expect(r.notice).toBe('Праздники');
  });

  test('чужое и битое — CatalogError: телефон живёт тем, что скачал', () => {
    const ok = JSON.parse(utf8Decode(makeCatalog({ minApp: '1.0.0', packs: [{ id: 'w2026-41', bytes: pack('w') }] }).json));
    const bad = (patch: (c: typeof ok) => void) => {
      const c = structuredClone(ok);
      patch(c);
      return () => readCatalog(JSON.stringify(c));
    };
    expect(() => readCatalog('<html>502</html>')).toThrow(CatalogError);
    expect(bad((c) => { c.format = 2; })).toThrow(CatalogError);
    expect(bad((c) => { c.minApp = 'новая'; })).toThrow(CatalogError);
    expect(bad((c) => { c.packs[0].id = '../works'; })).toThrow(CatalogError);
    expect(bad((c) => { c.packs[0].file = 'packs/../../etc.pack'; })).toThrow(CatalogError);
    expect(bad((c) => { c.packs[0].sha256 = 'abc'; })).toThrow(CatalogError);
    expect(bad((c) => { c.packs[0].bytes = 1e12; })).toThrow(CatalogError);
    expect(bad((c) => { c.packs[0].from = '2026-02-30'; })).toThrow(CatalogError);
    expect(bad((c) => { c.packs.push(c.packs[0]); })).toThrow(CatalogError);
    expect(bad((c) => { c.notice = 'я'.repeat(201); })).toThrow(CatalogError);
  });

  test('версии сравниваются числами', () => {
    expect(versionLess('1.0.9', '1.0.10')).toBe(true);
    expect(versionLess('1.2.0', '1.10.0')).toBe(true);
    expect(versionLess('0.7.0', '0.7.0')).toBe(false);
    expect(versionLess('2.0.0', '1.99.99')).toBe(false);
  });

  test('качаются только новые: не встроенные и не скачанные раньше', () => {
    const c = readCatalog(utf8Decode(makeCatalog({
      minApp: '1.0.0',
      packs: [{ id: 'base-1.0', bytes: pack('base'), builtin: true }, { id: 'w1', bytes: pack('a') }, { id: 'w2', bytes: pack('b') }],
    }).json));
    expect(packsToFetch(c, new Set(['w1'])).map((p) => p.id)).toEqual(['w2']);
  });
});

describe('подпись каталога', () => {
  const json = utf8Encode('{"format":1}');

  test('сходится с нынешним или следующим ключом; чужой ключ, правка байта, мусор — нет', () => {
    const now = newKeyPair();
    const next = newKeyPair();
    const other = newKeyPair();
    expect(verifyCatalog(json, signCatalog(json, now.secret), [now.public, next.public])).toBe(true);
    expect(verifyCatalog(json, signCatalog(json, next.secret), [now.public, next.public])).toBe(true);
    expect(verifyCatalog(json, signCatalog(json, other.secret), [now.public, next.public])).toBe(false);
    expect(verifyCatalog(utf8Encode('{"format":2}'), signCatalog(json, now.secret), [now.public])).toBe(false);
    expect(verifyCatalog(json, 'не base64', [now.public])).toBe(false);
    expect(verifyCatalog(json, signCatalog(json, now.secret), [])).toBe(false);
    expect(verifyCatalog(json, signCatalog(json, now.secret), ['битый', now.public])).toBe(true);
  });

  test('ключ сценария: из строки tools/e2e и не действует вне веб-сборки на этом компьютере', () => {
    expect(publicKeyOf(E2E_SECRET)).toBe(E2E_KEY);
    expect(CATALOG_KEYS).not.toContain(E2E_KEY);
    // src/state/net-env.ts — телефон: LOCAL_TEST всегда false
    expect(trustedKeys()).not.toContain(E2E_KEY);
  });

  test('SHA-256 — как у всех', () => {
    expect(sha256Hex(utf8Encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

test('набор сценария проходит полную проверку набора', () => {
  expect(packError(openPack(pack('w2026-41')))).toBeNull();
});

describe('библиотека из нескольких наборов', () => {
  const pic = (id: string, v: number): Picture => ({
    id, v, title: id, collection: 'ornaments', order: 1, size: 'S', source: { url: '', basis: 'тест' }, added: '2026-10-01',
  });
  const pat = (id: string, v: number, fill: number): Pattern => ({
    key: `${id}@${v}`, w: 2, h: 2, threads: [{ rgb: 0xb3162f, name: 'кумачовая' }, { rgb: 0x1f3c34, name: 'еловая' }],
    cells: Uint8Array.from([fill, 1 - fill, 0, 1]),
  });
  const base = openPack(writePack({
    id: 'base', created: '2026-10-01',
    pictures: [{ picture: pic('a', 1), pattern: pat('a', 1, 0) }, { picture: pic('b', 1), pattern: pat('b', 1, 0) }],
    calendar: [{ date: '2026-10-01', picture: 'a' }, { date: '2026-10-02', picture: 'b' }],
  }));
  const week = openPack(writePack({
    id: 'w1', created: '2026-10-05',
    pictures: [{ picture: pic('a', 2), pattern: pat('a', 2, 1) }, { picture: pic('b', 1), pattern: pat('b', 1, 1) }, { picture: pic('c', 1), pattern: pat('c', 1, 0) }],
    calendar: [{ date: '2026-10-02', picture: 'c' }, { date: '2026-10-03', picture: 'a' }],
  }));

  test('последняя версия — в библиотеке, прежняя — для начатых работ; та же версия не дублируется', () => {
    const lib = libraryIndex([base, week]);
    expect(lib.latest.map((p) => `${p.id}@${p.v}`)).toEqual(['a@2', 'b@1', 'c@1']);
    expect([...lib.byKey.keys()].sort()).toEqual(['a@1', 'a@2', 'b@1', 'c@1']);
    // b@1 — из первого набора: второй с тем же ключом не заменяет
    expect(lib.byKey.get('b@1')?.pack.json.id).toBe('base');
  });

  test('узор с тем же ключом, но другими клетками — заметен', () => {
    const b1 = packPattern(base, base.json.pictures[1]);
    const b1again = packPattern(week, week.json.pictures[1]);
    expect(samePattern(b1, b1)).toBe(true);
    expect(samePattern(b1, b1again)).toBe(false);
  });

  test('календарь: поздний набор продлевает и правит день', () => {
    expect(mergedCalendar([base, week])).toEqual([
      { date: '2026-10-01', picture: 'a' }, { date: '2026-10-02', picture: 'c' }, { date: '2026-10-03', picture: 'a' },
    ]);
  });
});


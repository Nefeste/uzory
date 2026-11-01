// «Тайна от друга» (0.23.0; src/engine/gift.ts): файл подарка — узор, название, подпись и записка, без
// снимка; читается обратно тем же узором; чужой, испорченный, новый и файл переноса — своя причина;
// тот же подарок — тот же id.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { base64Encode } from '../../src/engine/base64';
import { cleanNote, GIFT_FORMAT, GIFT_MAX_BYTES, GIFT_NOTE_MAX, GiftError, giftId, giftNote, makeGift, readGift } from '../../src/engine/gift';
import { CANVAS, type Pattern } from '../../src/engine/pattern';
import { utf8Decode, utf8Encode } from '../../src/engine/utf8';
import { MINE_KEY } from '../../src/engine/backup';

const pattern: Pattern = {
  key: 'mine-x@1', w: 3, h: 2,
  threads: [{ rgb: 0xb3162f, name: 'кумачовая' }, { rgb: 0x1f3c34, name: 'еловая' }],
  cells: Uint8Array.from([0, 1, CANVAS, 1, 0, 0]),
};

/** id тайны из образца tools/test/fixtures/gift/uzory-gift-v1.uzory */
const GIFT_V1_ID = 'mine-g-09k6vk017vrrtd';

const problem = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e instanceof GiftError ? e.problem : 'other';
  }
  return null;
};
const raw = (o: Record<string, unknown>) => utf8Encode(JSON.stringify(o));
const good = { format: GIFT_FORMAT, v: 1, title: 'Кот', created: '2026-11-01', w: 3, h: 2, threads: pattern.threads, cells: base64Encode(pattern.cells) };

describe('файл подарка', () => {
  test('туда и обратно: тот же узор, название, подпись и записка; снимка нет', () => {
    const bytes = makeGift(pattern, '  Кот  на окне ', { from: ' Маша ', note: 'Вышей —\n\n\n\nудивишься!' }, '2026-11-01');
    const text = utf8Decode(bytes);
    expect(text).not.toContain('jpeg');
    expect(text).not.toContain('data:');
    const g = readGift(bytes);
    expect(g.title).toBe('Кот на окне');
    expect(g.from).toBe('Маша');
    expect(g.note).toBe('Вышей —\n\nудивишься!');
    expect(g.created).toBe('2026-11-01');
    expect(g.pattern.w).toBe(3);
    expect(g.pattern.threads).toEqual(pattern.threads);
    expect(Array.from(g.pattern.cells)).toEqual(Array.from(pattern.cells));
  });

  test('без подписи и записки — их нет и в подарке', () => {
    const g = readGift(makeGift(pattern, 'Кот', { from: '   ', note: '' }, '2026-11-01'));
    expect(g.from).toBeUndefined();
    expect(g.note).toBeUndefined();
    expect(giftNote(undefined, undefined)).toEqual({});
  });

  test('записка — не длиннее предела, управляющие знаки — пробелом', () => {
    expect(cleanNote('а'.repeat(GIFT_NOTE_MAX + 50), GIFT_NOTE_MAX)).toHaveLength(GIFT_NOTE_MAX);
    expect(giftNote('Ма\u0007ша', undefined).from).toBe('Ма ша');
  });

  test('чужой файл, файл переноса, новая версия, испорченный и слишком большой — каждый со своей причиной', () => {
    expect(problem(() => readGift(utf8Encode('не json')))).toBe('notGift');
    expect(problem(() => readGift(raw({ format: 'другое' })))).toBe('notGift');
    expect(problem(() => readGift(raw({ format: 'uzory-works', v: 1, works: [], mine: [] })))).toBe('works');
    expect(problem(() => readGift(raw({ ...good, v: 2 })))).toBe('newer');
    expect(problem(() => readGift(raw({ ...good, w: 4 })))).toBe('broken');
    expect(problem(() => readGift(raw({ ...good, cells: base64Encode(Uint8Array.from([0, 1, 2, 1, 0, 0])) })))).toBe('broken');
    expect(problem(() => readGift(raw({ ...good, cells: base64Encode(new Uint8Array(6).fill(CANVAS)) })))).toBe('broken');
    expect(problem(() => readGift(raw({ ...good, title: '  ' })))).toBe('broken');
    expect(problem(() => readGift(raw({ ...good, created: 'вчера' })))).toBe('broken');
    expect(problem(() => readGift(raw({ ...good, threads: [{ rgb: -1, name: 'x' }] })))).toBe('broken');
    expect(problem(() => readGift(new Uint8Array(GIFT_MAX_BYTES + 1)))).toBe('tooBig');
    expect(problem(() => readGift(raw(good)))).toBeNull();
  });

  test('файл тайны 0.23.0 читается и дальше (tools/test/fixtures/gift/): узор, подпись, записка и id те же', () => {
    const g = readGift(new Uint8Array(readFileSync(join(import.meta.dir, 'fixtures', 'gift', 'uzory-gift-v1.uzory'))));
    expect([g.title, g.from, g.note, g.created, g.pattern.w, g.pattern.h]).toEqual(['Сердечко', 'Маша', 'С днём рождения!\nВышей — удивишься.', '2026-11-01', 7, 6]);
    expect(g.pattern.threads.map((t) => t.name)).toEqual(['кумачовая', 'белёная']);
    expect(Array.from(g.pattern.cells).filter((c) => c !== CANVAS)).toHaveLength(27);
    // id тайны у друга — по содержимому: поменяется расчёт — тот же файл станет второй тайной
    expect(giftId(g)).toBe(GIFT_V1_ID);
  });

  test('id подарка: тот же файл — тот же id, другая записка — другой; подходит под ключ своего узора', () => {
    const a = readGift(makeGift(pattern, 'Кот', { from: 'Маша', note: 'Привет' }, '2026-11-01'));
    const b = readGift(makeGift(pattern, 'Кот', { from: 'Маша', note: 'Привет' }, '2026-11-01'));
    const c = readGift(makeGift(pattern, 'Кот', { from: 'Маша', note: 'Пока' }, '2026-11-01'));
    expect(giftId(a)).toBe(giftId(b));
    expect(giftId(a)).not.toBe(giftId(c));
    expect(MINE_KEY.test(`${giftId(a)}@1`)).toBe(true);
  });
});

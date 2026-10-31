// «Тайна» (issue 117, вариант А; src/engine/mystery.ts): из доступных и не начатых, нужного размера,
// без сегодняшней картинки дня и скрытых; большая — и огромные картины.
import { describe, expect, test } from 'bun:test';
import type { Access } from '../../src/engine/access';
import type { Picture } from '../../src/engine/library';
import { mysteryPool, pickMystery } from '../../src/engine/mystery';
import type { SizeClass } from '../../src/engine/pattern';

const pic = (id: string, size: SizeClass, extra: Partial<Picture> = {}): Picture =>
  ({ id, v: 1, title: id, collection: 'ornaments', order: 9, size, source: { url: '', basis: '' }, added: '2026-10-01', ...extra }) as Picture;

describe('«Тайна»', () => {
  const pics = [
    pic('free-s', 'S'), pic('daily-s', 'S'), pic('plus-s', 'S'), pic('locked-s', 'S'), pic('started-s', 'S'),
    pic('today-s', 'S'), pic('hidden-s', 'S', { hidden: true }), pic('m', 'M'), pic('l', 'L'), pic('xl', 'XL'),
  ];
  const access: Record<string, Access> = { 'daily-s': 'daily', 'plus-s': 'plus', 'locked-s': 'locked', 'started-s': 'started' };
  const ctx = { access: (p: Picture) => access[p.id] ?? 'free', hasWork: (p: Picture) => p.id === 'started-s', dailyId: 'today-s' };

  test('малая: бесплатные, прошлые картинки дня и «Узоры+»; без запертых, начатых, сегодняшней и скрытых', () => {
    expect(mysteryPool(pics, 'S', ctx).map((p) => p.id)).toEqual(['free-s', 'daily-s', 'plus-s']);
  });

  test('бесплатная, но уже начатая — не «тайна»', () => {
    expect(mysteryPool([pic('a', 'S')], 'S', { ...ctx, hasWork: () => true })).toEqual([]);
  });

  test('средняя — только средние; большая — большие и огромные', () => {
    expect(mysteryPool(pics, 'M', ctx).map((p) => p.id)).toEqual(['m']);
    expect(mysteryPool(pics, 'L', ctx).map((p) => p.id)).toEqual(['l', 'xl']);
  });

  test('выбор — случайный из пула; пустой пул — null', () => {
    const pool = mysteryPool(pics, 'S', ctx);
    expect(pickMystery(pool, () => 0)?.id).toBe('free-s');
    expect(pickMystery(pool, () => 0.999)?.id).toBe('plus-s');
    expect(pickMystery([], () => 0.5)).toBeNull();
  });
});

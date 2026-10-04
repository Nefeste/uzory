// Сборка картинок (docs/06-testing.md, «Картинки»): проверки ловят испорченные карточки,
// сборка детерминирована до байта, выпущенные узоры не меняются (ADR 0010).
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SizeClass } from '../../src/engine/pattern';
import { buildAll, buildLimitMs, slowPictures } from '../content/build';
import { type Card, readCard, releasable } from '../content/cards';
import type { Checked } from '../content/checks';
import { patternDigest } from '../content/week';

const FIX = join(import.meta.dir, 'fixtures');

describe('карточки', () => {
  const dir = join(FIX, 'bad-cards', 'painting');
  const expected: Record<string, RegExp> = {
    'no-basis.yaml': /основани/,
    'late-author.yaml': /умер в 1960/,
    'late-work.yaml': /1935 года/,
    'no-museum.yaml': /museum|где хранится/,
    'both-ways.yaml': /ровно одно/,
    'Bad_Id.yaml': /латиница/,
    'bad-season.yaml': /season «зима»/,
    'bad-day.yaml': /day «02-30»/,
  };
  for (const f of readdirSync(dir)) {
    test(`испорченная карточка ${f} не проходит`, () => {
      const { card, errors } = readCard(join(dir, f));
      expect(card).toBeNull();
      expect(errors.join('; ')).toMatch(expected[f]);
    });
  }

  test('музейный предмет без лицензии и без «да» владельца — не в выпуск', () => {
    const c = { approved: '2026-10-01', museum: 'ru', license: null } as unknown as Parameters<typeof releasable>[0];
    expect(releasable(c)).toContain('В12');
    expect(releasable({ ...c, museum: 'abroad' })).toBeNull();
    expect(releasable({ ...c, approved: undefined })).toContain('approved');
  });
});

describe('время сборки (docs/specs/2026-09-content-pipeline.md, критерий 4)', () => {
  test('дольше предела — картинка дольше 2 с, огромная дольше 10 с: в отчёт, предупреждением', () => {
    const b = (id: string, size: SizeClass, ms: number) => ({ card: { id, path: `content/x/${id}.yaml` } as Card, checked: { size } as Checked, ms });
    expect([buildLimitMs('S'), buildLimitMs('M'), buildLimitMs('L'), buildLimitMs('XL')]).toEqual([2000, 2000, 2000, 10_000]);
    const slow = slowPictures([b('s', 'S', 1999), b('s-slow', 'S', 2001), b('l-slow', 'L', 2500), b('xl', 'XL', 9999), b('xl-slow', 'XL', 10_001)]);
    expect(slow.map((x) => x.card.id)).toEqual(['s-slow', 'l-slow', 'xl-slow']);
  });
});

describe('сборка', () => {
  // полная сборка идёт минуты (картины в четыре клетки на сантиметр, старинные схемы; 331 картинка —
  // около трёх минут у ассистента, 04.10.2026): первая общая для обоих тестов, предел — с запасом на рост набора
  let first: ReturnType<typeof buildAll> | null = null;
  const once = () => (first ??= buildAll());

  test('две сборки подряд — один и тот же набор до байта', async () => {
    const a = await once();
    const b = await buildAll();
    expect(a.failed).toEqual([]);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  }, 900_000);

  test('выпущенные узоры не изменились (tools/test/fixtures/released.json)', async () => {
    const released = JSON.parse(readFileSync(join(FIX, 'released.json'), 'utf8')).patterns as Record<string, string>;
    const { built } = await once();
    for (const [key, sha] of Object.entries(released)) {
      const b = built.find((x) => x.pattern.key === key);
      expect(b ? patternDigest(b.pattern) : `узора ${key} нет`).toBe(sha);
    }
  }, 300_000);
});

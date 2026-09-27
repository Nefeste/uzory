// Сборка картинок (docs/06-testing.md, «Картинки»): проверки ловят испорченные карточки,
// сборка детерминирована до байта, выпущенные узоры не меняются (ADR 0010).
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hex, type Pattern } from '../../src/engine/pattern';
import { buildAll } from '../content/build';
import { readCard, releasable } from '../content/cards';

const FIX = join(import.meta.dir, 'fixtures');

const digest = (p: Pattern) => createHash('sha256').update(p.cells).update(p.threads.map((t) => `${hex(t.rgb)} ${t.name}`).join('\n')).digest('hex');

describe('карточки', () => {
  const dir = join(FIX, 'bad-cards', 'painting');
  const expected: Record<string, RegExp> = {
    'no-basis.yaml': /основани/,
    'late-author.yaml': /умер в 1960/,
    'late-work.yaml': /1935 года/,
    'no-museum.yaml': /museum|где хранится/,
    'both-ways.yaml': /ровно одно/,
    'Bad_Id.yaml': /латиница/,
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

describe('сборка', () => {
  test('две сборки подряд — один и тот же набор до байта', async () => {
    const a = await buildAll();
    const b = await buildAll();
    expect(a.failed).toEqual([]);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  }, 120_000);

  test('выпущенные узоры не изменились (tools/test/fixtures/released.json)', async () => {
    const released = JSON.parse(readFileSync(join(FIX, 'released.json'), 'utf8')).patterns as Record<string, string>;
    const { built } = await buildAll();
    for (const [key, sha] of Object.entries(released)) {
      const b = built.find((x) => x.pattern.key === key);
      expect(b ? digest(b.pattern) : `узора ${key} нет`).toBe(sha);
    }
  }, 120_000);
});

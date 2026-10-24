// Сборка картинок (docs/06-testing.md, «Картинки»): проверки ловят испорченные карточки,
// сборка детерминирована до байта, выпущенные узоры не меняются (ADR 0010).
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { access, type AccessContext } from '../../src/engine/access';
import { COLLECTIONS, FREE_FIRST, patternKey } from '../../src/engine/library';
import { libraryIndex, openPack } from '../../src/engine/pack';
import type { SizeClass } from '../../src/engine/pattern';
import { buildAll, buildLimitMs, notInRelease, readFixedDays, slowPictures, toPicture } from '../content/build';
import { type Card, listCards, readCard, releasable } from '../content/cards';
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
    'bad-stock.yaml': /stock: false — только true/,
    'bad-day.yaml': /day «02-30»/,
    'about-one-source.yaml': /два открытых источника/,
    'bad-grid.yaml': /pattern\.grid «median»/,
    'bad-chroma.yaml': /pattern\.chroma 2/,
    'bad-min-delta.yaml': /pattern\.min_delta 0\.03: 0\.045…0\.08 — не ниже порога размера по стороне сетки 70/,
    'bad-was.yaml': /was\.2: прежняя версия/,
    'bad-canvas-holes.yaml': /pattern\.canvas_seed 0\.1: .*только у схемы.*pattern\.canvas_holes 6: /,
    'bad-eyes.yaml': /pattern\.eyes \[\[0\.5,0\.5,0\.4,0\.6\]\]: до восьми рамок/,
    'bad-focus.yaml': /pattern\.focus \[\[0\.3,0\.2,0\.5,0\.4\]\]: до двенадцати рамок/,
    'bad-lines.yaml': /pattern\.lines \[\[0\.3,0\.2,0\.5,0\.4\]\]: до шестнадцати рамок/,
  };
  for (const f of readdirSync(dir)) {
    test(`испорченная карточка ${f} не проходит`, () => {
      const { card, errors } = readCard(join(dir, f));
      expect(card).toBeNull();
      expect(errors.join('; ')).toMatch(expected[f]);
    });
  }

  test('«в запас» с «да» — не во встроенный набор выпуска, а в наборы недели (17.10.2026, issue 86)', () => {
    const card = { id: 'x', approved: '2026-10-17', stock: true } as Card;
    expect(notInRelease(card)).toBe('в запас: в наборы недели после выхода, не в 1.0');
    expect(notInRelease(card, true)).toBeNull();
    expect(notInRelease({ ...card, stock: undefined })).toBeNull();
    expect(notInRelease({ ...card, approved: undefined })).toBe('нет «да» владельца (approved)');
  });

  test('музейный предмет без лицензии и без «да» владельца — не в выпуск', () => {
    const c = { approved: '2026-10-01', museum: 'ru', license: null } as unknown as Parameters<typeof releasable>[0];
    expect(releasable(c)).toContain('В12');
    expect(releasable({ ...c, museum: 'abroad' })).toBeNull();
    expect(releasable({ ...c, approved: undefined })).toContain('approved');
  });
});

describe('бесплатные картинки (docs/08-game-design.md, «Библиотека и коллекции»)', () => {
  test('в каждой коллекции выпуска без подписки открыты первые пять, а если их меньше — все', () => {
    // какие пять — решает владелец: order 0–4 в карточке (docs/09-content.md, §3)
    const cards = listCards().map((f) => readCard(f).card).filter((c): c is Card => c !== null && !releasable(c) && !c.hidden);
    const nobody: AccessContext = {
      today: '2026-10-11', seen: '2026-10-11', installed: '2026-10-11',
      dailyFrom: () => undefined, plus: false, hasWork: () => false,
    };
    const short = COLLECTIONS.flatMap((col) => {
      const list = cards.filter((c) => c.collection === col);
      const free = list.filter((c) => access(toPicture(c, 'M', '2026-09-28', null), nobody) === 'free');
      return free.length < Math.min(FREE_FIRST, list.length) ? [`${col}: ${free.length} из ${list.length}`] : [];
    });
    expect(short).toEqual([]);
  });
});

describe('рассказ о картине (docs/09-content.md, §7)', () => {
  test('у живописи, сказок и снимков Прокудина-Горского в выпуске — рассказ', () => {
    // источники и длину проверяет сама карточка (readCard): здесь — что рассказ есть
    const cards = listCards().map((f) => readCard(f).card).filter((c): c is Card => c !== null && !releasable(c) && !c.hidden);
    const silent = cards.filter((c) => ['painting', 'tales', 'russia'].includes(c.collection) && !c.about).map((c) => c.id);
    expect(silent).toEqual([]);
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
    const { built, previous } = await once();
    // прежние версии узоров (`was` в карточке) — в наборе для начатых работ: сверяются так же
    for (const [key, sha] of Object.entries(released)) {
      const b = [...built, ...previous].find((x) => x.pattern.key === key);
      expect(b ? patternDigest(b.pattern) : `узора ${key} нет`).toBe(sha);
    }
  }, 300_000);

  test('узоры выпуска закреплены: у каждой картинки с «да» — строка в released.json', async () => {
    const released = JSON.parse(readFileSync(join(FIX, 'released.json'), 'utf8')).patterns as Record<string, string>;
    const { built } = await once();
    // с «да» узор уходит в APK по тегу версии, и на нём начинают работы; закрепляет его тот же PR:
    // bun tools/content/week.ts --base --freeze (docs/05-process.md, «Выкладывание наборов»)
    // картинки «в запас» с «да» в APK не идут: их узоры закрепляет PR набора недели (issue 86)
    const loose = built.filter((b) => !b.trial && !b.card.stock && released[b.pattern.key] === undefined).map((b) => b.pattern.key);
    expect(loose).toEqual([]);
  }, 300_000);

  test('прежние версии узоров — в наборе скрытыми, после всех картинок; библиотека показывает нынешние', async () => {
    // начатая на прежней версии работа открывается по своему ключу (ADR 0010), а библиотека,
    // календарь и поиск картинки по id видят только нынешнюю версию
    const { built, previous, bytes, calendar } = await once();
    expect(previous.length).toBeGreaterThan(0);
    const pack = openPack(bytes);
    const keys = pack.json.pictures.map(patternKey);
    expect(keys.slice(built.length)).toEqual(previous.map((p) => p.pattern.key));
    const lib = libraryIndex([pack]);
    for (const p of previous) {
      expect(p.picture.hidden).toBe(true);
      expect(lib.byKey.has(p.pattern.key)).toBe(true);
      expect(lib.latest.find((x) => x.id === p.picture.id)!.v).toBeGreaterThan(p.picture.v);
      expect(pack.json.pictures.find((x) => x.id === p.picture.id)!.v).toBeGreaterThan(p.picture.v);
    }
    // закреплённые дни — как были, даже если картинку дня потом скрыли («нет» владельца 24.10.2026):
    // телефон даёт такому дню запасную картинку (src/engine/calendar.ts); остальные дни — только нынешние картинки
    const fixed = new Set(readFixedDays(calendar[0].date).map((d) => d.date));
    expect(calendar.filter((d) => !fixed.has(d.date) && !built.some((b) => b.picture.id === d.picture && !b.picture.hidden))).toEqual([]);
  }, 300_000);
});

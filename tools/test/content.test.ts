// Сборка картинок (docs/06-testing.md, «Картинки»): проверки ловят испорченные карточки,
// сборка детерминирована до байта, выпущенные узоры не меняются (ADR 0010).
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { access, type AccessContext } from '../../src/engine/access';
import { COLLECTIONS, FREE_FIRST, patternKey } from '../../src/engine/library';
import { libraryIndex, openPack } from '../../src/engine/pack';
import type { SizeClass } from '../../src/engine/pattern';
import { buildAll, type Built, buildCard, buildLimitMs, notInRelease, packVersions, readFixedDays, slowPictures, toPicture } from '../content/build';
import { type Card, CONTENT, listCards, patternSpec, readCard, releasable, releasableAt } from '../content/cards';
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
    'bad-px.yaml': /pattern\.px 4: целое 2…8, не у схемы и не со smooth: 2/,
    'bad-main.yaml': /pattern\.main \[0\.6,0\.2,0\.4,0\.8\]: рамка овала.*pattern\.background «round»: one или none/,
    'bad-smooth.yaml': /pattern\.smooth 1: 0, 1 или 2, не у схемы и не вместе с simplify/,
    'bad-soft.yaml': /pattern\.soft 0\.5: true или false, и не у схемы/,
    'bad-tone.yaml': /pattern\.tone 1\.5: 0 или 0,1…1, и не у схемы/,
    'bad-approved-v.yaml': /approved_v 1: версия с «да» — прежняя, из was, и только вместе с approved/,
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

  test('повторный отбор (approved_v): нынешняя версия ждёт «да», прежние с «да» — в выпуск скрытыми (ADR 0010)', () => {
    const card = { id: 'x', v: 3, approved: '2026-10-03', approved_v: 2, was: { 1: {}, 2: {} } } as unknown as Card;
    expect(releasable(card)).toBe('версия 3 — на отборе: «да» у версии 2');
    expect([releasableAt(card, 2), releasableAt(card, 1)]).toEqual([null, null]);
    expect(packVersions(card, { release: true })).toEqual({ out: 'версия 3 — на отборе: «да» у версии 2', olds: [1, 2] });
    // версия 2 — тоже на отборе, «да» — только у первой: вторая в выпуск не идёт
    expect(packVersions({ ...card, approved_v: 1 } as Card, { release: true })).toEqual({ out: 'версия 3 — на отборе: «да» у версии 1', olds: [1] });
    // сборка для проверки — все версии; без «да» в выпуск — ни одной; с «да» у нынешней — все
    expect(packVersions(card)).toEqual({ out: null, olds: [1, 2] });
    expect(packVersions({ ...card, approved: undefined, approved_v: undefined } as Card, { release: true })).toEqual({ out: 'нет «да» владельца (approved)', olds: [] });
    expect(packVersions({ ...card, approved_v: undefined } as Card, { release: true })).toEqual({ out: null, olds: [1, 2] });
    // запас и музейный предмет без лицензии — ни одной версии в выпуск
    expect(packVersions({ ...card, stock: true } as Card, { release: true }).olds).toEqual([]);
    expect(packVersions({ ...card, museum: 'ru', license: null } as unknown as Card, { release: true }).olds).toEqual([]);
  });

  test('новые поля — у новой версии, прежняя выключает их в was (smooth 0, soft false, tone 0): её узор — тот же до байта (ADR 0010)', async () => {
    // так пересобирается картинка с «нет» (issue 121); без полей в was прежняя версия унаследовала бы их от нынешней.
    // Узор — свой, из исходника «Бегонии»: тест не зависит от того, как собрана сама карточка
    const { card } = readCard(join(CONTENT, 'nature', 'begoniya.yaml'));
    const old = { ...card!, v: 1, pattern: { size: 70, threads: 20, grid: 'dominant', chroma: 1.15 }, was: undefined, approved_v: undefined, hidden: undefined } as Card;
    const next = { ...old, v: 2, pattern: { ...old.pattern!, smooth: 1, soft: true, tone: 0.6 }, was: { 1: { smooth: 0, soft: false, tone: 0 } }, approved_v: 1 } as Card;
    const dir = join(mkdtempSync(join(tmpdir(), 'uzory-was-')), 'nature');
    mkdirSync(dir);
    const { path: _path, dir: _dir, ...yaml } = next;
    writeFileSync(join(dir, 'begoniya.yaml'), stringify(yaml));
    expect(readCard(join(dir, 'begoniya.yaml')).errors).toEqual([]);
    expect(patternDigest((await buildCard(next, 1)).pattern)).toBe(patternDigest((await buildCard(old)).pattern));
    expect(patternDigest((await buildCard(next)).pattern)).not.toBe(patternDigest((await buildCard(old)).pattern));
    // без выключения прежняя версия унаследовала бы новые поля — и узор начатых работ изменился бы
    expect(patternDigest((await buildCard({ ...next, was: { 1: {} } } as Card, 1)).pattern)).not.toBe(patternDigest((await buildCard(old)).pattern));
  }, 60_000);

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

/**
 * Выборка для «двух сборок подряд»: по самой маленькой картинке на каждое сочетание коллекции, вида исходника
 * (рисунок; старинная схема — без бумаги, на бумаге, на пожелтевшей; снимок — сетка по среднему или
 * преобладающему цвету), приёмов сборки (сглаживание или упрощение и его сила, мягкое небо, точные краски,
 * насыщенность и тон, лица, глаза и кресты, свой порог слияния нитей) и версии (нынешняя или прежняя из `was`):
 * так проверка проходит по каждой ветке сборщика за секунды, а не минуты.
 */
function buildSample(list: Built[]): Built[] {
  const pick = new Map<string, Built>();
  for (const b of list) {
    const v = Number(b.pattern.key.split('@')[1]);
    const p = b.card.drawn ? null : patternSpec(b.card, v);
    const source = b.card.drawn ? 'drawn' : p?.chart ? `chart${p.canvas ? (p.white_paper ? ':white' : ':paper') : ''}` : `photo:${p?.grid ?? 'mean'}`;
    const kind = [
      b.card.collection, source, p?.smooth ? `smooth${p.smooth}` : `simplify${p?.simplify ?? 0}`, p?.soft ? 'soft' : '', p?.exact ? 'exact' : '',
      p?.chroma !== undefined ? 'chroma' : '', p?.px !== undefined ? 'px' : '', p?.main ? `main:${p.background ?? 'keep'}` : '', p?.tone !== undefined ? 'tone' : '', p?.focus?.length ? 'focus' : '',
      p?.eyes?.length || p?.lines?.length ? 'eyes' : '', p?.min_delta !== undefined ? 'delta' : '', v === b.card.v ? '' : 'was',
    ].join('|');
    const cur = pick.get(kind);
    if (!cur || b.pattern.w * b.pattern.h < cur.pattern.w * cur.pattern.h) pick.set(kind, b);
  }
  return [...pick.values()];
}

describe('сборка', () => {
  // полная сборка идёт минуты (картины в четыре клетки на сантиметр, старинные схемы, с 0.16.3 — крупные
  // пересобранные картинки: 414 картинок и 336 прежних версий — около семи минут у ассистента, 31.10.2026).
  // Она общая для всех тестов ниже и идёт через кэш узоров (tools/content/cache.ts): в CI его только что
  // наполнил шаг «Картинки», и здесь она занимает секунды; предел — с запасом, если кэша нет
  let first: ReturnType<typeof buildAll> | null = null;
  const once = () => (first ??= buildAll());

  // Детерминизм и верность кэша: узоры набора — те же, что свежая сборка без кэша. Целиком — когда в PR
  // поменялся код сборки (UZORY_FULL_BUILD_CHECK=1 ставит .github/workflows/pr.yml: `bun tools/content/cache.ts
  // --touches`), около семи минут; иначе — выборка по всем веткам сборщика (вопрос владельца 31.10.2026:
  // две полные сборки здесь занимали 13 из 21,5 минуты проверки PR)
  test('две сборки подряд — один и тот же набор до байта', async () => {
    const a = await once();
    expect(a.failed).toEqual([]);
    if (process.env.UZORY_FULL_BUILD_CHECK === '1') {
      const b = await buildAll({ cache: false });
      expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
      return;
    }
    const sample = buildSample([...a.built, ...a.previous]);
    expect(sample.length).toBeGreaterThan(10);
    for (const b of sample) {
      const fresh = await buildCard(b.card, Number(b.pattern.key.split('@')[1]));
      expect([b.pattern.key, patternDigest(fresh.pattern)]).toEqual([b.pattern.key, patternDigest(b.pattern)]);
    }
  }, 1_800_000);

  test('выпущенные узоры не изменились (tools/test/fixtures/released.json)', async () => {
    const released = JSON.parse(readFileSync(join(FIX, 'released.json'), 'utf8')).patterns as Record<string, string>;
    const { built, previous } = await once();
    // прежние версии узоров (`was` в карточке) — в наборе для начатых работ: сверяются так же
    for (const [key, sha] of Object.entries(released)) {
      const b = [...built, ...previous].find((x) => x.pattern.key === key);
      expect(b ? patternDigest(b.pattern) : `узора ${key} нет`).toBe(sha);
    }
  }, 900_000);

  test('узоры выпуска закреплены: у каждой картинки с «да» — строка в released.json', async () => {
    const released = JSON.parse(readFileSync(join(FIX, 'released.json'), 'utf8')).patterns as Record<string, string>;
    const { built } = await once();
    // с «да» узор уходит в APK по тегу версии, и на нём начинают работы; закрепляет его тот же PR:
    // bun tools/content/week.ts --base --freeze (docs/05-process.md, «Выкладывание наборов»)
    // картинки «в запас» с «да» в APK не идут: их узоры закрепляет PR набора недели (issue 86)
    const loose = built.filter((b) => !b.trial && !b.card.stock && released[b.pattern.key] === undefined).map((b) => b.pattern.key);
    expect(loose).toEqual([]);
  }, 900_000);

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
    // пересобранные — ровно картинки с прежними версиями: фильтр «На отборе» в «Листе узоров» (0.21.1)
    expect([...lib.rebuilt].sort()).toEqual([...new Set(previous.map((p) => p.picture.id))].sort());
    // закреплённые дни — как были, даже если картинку дня потом скрыли («нет» владельца 24.10.2026):
    // телефон даёт такому дню запасную картинку (src/engine/calendar.ts); остальные дни — только нынешние картинки
    const fixed = new Set(readFixedDays(calendar[0].date).map((d) => d.date));
    expect(calendar.filter((d) => !fixed.has(d.date) && !built.some((b) => b.picture.id === d.picture && !b.picture.hidden))).toEqual([]);
  }, 900_000);
});

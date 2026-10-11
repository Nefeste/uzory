// Карточка магазина (store/README.md): длины полей RuStore, чужие названия, файлы графики.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { CollectionId } from '../../src/engine/library';
import { readTracks } from '../audio/tracks';
import { listCards, readCard, releasable } from '../content/cards';

const STORE = join(import.meta.dir, '..', '..', 'store');
const read = (f: string) => readFileSync(join(STORE, f), 'utf8');

/** Разделы «## Заголовок» → текст раздела без пустых строк по краям. */
function sections(md: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = md.split(/^## /m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf('\n');
    out.set(p.slice(0, nl).trim(), p.slice(nl + 1).trim());
  }
  return out;
}

const field = (s: Map<string, string>, prefix: string) => {
  const key = [...s.keys()].find((k) => k.startsWith(prefix));
  if (!key) throw new Error(`нет раздела «${prefix}»`);
  return s.get(key)!;
};

/**
 * Чужие названия — ни в одном тексте магазина и сайта (docs/10-money.md, «Название и право»);
 * картины из российских музеев по именам — пока не решён В12 (docs/09-content.md, §2).
 */
const FORBIDDEN = [
  /happy\s*color/i, /pixel\s*art/i, /paint by number/i, /риолис/i, /золотое руно/i, /раскрашка/i,
  /шишкин/i, /левитан/i, /айвазовск/i, /саврасов/i, /куинджи/i, /поленов/i, /кустодиев/i, /васнецов/i,
  /третьяков/i, /русский музей/i,
];
const TEXTS = ['listing.ru.md', 'listing.en.md', 'faq.ru.md', 'closed-test.md', 'site/page.ru.md', 'site/page.en.md'];

describe('карточка RuStore', () => {
  for (const [file, name, short] of [['listing.ru.md', 'Название', 'Краткое'], ['listing.en.md', 'Title', 'Short']] as const) {
    test(`${file}: длины полей`, () => {
      const s = sections(read(file));
      expect(field(s, name).length).toBeLessThanOrEqual(30);
      expect(field(s, short).length).toBeLessThanOrEqual(80);
      const full = field(s, file.endsWith('ru.md') ? 'Полное' : 'Full');
      expect(full.length).toBeGreaterThan(500);
      expect(full.length).toBeLessThanOrEqual(4000);
    });
  }

  test('частые вопросы: вопрос до 100 знаков, ответ до 500', () => {
    const s = sections(read('faq.ru.md'));
    expect(s.size).toBeGreaterThanOrEqual(6);
    for (const [q, a] of s) {
      expect(q.length).toBeLessThanOrEqual(100);
      expect(a.length).toBeLessThanOrEqual(500);
    }
  });

  test('ни чужих названий, ни картин из российских музеев', () => {
    const bad: string[] = [];
    for (const f of TEXTS) for (const r of FORBIDDEN) if (r.test(read(f))) bad.push(`${f}: ${r}`);
    expect(bad).toEqual([]);
  });
});

/**
 * Обещания — по выпуску (docs/specs/2026-09-v1.md, «Карточка RuStore»: ни одного обещания, которого нет
 * в игре). Тексты магазина и сайта, памятка тестировщику (у них APK выпуска) и надписи баннера не называют
 * коллекцию, в которой нет ни одной картинки с «да» владельца и правами, и музыку, пока ни у одной пьесы
 * нет «да» (В6). Появятся в выпуске — их можно вписать.
 */
describe('обещания — по выпуску', () => {
  const NAMED: Record<CollectionId, RegExp> = {
    ornaments: /орнамент|ornament/i,
    painting: /живопис|painting/i,
    tales: /(?<![а-яё])сказк|fairy|\btales?\b/i, // не «подсказки»
    russia: /росси\S* в цвете|russia in colou?r/i,
    flowers: /цветы|flowers/i,
    nature: /природ|\bnature\b/i, // не «signature»
    cities: /города|cities/i,
    kids: /детям|для детей|for kids/i,
    schemes: /старинн\S* схем|old charts/i,
  };
  // правила в начале карточек и частых вопросов — для нас, не для игроков
  const body = (f: string) => read(f).slice(Math.max(0, read(f).indexOf('\n## ')));
  const banner = /const TEXT = \{[\s\S]*?\n\}(?: as const)?;/.exec(readFileSync(join(STORE, '..', 'tools', 'store', 'graphics.ts'), 'utf8'))?.[0] ?? '';
  const texts: [string, string][] = [
    ...['listing.ru.md', 'listing.en.md', 'faq.ru.md'].map((f): [string, string] => [f, body(f)]),
    ...['closed-test.md', 'site/page.ru.md', 'site/page.en.md'].map((f): [string, string] => [f, read(f)]),
    ['баннер (tools/store/graphics.ts)', banner],
  ];

  test('надписи баннера найдены', () => {
    expect(banner).toContain('Вышивка крестиком по номерам');
  });

  test('коллекции без картинок в выпуске не названы', () => {
    const released = new Set<string>();
    for (const f of listCards()) {
      const { card } = readCard(f);
      if (card && releasable(card) === null) released.add(card.collection);
    }
    expect(released.size).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const [id, named] of Object.entries(NAMED)) {
      if (released.has(id)) continue;
      for (const [f, text] of texts) if (named.test(text)) bad.push(`${f}: ${id} — в выпуске ни одной картинки`);
    }
    expect(bad).toEqual([]);
  });

  test('музыка — только когда у пьес есть «да» владельца (В6)', () => {
    if (readTracks().some((t) => t.approved)) return;
    expect(texts.filter(([, text]) => /музык|music/i.test(text)).map(([f]) => f)).toEqual([]);
  });
});

describe('графика', () => {
  test('иконка 512 × 512, баннеры 1024 × 500', async () => {
    const icon = await sharp(join(STORE, 'graphics', 'icon-512.png')).metadata();
    expect([icon.width, icon.height]).toEqual([512, 512]);
    for (const l of ['ru', 'en']) {
      const f = await sharp(join(STORE, 'graphics', `feature-${l}.png`)).metadata();
      expect([f.width, f.height]).toEqual([1024, 500]);
    }
  });

  test('снимки экрана 1080 × 1920, не меньше четырёх; на сайте — те, что названы в store/site/page.*.md', async () => {
    const dir = join(STORE, 'screenshots', 'ru');
    const shots = readdirSync(dir).filter((f) => f.endsWith('.png'));
    expect(shots.length).toBeGreaterThanOrEqual(4);
    for (const f of shots) {
      const m = await sharp(join(dir, f)).metadata();
      expect([f, m.width, m.height]).toEqual([f, 1080, 1920]);
    }
    for (const f of ['site/page.ru.md', 'site/page.en.md']) {
      for (const m of read(f).matchAll(/file: screenshots\/ru\/(\S+\.png)/g)) expect([f, shots]).toEqual([f, expect.arrayContaining([m[1]])]);
    }
  });
});

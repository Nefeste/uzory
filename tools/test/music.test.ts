// Музыка (assets/music, docs/09-content.md, «Звук и музыка»; docs/08-game-design.md): у каждой
// пьесы — лицензия записи, которую можно выпускать (PD, CC0, CC BY), и страница, где это сказано;
// файл — WebM с Opus, моно; все вместе — в бюджете 10 МБ; в сборку выпуска — только с «да»
// владельца. Круг — все пьесы по разу, без повтора на стыке; нарастание — от тишины.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fadeLevel, shuffleRound } from '../../src/engine/music';
import { rng } from '../../src/engine/seed';
import { MUSIC_DIR, MUSIC_MAX_BYTES, musicModule, readTracks, trackFile, type TrackEntry } from '../audio/tracks';

const tracks = readTracks();

/** Минимальный разбор WebM: заголовок EBML, тип «webm», кодек Opus и число каналов из OpusHead. */
function webm(file: string) {
  const b = readFileSync(file);
  const head = b.indexOf('OpusHead');
  return {
    ebml: b.subarray(0, 4).toString('hex'),
    webm: b.indexOf('webm') > 0 && b.indexOf('webm') < 64,
    opus: b.indexOf('A_OPUS') > 0,
    channels: head > 0 ? b[head + 9] : 0,
  };
}

describe('пьесы', () => {
  test('5–8 пьес, у каждой — лицензия записи, которую можно выпускать, и страница Викисклада', () => {
    expect(tracks.length).toBeGreaterThanOrEqual(5);
    expect(tracks.length).toBeLessThanOrEqual(8);
    for (const t of tracks) {
      expect(t.license).toMatch(/^(PD|CC0|CC BY [1-4]\.0)$/);
      expect(t.page).toStartWith('https://commons.wikimedia.org/wiki/File:');
    }
  });

  test('файл каждой пьесы — WebM с Opus, моно; других файлов в папке нет', () => {
    const files = readdirSync(MUSIC_DIR).filter((f) => f !== 'music.yaml').sort();
    expect(files).toEqual(tracks.map((t) => `${t.id}.webm`).sort());
    for (const t of tracks) expect({ id: t.id, ...webm(trackFile(t.id)) }).toEqual({ id: t.id, ebml: '1a45dfa3', webm: true, opus: true, channels: 1 });
  });

  test('вся музыка — не больше 10 МБ, пьеса — от 300 КБ до 4 МБ', () => {
    const sizes = tracks.map((t) => statSync(trackFile(t.id)).size);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(MUSIC_MAX_BYTES);
    for (const s of sizes) {
      expect(s).toBeGreaterThan(300 * 1024);
      expect(s).toBeLessThan(4 * 1024 * 1024);
    }
  });

  test('модуль для приложения: в сборке для проверки — все, в сборке выпуска — только с «да»', () => {
    const all = musicModule(tracks, false);
    for (const t of tracks) expect(all).toContain(`require('../../../assets/music/${t.id}.webm')`);
    const some: TrackEntry[] = tracks.map((t, i) => ({ ...t, approved: i === 1 }));
    const release = musicModule(some, true);
    expect(release).toContain(`assets/music/${tracks[1].id}.webm`);
    expect(release).not.toContain(`assets/music/${tracks[0].id}.webm`);
    expect(musicModule(tracks.map((t) => ({ ...t, approved: false })), true)).toContain('export const TRACKS: Track[] = [];');
  });

  test('чужая лицензия, NC и битые поля — ошибка сборки', () => {
    const dir = mkdtempSync(join(tmpdir(), 'uzory-music-'));
    const bad = (patch: Record<string, unknown>) => {
      const f = join(dir, 'music.yaml');
      const t = { ...tracks[0], ...patch };
      writeFileSync(f, `tracks:\n${Object.entries(t).map(([k, v], i) => `${i ? '    ' : '  - '}${k}: ${JSON.stringify(v)}`).join('\n')}\n`);
      return () => readTracks(f);
    };
    expect(bad({})).not.toThrow();
    expect(bad({ license: 'CC BY-NC 4.0' })).toThrow(/лицензия/);
    expect(bad({ license: 'CC BY-SA 4.0' })).toThrow(/лицензия/);
    expect(bad({ page: 'https://example.com/a.ogg' })).toThrow(/page/);
    expect(bad({ download: 'https://example.com/a.ogg' })).toThrow(/download/);
    expect(bad({ id: 'Bad Id' })).toThrow(/id/);
    expect(bad({ approved: 'да' })).toThrow(/approved/);
  });
});

describe('круг и нарастание', () => {
  test('круг — все пьесы по разу; первая нового круга — не последняя прошлого', () => {
    const rand = rng(7);
    let last: number | null = null;
    for (let i = 0; i < 200; i++) {
      const r = shuffleRound(5, rand, last);
      expect([...r].sort()).toEqual([0, 1, 2, 3, 4]);
      if (last !== null) expect(r[0]).not.toBe(last);
      last = r[4];
    }
    expect(shuffleRound(1, rand, 0)).toEqual([0]);
    expect(shuffleRound(0, rand)).toEqual([]);
  });

  test('порядок случайный: за много кругов каждая пьеса бывает первой', () => {
    const rand = rng(11);
    const firsts = new Set<number>();
    for (let i = 0; i < 100; i++) firsts.add(shuffleRound(5, rand)[0]);
    expect(firsts.size).toBe(5);
  });

  test('нарастание: от тишины, первые секунды почти тихо, к концу — вся громкость', () => {
    expect(fadeLevel(0, 5000, 0, 0.5)).toBe(0);
    expect(fadeLevel(1000, 5000, 0, 0.5)).toBeCloseTo(0.02, 5);
    expect(fadeLevel(2500, 5000, 0, 0.5)).toBeLessThan(0.25);
    expect(fadeLevel(5000, 5000, 0, 0.5)).toBe(0.5);
    expect(fadeLevel(9000, 5000, 0, 0.5)).toBe(0.5);
    let prev = -1;
    for (let t = 0; t <= 5000; t += 100) {
      const v = fadeLevel(t, 5000, 0, 0.5);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // затихание — вниз до нуля
    expect(fadeLevel(400, 800, 0.5, 0)).toBeLessThan(0.25);
    expect(fadeLevel(800, 800, 0.5, 0)).toBe(0);
  });
});

describe('музыка в игре', () => {
  const src = (p: string) => readFileSync(join(import.meta.dir, '..', '..', 'src', p), 'utf8');

  test('звучит только на экране вышивания: вход, уход и первый стежок — там', () => {
    const stitch = src('screens/StitchScreen.tsx');
    for (const f of ['musicEnter()', 'return musicLeave;', 'musicStitch()', 'musicStart()', 'musicEnabled(']) expect(stitch).toContain(f);
    for (const screen of readdirSync(join(import.meta.dir, '..', '..', 'src', 'screens'))) {
      if (screen === 'StitchScreen.tsx') continue;
      expect({ screen, starts: /musicStitch|musicStart|musicEnter/.test(src(`screens/${screen}`)) }).toEqual({ screen, starts: false });
    }
  });

  test('тихо: громкость пьесы — половина, нарастание — пять секунд', () => {
    const m = src('state/music.ts');
    expect(m).toContain('MUSIC_VOLUME = 0.5');
    expect(m).toContain('FADE_IN_MS = 5000');
  });
});

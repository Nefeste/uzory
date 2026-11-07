// «Меньше движения» — правило 6 ADR 0023 устава (docs/02-architecture.md, «Графика (ADR 0023 устава)»).
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { lessMotion, motionMode } from '../../src/state/motion';

const ROOT = join(import.meta.dir, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
});

describe('меньше движения', () => {
  test('пока игрок не выбрал — как в системе; выбрал — его выбор', () => {
    expect(lessMotion(null, false)).toBe(false);
    expect(lessMotion(null, true)).toBe(true);
    expect(lessMotion(true, false)).toBe(true);
    expect(lessMotion(false, true)).toBe(false);
    expect([motionMode(null), motionMode(true), motionMode(false)]).toEqual(['system', 'always', 'never']);
  });

  test('сразу после установки настройка не выбрана', () => {
    expect(read('src/state/settings.tsx')).toMatch(/lessMotion: null/);
  });

  test('настройка стоит на экране настроек и на всём движении Reanimated', () => {
    expect(read('src/screens/SettingsScreen.tsx')).toContain('testID="set-less-motion"');
    const app = read('App.tsx');
    expect(app).toMatch(/<ReducedMotionConfig mode=\{MOTION\[motionMode\(settings\.lessMotion\)\]\}/);
    expect(app).toMatch(/<SettingsProvider>\s*<Motion \/>/);
  });

  test('взмах канвы по инерции меньшее движение не останавливает', () => {
    const bad = files(join(ROOT, 'src')).flatMap((p) => readFileSync(p, 'utf8').split('\n')
      .map((line, i) => ({ line, at: `${relative(ROOT, p)}:${i + 1}` }))
      .filter(({ line }) => line.includes('withDecay({') && !line.includes('reduceMotion: FLING'))
      .map(({ at }) => at));
    expect(bad).toEqual([]);
  });
});

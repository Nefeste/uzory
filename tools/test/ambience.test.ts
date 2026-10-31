// Фон вышивания (assets/ambience, docs/08-game-design.md, «Звук и музыка»): петли синтезированы кодом
// (tools/audio/ambience.ts), игра берёт их все, у каждой — строка в LICENSES.md; петля без шва; дождь и
// печь — одной громкости, без перегрузки; синтез воспроизводим.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AMBIENCE, LOOP_SEC } from '../audio/ambience';
import { RATE } from '../audio/gen';

const ROOT = join(import.meta.dir, '..', '..');
const DIR = join(ROOT, 'assets', 'ambience');
const made = Object.fromEntries(Object.entries(AMBIENCE).map(([id, make]) => [id, make()]));

describe('фон вышивания', () => {
  test('файлы — те, что синтезирует генератор; все — в игре и в LICENSES.md', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.webm')).sort();
    expect(files).toEqual(Object.keys(AMBIENCE).map((id) => `${id}.webm`).sort());
    const src = readFileSync(join(ROOT, 'src', 'state', 'ambience.ts'), 'utf8');
    const licenses = readFileSync(join(DIR, 'LICENSES.md'), 'utf8');
    for (const f of files) {
      expect(src).toContain(`assets/ambience/${f}`);
      expect(licenses).toContain('| `' + f + '` |');
    }
  });

  test('петля ровно 60 с и без шва: конец переходит в начало обычным шагом', () => {
    for (const [id, x] of Object.entries(made)) {
      expect(x.length, id).toBe(Math.round(LOOP_SEC * RATE));
      let max = 0;
      for (let i = 1; i < x.length; i++) max = Math.max(max, Math.abs(x[i] - x[i - 1]));
      expect(Math.abs(x[0] - x[x.length - 1]), id).toBeLessThanOrEqual(max);
    }
  });

  test('дождь и печь — одной средней громкости, пики ниже полной шкалы', () => {
    const db = (x: Float32Array) => 10 * Math.log10(x.reduce((s, v) => s + v * v, 0) / x.length);
    const levels = Object.values(made).map(db);
    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThan(0.5);
    for (const x of Object.values(made)) expect(x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeLessThan(0.95);
  });

  test('синтез воспроизводим: второй раз — те же отсчёты', () => {
    for (const [id, make] of Object.entries(AMBIENCE)) expect(Buffer.from(make().buffer).equals(Buffer.from(made[id].buffer)), id).toBe(true);
  });
});

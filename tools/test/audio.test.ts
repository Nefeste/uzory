// Звуки (assets/audio, docs/09-content.md, «Звук и музыка»): каждый файл — WAV моно 16 бит
// 22 050 Гц без перегрузки, со строкой в LICENSES.md; файлы — ровно то, что пишет генератор
// (tools/audio/gen.ts), и игра берёт их все.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RATE, SOUNDS, wav } from '../audio/gen';

const DIR = join(import.meta.dir, '..', '..', 'assets', 'audio');

function read(name: string) {
  const b = readFileSync(join(DIR, name));
  const header = {
    riff: b.toString('ascii', 0, 4), wave: b.toString('ascii', 8, 12), pcm: b.readUInt16LE(20),
    channels: b.readUInt16LE(22), rate: b.readUInt32LE(24), bits: b.readUInt16LE(34), data: b.toString('ascii', 36, 40),
  };
  const n = (b.length - 44) >> 1;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(44 + i * 2) / 32768;
  return { b, header, x };
}

const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('звуки', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.wav')).sort();
  const licenses = readFileSync(join(DIR, 'LICENSES.md'), 'utf8');

  test('каждый файл — WAV моно 16 бит 22 050 Гц, без перегрузки, со строкой в LICENSES.md', () => {
    expect(files).toEqual(Object.keys(SOUNDS).sort());
    for (const f of files) {
      const { header, x } = read(f);
      expect({ f, ...header }).toEqual({ f, riff: 'RIFF', wave: 'WAVE', pcm: 1, channels: 1, rate: RATE, bits: 16, data: 'data' });
      expect(peak(x)).toBeLessThan(0.99);
      expect(peak(x)).toBeGreaterThan(0.2);
      expect(licenses).toContain('| `' + f + '` |');
    }
  });

  test('файлы — ровно то, что пишет генератор: пересобираются до байта', () => {
    for (const [f, make] of Object.entries(SOUNDS)) expect(wav(make()).equals(read(f).b)).toBe(true);
  });

  test('стежок короткий: при кисти он звучит до 20 раз в секунду', () => {
    const { x } = read('stitch.wav');
    expect(x.length / RATE).toBeLessThan(0.1);
    // и почти весь — в первые 50 мс
    const early = x.slice(0, Math.round(0.05 * RATE)).reduce((s, v) => s + v * v, 0);
    const all = x.reduce((s, v) => s + v * v, 0);
    expect(early / all).toBeGreaterThan(0.9);
  });

  test('игра берёт все звуки из assets/audio', () => {
    const src = readFileSync(join(import.meta.dir, '..', '..', 'src', 'state', 'sound.ts'), 'utf8');
    for (const f of files) expect(src).toContain(`assets/audio/${f}`);
  });
});

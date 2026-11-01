// Звуки (assets/audio, docs/09-content.md, «Звук и музыка»): каждый файл — WAV моно 16 бит
// 22 050 Гц без перегрузки, со строкой в LICENSES.md; файлы — ровно то, что пишет генератор
// (tools/audio/gen.ts), и игра берёт их все.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRUSH_SOFT, BRUSH_SOFT_MS, newTicks, STITCH_GAP, STITCH_SPREAD, stitchTick } from '../../src/engine/tick';
import { makeStitch, pitched, RATE, SOUNDS, STITCH_PITCH, wav } from '../audio/gen';

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

/** Центр спектра, Гц: по частотам до 6 кГц через 25 Гц. */
function centroid(x: Float32Array): number {
  let sum = 0, weighted = 0;
  for (let f = 25; f <= 6000; f += 25) {
    let a = 0, b = 0;
    for (let i = 0; i < x.length; i++) {
      const w = (2 * Math.PI * f * i) / RATE;
      a += x[i] * Math.cos(w);
      b -= x[i] * Math.sin(w);
    }
    sum += a * a + b * b;
    weighted += f * (a * a + b * b);
  }
  return weighted / sum;
}

/** Простое случайное 0…1 с зерном — проверка ритма не зависит от Math.random. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

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

  test('каждый стежок короткий: при кисти он звучит до 20 раз в секунду', () => {
    const stitches = files.filter((f) => f.startsWith('stitch'));
    expect(stitches.length).toBeGreaterThanOrEqual(4);
    for (const f of stitches) {
      const { x } = read(f);
      expect(x.length / RATE, f).toBeLessThan(0.1);
      // и почти весь — в первые 50 мс
      const early = x.slice(0, Math.round(0.05 * RATE)).reduce((s, v) => s + v * v, 0);
      const all = x.reduce((s, v) => s + v * v, 0);
      expect(early / all, f).toBeGreaterThan(0.9);
    }
  });

  test('стежки — один и тот же шорох 0.3.0 на шести высотах (владелец 01.11.2026: «разнообразить тот стежок»)', () => {
    // первый — прежний стежок до байта; остальные — он же, пересчитанный выше или ниже на 3–9 %
    expect(STITCH_PITCH[0]).toBe(1);
    expect(wav(makeStitch()).equals(read('stitch.wav').b)).toBe(true);
    const base = centroid(read('stitch.wav').x);
    STITCH_PITCH.forEach((k, i) => {
      if (!i) return;
      expect(Math.abs(k - 1)).toBeGreaterThanOrEqual(0.03);
      expect(Math.abs(k - 1)).toBeLessThanOrEqual(0.09 + 1e-9);
      const x = read(`stitch-${i + 1}.wav`).x;
      expect(wav(pitched(makeStitch(), k)).equals(read(`stitch-${i + 1}.wav`).b)).toBe(true);
      // тот же шорох: длина — ровно в k раз короче или длиннее, центр спектра — недалеко от прежнего
      expect((read('stitch.wav').x.length - 1) / x.length).toBeCloseTo(k, 2);
      expect(Math.abs(centroid(x) / base - 1)).toBeLessThan(0.15);
    });
  });

  test('кисть — неровная россыпь, а не машинка: 7–12 стежков в секунду через разные промежутки', () => {
    for (const seed of [1, 2, 3]) {
      const s = newTicks();
      const rnd = seeded(seed);
      const at: number[] = [];
      const loud: number[] = [];
      // канва зовёт стежок каждые 50 мс три секунды подряд
      for (let t = 1000; t < 4000; t += 50) {
        const k = stitchTick(s, t, rnd);
        if (k) {
          at.push(t);
          loud.push(k);
        }
      }
      expect(at.length).toBeGreaterThanOrEqual(21);
      expect(at.length).toBeLessThanOrEqual(36);
      const gaps = at.slice(1).map((t, i) => t - at[i]);
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(STITCH_GAP[0]);
      // промежутки разные: 100 и 150 мс вперемешку, а не ровный шаг
      expect(new Set(gaps).size).toBeGreaterThan(1);
      // первые стежки штриха — полной громкости (±20 %), долгая кисть — тише
      expect(loud[0]).toBeGreaterThanOrEqual(1 - STITCH_SPREAD);
      at.forEach((t, i) => {
        if (t - 1000 > BRUSH_SOFT_MS) expect(loud[i]).toBeLessThanOrEqual(BRUSH_SOFT * (1 + STITCH_SPREAD));
      });
    }
  });

  test('касание за касанием звучит каждое; после перерыва штрих снова громкий', () => {
    const s = newTicks();
    const rnd = seeded(7);
    for (let t = 0; t < 3000; t += 300) expect(stitchTick(s, t, rnd)).toBeGreaterThanOrEqual(1 - STITCH_SPREAD);
    // долгая кисть, перерыв полсекунды — и новый штрих начинается полной громкостью
    for (let t = 5000; t < 6000; t += 50) stitchTick(s, t, rnd);
    expect(stitchTick(s, 6500, rnd)).toBeGreaterThanOrEqual(1 - STITCH_SPREAD);
  });

  test('игра берёт все звуки из assets/audio', () => {
    const src = readFileSync(join(import.meta.dir, '..', '..', 'src', 'state', 'sound.ts'), 'utf8');
    for (const f of files) expect(src).toContain(`assets/audio/${f}`);
  });
});

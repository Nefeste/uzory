// Золотые кадры канвы (docs/06-testing.md, «Канва»): шейдер собирается, и цвет в центре
// каждой вышитой клетки — ровно цвет нити, во всех стилях и масштабах.
import { describe, expect, test } from 'bun:test';
import { labToLch, linear, linearToLab } from '../../src/engine/color';
import { CANVAS, type Pattern } from '../../src/engine/pattern';
import { rng } from '../../src/engine/seed';
import { SHARE_STITCHES_FROM } from '../../src/engine/share';
import { renderFrame } from '../canvas/ck';
import { stitchStyles } from '../e2e/share';
import { randomPattern } from './helpers';

const p = randomPattern(11, 24, 30, 32, 0.08);
const r = rng(12);
const stitched = Uint8Array.from(p.cells, () => (r() < 0.5 ? 1 : 0));

async function check(opts: { s: number; near: boolean; mosaic?: boolean }) {
  const tx = 3.5;
  const ty = 2.5;
  const width = Math.min(360, Math.ceil(p.w * opts.s + 8));
  const height = Math.min(640, Math.ceil(p.h * opts.s + 8));
  const f = await renderFrame(p, stitched, { width, height, tx, ty, selected: 3, ...opts });
  let ok = 0;
  const bad: string[] = [];
  for (let i = 0; i < p.cells.length; i++) {
    if (!stitched[i] || p.cells[i] === CANVAS) continue;
    const x = i % p.w;
    const y = (i - x) / p.w;
    const sx = Math.floor(tx + (x + 0.5) * opts.s);
    const sy = Math.floor(ty + (y + 0.5) * opts.s);
    if (sx >= width || sy >= height) continue;
    const o = (sy * width + sx) * 4;
    const rgb = p.threads[p.cells[i]].rgb;
    const want = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
    const got = [f.pixels[o], f.pixels[o + 1], f.pixels[o + 2]];
    if (want.every((v, k) => Math.abs(v - got[k]) <= 1)) ok++;
    else bad.push(`(${x},${y}) ${want} ≠ ${got}`);
  }
  expect(bad.slice(0, 5)).toEqual([]);
  expect(ok).toBeGreaterThan(20);
}

describe('шейдер канвы', () => {
  test('далеко: вышитое — цветом нити', () => check({ s: 6, near: false }));
  test('«Крестик» близко: в центре клетки — цвет нити', () => check({ s: 30, near: true }));
  test('«Мозаика» близко: в центре клетки — цвет нити', () => check({ s: 30, near: true, mosaic: true }));
});

describe('картинка «Поделиться» на самой мелкой клетке со стежками', () => {
  // законченная работа тем же шейдером, клетка SHARE_STITCHES_FROM точек: стиль ещё различим —
  // тот же разбор клеток, что у сценария (tools/e2e/share.ts)
  const all = Uint8Array.from(p.cells, () => 1);
  const look = async (mosaic: boolean) => {
    const s = SHARE_STITCHES_FROM;
    const f = await renderFrame(p, all, { width: p.w * s, height: p.h * s, tx: 0, ty: 0, s, near: true, mosaic });
    const px = (x: number, y: number): [number, number, number] => {
      const o = (Math.floor(y) * p.w * s + Math.floor(x)) * 4;
      return [f.pixels[o], f.pixels[o + 1], f.pixels[o + 2]];
    };
    return stitchStyles(p, px, 0, 0, s);
  };

  test('«Крестик» — крестиками, «Мозаика» — плиткой', async () => {
    const c = await look(false);
    const m = await look(true);
    expect(c.cells).toBeGreaterThan(100);
    expect([c.cross >= 0.95 * c.cells, c.tile]).toEqual([true, 0]);
    expect([m.tile >= 0.95 * m.cells, m.cross]).toEqual([true, 0]);
  });
});

describe('крестик на мелкой клетке не бледнит нить', () => {
  // Картинку «Поделиться» смотрят целиком, и глаз смешивает клетку в один цвет. До 14.10.2026 светлая
  // канва между стежками оставляла от насыщенности нити 30–60 %, а тёмная нить светлела до серой: работа
  // выходила бледной и в сетку. Теперь мельче 44 точек крестик плотнее, а канва между стежками — в тени нити.
  const colors = [0xc8102e, 0x2e4a1e, 0x6f8f3a, 0x7aa6d9, 0xe8b4b8];
  const strip: Pattern = { key: 'strip@1', w: colors.length, h: 1, threads: colors.map((rgb, i) => ({ rgb, name: `n${i}` })), cells: Uint8Array.from(colors, (_, i) => i) };
  const all = Uint8Array.from(colors, () => 1);
  const frame = (s: number) => renderFrame(strip, all, { width: strip.w * s, height: s, tx: 0, ty: 0, s, near: true });
  const lch = (rgb: number) => labToLch(linearToLab(linear((rgb >> 16) & 255), linear((rgb >> 8) & 255), linear(rgb & 255)));

  test('клетка 22 точки (узор в 70 клеток): средний цвет клетки — почти цвет нити', async () => {
    const s = 22;
    const f = await frame(s);
    const bad: string[] = [];
    colors.forEach((rgb, i) => {
      let r = 0, g = 0, b = 0;
      for (let y = 0; y < s; y++) {
        for (let x = i * s; x < (i + 1) * s; x++) {
          const o = (y * strip.w * s + x) * 4;
          r += linear(f.pixels[o]);
          g += linear(f.pixels[o + 1]);
          b += linear(f.pixels[o + 2]);
        }
      }
      const n = s * s;
      const got = labToLch(linearToLab(r / n, g / n, b / n));
      const want = lch(rgb);
      // насыщенность — не меньше трёх четвертей, светлота — почти та же
      if (got[1] < 0.75 * want[1] || Math.abs(got[0] - want[0]) > 0.07) {
        bad.push(`${rgb.toString(16)}: L ${want[0].toFixed(2)} → ${got[0].toFixed(2)}, C ${want[1].toFixed(3)} → ${got[1].toFixed(3)}`);
      }
    });
    expect(bad).toEqual([]);
  });

  test('клетка 44 точки и крупнее — как вблизи: у середины стороны канва, в середине нить', async () => {
    const s = 44;
    const f = await frame(s);
    const px = (x: number, y: number) => {
      const o = (Math.floor(y) * strip.w * s + Math.floor(x)) * 4;
      return [f.pixels[o], f.pixels[o + 1], f.pixels[o + 2]];
    };
    const cloth = [243, 240, 230];
    colors.forEach((rgb, i) => {
      const want = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
      const edge = px((i + 0.5) * s, 0.12 * s);
      const mid = px((i + 0.5) * s, 0.5 * s);
      expect(Math.hypot(...edge.map((v, k) => v - cloth[k]))).toBeLessThanOrEqual(24);
      expect(Math.hypot(...mid.map((v, k) => v - want[k]))).toBeLessThanOrEqual(36);
    });
  });
});

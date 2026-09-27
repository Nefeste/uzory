// Золотые кадры канвы (docs/06-testing.md, «Канва»): шейдер собирается, и цвет в центре
// каждой вышитой клетки — ровно цвет нити, во всех стилях и масштабах.
import { describe, expect, test } from 'bun:test';
import { CANVAS } from '../../src/engine/pattern';
import { rng } from '../../src/engine/seed';
import { renderFrame } from '../canvas/ck';
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

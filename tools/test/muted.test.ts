// Превью не начатой картинки — приглушённым цветом (решение владельца 31.10.2026, issue 130, вариант Б;
// docs/08-game-design.md, «Превью»): насыщенность −40 %, светлее, оттенок тот же — витрина в цвете, но
// не «готовая картинка», и вышитое ярче.
import { describe, expect, test } from 'bun:test';
import { labToLch, MUTED, muted, rgbToLab } from '../../src/engine/color';

const lch = (rgb: number) => labToLch(rgbToLab(rgb));

describe('приглушённый цвет превью', () => {
  const threads = [0xc8102e, 0x2e4a1e, 0x6f8f3a, 0x7aa6d9, 0xe8b4b8, 0x1f4fa0, 0xa8904f, 0x3b2a20];

  test('насыщенность — 60 %, светлота — на четверть ближе к белому, оттенок тот же', () => {
    for (const rgb of threads) {
      const [L, C, h] = lch(rgb);
      const [l2, c2, h2] = lch(muted(rgb));
      expect(c2 / C, rgb.toString(16)).toBeCloseTo(MUTED.chroma, 1);
      expect(l2, rgb.toString(16)).toBeCloseTo(L + (1 - L) * MUTED.light, 2);
      expect(Math.abs(((h2 - h + 540) % 360) - 180), rgb.toString(16)).toBeLessThan(3);
    }
  });

  test('вышитое ярче не начатого: у приглушённого и насыщенность меньше, и светлота больше', () => {
    for (const rgb of threads) {
      const [L, C] = lch(rgb);
      const [l2, c2] = lch(muted(rgb));
      expect(c2).toBeLessThan(C);
      expect(l2).toBeGreaterThan(L);
    }
  });

  test('серый остаётся серым, только светлее; белый — белым', () => {
    const [L, C] = lch(muted(0x808080));
    expect(C).toBeLessThan(0.002);
    expect(L).toBeGreaterThan(lch(0x808080)[0]);
    expect(muted(0xffffff)).toBe(0xffffff);
  });
});

// Золотые кадры канвы (docs/06-testing.md, «Канва»): шейдер собирается, и цвет в центре
// каждой вышитой клетки — ровно цвет нити, во всех стилях и масштабах.
import { describe, expect, test } from 'bun:test';
import { FIELD, SKSL } from '../../src/canvas/shader';
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

describe('законченная работа без стежков — ровными клетками', () => {
  // картинка «Поделиться» без «Стежков на картинке» и «Готово» рисуются веткой «далеко» без сцены:
  // клетка ровного цвета и у края, и в середине (решение владельца 15.10.2026; фактура издалека — только
  // у канвы с кистью)
  test('у края и в середине клетки — цвет нити', async () => {
    const all = Uint8Array.from(p.cells, () => 1);
    const s = 12;
    const f = await renderFrame(p, all, { width: p.w * s, height: p.h * s, tx: 0, ty: 0, s, near: false });
    const bad: string[] = [];
    for (let i = 0; i < p.cells.length; i++) {
      if (p.cells[i] === CANVAS) continue;
      const rgb = p.threads[p.cells[i]].rgb;
      const want = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
      const x = i % p.w;
      const y = (i - x) / p.w;
      for (const [dx, dy] of [[0.5, 0.5], [0.5, 1.5], [1.5, 6.5]]) {
        const o = (Math.floor(y * s + dy) * p.w * s + Math.floor(x * s + dx)) * 4;
        const got = [f.pixels[o], f.pixels[o + 1], f.pixels[o + 2]];
        if (!want.every((v, k) => Math.abs(v - got[k]) <= 1)) bad.push(`(${x},${y}) ${want} ≠ ${got}`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

describe('повтор «Как вышивалось» — без номеров', () => {
  // разбор оформления 31.10.2026, Б4: у малых и средних работ повтор шёл схемой с номерами;
  // теперь невышитое — бледным следом нити, как издалека
  test('в середине невышитой клетки нет тёмных точек номера; без ghost — есть', async () => {
    const none = new Uint8Array(p.cells.length);
    const s = 30;
    const dark = async (ghost: boolean) => {
      const f = await renderFrame(p, none, { width: p.w * s, height: p.h * s, tx: 0, ty: 0, s, near: true, font: true, ghost });
      let n = 0;
      for (let i = 0; i < p.cells.length; i++) {
        if (p.cells[i] === CANVAS) continue;
        const x0 = (i % p.w) * s;
        const y0 = Math.floor(i / p.w) * s;
        for (let y = y0 + 0.3 * s; y < y0 + 0.7 * s; y++) {
          for (let x = x0 + 0.3 * s; x < x0 + 0.7 * s; x++) {
            const o = (Math.floor(y) * p.w * s + Math.floor(x)) * 4;
            if (Math.max(f.pixels[o], f.pixels[o + 1], f.pixels[o + 2]) < 90) n++;
          }
        }
      }
      return n;
    };
    expect(await dark(true)).toBe(0);
    expect(await dark(false)).toBeGreaterThan(1000);
  }, 60_000);
});

describe('«Тайна» издалека', () => {
  // issue 117, А: бледный тон своей нити у невышитых клеток выдал бы силуэт картинки
  test('невышитое — ровно цвет канвы, вышитое — цвет нити; без «тайны» невышитое — разными тонами', async () => {
    const s = 6;
    const look = (mystery: boolean) => renderFrame(p, stitched, { width: p.w * s, height: p.h * s, tx: 0, ty: 0, s, near: false, mystery });
    const cloth = /const half3 CLOTH = half3\(([^)]*)\)/.exec(SKSL)![1].split(',').map((v) => Math.round(Number(v) * 255));
    const tones = async (mystery: boolean) => {
      const f = await look(mystery);
      const seen = new Set<string>();
      let off = 0;
      for (let i = 0; i < p.cells.length; i++) {
        if (stitched[i] || p.cells[i] === CANVAS) continue;
        const o = ((Math.floor(i / p.w) * s + 3) * p.w * s + (i % p.w) * s + 3) * 4;
        const got = [f.pixels[o], f.pixels[o + 1], f.pixels[o + 2]];
        seen.add(got.join(','));
        if (!got.every((v, k) => Math.abs(v - cloth[k]) <= 1)) off++;
      }
      return { tones: seen.size, off };
    };
    expect((await tones(true)).off).toBe(0);
    expect((await tones(false)).tones).toBeGreaterThan(5);
  });
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

describe('крестик закрывает клетку и не бледнит нить', () => {
  // Картинку «Поделиться» смотрят целиком, и глаз смешивает клетку в один цвет. До 14.10.2026 светлая
  // канва между стежками оставляла от насыщенности нити 30–60 %, а тёмная нить светлела до серой: работа
  // выходила бледной и в сетку. Тогда мельче 44 точек крестик стал плотнее, а канва между стежками — в тени
  // нити. С 31.10.2026 (разбор оформления: «решётка из белых ромбов») плотный крестик — на любом масштабе:
  // плечи почти до углов и шириной в половину клетки, канва видна только узкими щелями у середин сторон, в
  // тени плеч.
  const colors = [0xc8102e, 0x2e4a1e, 0x6f8f3a, 0x7aa6d9, 0xe8b4b8];
  const strip: Pattern = { key: 'strip@1', w: colors.length, h: 1, threads: colors.map((rgb, i) => ({ rgb, name: `n${i}` })), cells: Uint8Array.from(colors, (_, i) => i) };
  const all = Uint8Array.from(colors, () => 1);
  const frame = (s: number) => renderFrame(strip, all, { width: strip.w * s, height: s, tx: 0, ty: 0, s, near: true });
  const lchOf = (c: number[]) => labToLch(linearToLab(linear(c[0]), linear(c[1]), linear(c[2])));
  const lch = (rgb: number) => lchOf([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255]);
  const pixel = (f: Awaited<ReturnType<typeof frame>>, s: number) => (x: number, y: number) => {
    const o = (Math.floor(y) * strip.w * s + Math.floor(x)) * 4;
    return [f.pixels[o], f.pixels[o + 1], f.pixels[o + 2]];
  };

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

  test('клетка 44 точки и крупнее: у края стороны — канва в тени плеч, в середине — нить', async () => {
    for (const s of [44, 74]) {
      const px = pixel(await frame(s), s);
      const cloth = lchOf([243, 240, 230]);
      colors.forEach((rgb, i) => {
        const want = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
        // канва: светлая и почти без цвета, но темнее открытой — в тени плеч
        const edge = lchOf(px((i + 0.5) * s, 0.04 * s));
        expect(edge[1]).toBeLessThanOrEqual(0.03);
        expect(edge[0]).toBeGreaterThanOrEqual(0.7);
        expect(edge[0]).toBeLessThanOrEqual(cloth[0] - 0.05);
        const mid = px((i + 0.5) * s, 0.5 * s);
        expect(Math.hypot(...mid.map((v, k) => v - want[k]))).toBeLessThanOrEqual(36);
      });
    }
  });

  test('рабочий масштаб (клетка 74 точки): нить закрывает не меньше 85 % клетки', async () => {
    // до 31.10.2026 — около 72 %: между плечами светлые ромбы канвы
    const s = 74;
    const px = pixel(await frame(s), s);
    colors.forEach((rgb, i) => {
      const want = lch(rgb);
      let n = 0;
      for (let y = 0; y < s; y++) {
        for (let x = i * s; x < (i + 1) * s; x++) {
          // точка нити — того же оттенка, хоть в тени, хоть в блике
          const c = lchOf(px(x, y));
          const hue = Math.abs(((c[2] - want[2] + 540) % 360) - 180);
          if (c[1] > 0.4 * want[1] && hue < 25) n++;
        }
      }
      expect(n / (s * s), rgb.toString(16)).toBeGreaterThanOrEqual(0.85);
    });
  });

  test('свет сверху слева: у верхнего стежка сторона к свету светлее', async () => {
    // верхний стежок — из правого верхнего угла в левый нижний; точки поперёк него, по обе стороны от середины
    const s = 74;
    const px = pixel(await frame(s), s);
    colors.forEach((rgb, i) => {
      const k = 0.14 * s * Math.SQRT1_2;
      const lit = lchOf(px((i + 0.5) * s - k, 0.5 * s - k));
      const dark = lchOf(px((i + 0.5) * s + k, 0.5 * s + k));
      expect(lit[0] - dark[0], rgb.toString(16)).toBeGreaterThan(0.04);
    });
  });
});

describe('сцена: поле за краем узора и виньетка', () => {
  // разбор оформления 31.10.2026: узор — не прямоугольник в пустом сером поле. За краем — та же канва,
  // темнее; в тёмной теме она уходит в тень за 160 точек от узора. Углы экрана темнее — виньетка.
  const s = 10;
  const width = 360;
  const height = 640;
  const tx = (width - p.w * s) / 2;
  const ty = (height - p.h * s) / 2;
  const look = (dark: boolean, scene: boolean) => renderFrame(p, stitched, { width, height, s, tx, ty, near: true, scene, dark });
  const at = (f: Awaited<ReturnType<typeof look>>, x: number, y: number) => {
    const o = (Math.floor(y) * width + Math.floor(x)) * 4;
    return labToLch(linearToLab(linear(f.pixels[o]), linear(f.pixels[o + 1]), linear(f.pixels[o + 2])))[0];
  };

  test('FIELD — цвет поля из шейдера: CLOTH × FIELD_LIGHT и × FIELD_DARK', () => {
    const num = (name: string) => Number(new RegExp(`const float ${name} = ([\\d.]+);`).exec(SKSL)?.[1]);
    const cloth = /const half3 CLOTH = half3\(([^)]*)\)/.exec(SKSL)![1].split(',').map(Number);
    const hex = (k: number) => `#${cloth.map((c) => Math.round(c * k * 255).toString(16).padStart(2, '0')).join('')}`;
    expect<string[]>([FIELD.light, FIELD.dark]).toEqual([hex(num('FIELD_LIGHT')), hex(num('FIELD_DARK'))]);
  });

  test('светлая тема: за краем — канва, темнее узора; тёмная: у края светло, вдали — тень', async () => {
    const light = await look(false, true);
    const dark = await look(true, true);
    // у верхнего края узора, посередине, и у верха экрана
    const near = [width / 2, ty - 4] as const;
    const far = [width / 2, 8] as const;
    expect(at(light, ...near)).toBeGreaterThan(0.85);
    expect(at(light, ...far)).toBeGreaterThan(0.8);
    expect(at(dark, ...near)).toBeGreaterThan(0.85);
    expect(at(dark, ...far)).toBeLessThan(0.55);
  });

  test('виньетка темнит углы экрана, середина — как без неё', async () => {
    const plain = await look(false, false);
    const scene = await look(false, true);
    expect(at(scene, 4, 4)).toBeLessThan(at(plain, 4, 4) - 0.03);
    expect(Math.abs(at(scene, width / 2, height / 2) - at(plain, width / 2, height / 2))).toBeLessThan(0.002);
  });
});

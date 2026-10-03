// Контраст номера на клетке (docs/08-game-design.md, «Для старшей аудитории»: не ниже 4,5 : 1, в том
// числе на подсвеченных клетках; docs/specs/2026-09-canvas.md, критерий 6). Шейдер выбирает цвет
// номера по яркости клетки под ним; здесь то же правило повторено на процессоре — с числами из
// самого шейдера — и проверено на каждой нити встроенного набора и на выборке всех цветов
// (свой узор бывает любых цветов): крестик и «Мозаика», без подсветки, с подсветкой и со штриховкой.
import { describe, expect, test } from 'bun:test';
import { SKSL } from '../../src/canvas/shader';
import { base64Decode } from '../../src/engine/base64';
import { contrast } from '../../src/engine/color';
import { openPack } from '../../src/engine/pack';
import { BASE_PACK } from '../../src/content/generated/pack';

type V = [number, number, number];

const half3 = (name: string): V => {
  const m = new RegExp(`const half3 ${name} = half3\\(([^)]*)\\)`).exec(SKSL);
  if (!m) throw new Error(`в шейдере нет ${name}`);
  return m[1].split(',').map(Number) as V;
};
const CLOTH = half3('CLOTH');
const TILE = half3('TILE');
const DIGIT = half3('DIGIT');
const rule = /half l = (\w+)\(o\);\s*half3 dc = l > ([\d.]+) \? DIGIT : \(l > ([\d.]+) \? half3\(0\.0\) : half3\(1\.0\)\);/.exec(SKSL);
const tint = Number(/base = hatch > 0\.5 \? mix\(base, col, half\(([\d.]+) \* stripe\)\) : mix\(base, col, ([\d.]+)\);/.exec(SKSL)?.[1]);
const soft = Number(/base = hatch > 0\.5 \? mix\(base, col, half\(([\d.]+) \* stripe\)\) : mix\(base, col, ([\d.]+)\);/.exec(SKSL)?.[2]);

const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const wcag = (c: V) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const mix = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgb = (c: V) => {
  const ch = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255);
  return (ch(c[0]) << 16) | (ch(c[1]) << 8) | ch(c[2]);
};

/** Цвет номера на клетке цвета `o` — правило шейдера. */
function digit(o: V): V {
  const l = wcag(o);
  const hi = Number(rule![2]);
  const lo = Number(rule![3]);
  return l > hi ? DIGIT : l > lo ? [0, 0, 0] : [1, 1, 1];
}

/** Клетка под номером: полотно крестика (с переплетением ±2 %) или плитка «Мозаики» — как есть, подсвеченная, в полоске штриховки. */
function cells(col: V): [string, V][] {
  const out: [string, V][] = [];
  for (const weave of [0.965, 1.005]) {
    const cloth: V = [CLOTH[0] * weave, CLOTH[1] * weave, CLOTH[2] * weave];
    out.push(['крестик', cloth], ['крестик, подсветка', mix(cloth, col, soft)], ['крестик, штриховка', mix(cloth, col, tint)]);
  }
  out.push(['мозаика', TILE], ['мозаика, подсветка', mix(TILE, col, soft)], ['мозаика, штриховка', mix(TILE, col, tint)]);
  return out;
}

function worst(colors: Iterable<V>): { k: number; what: string } {
  let w = { k: Infinity, what: '' };
  for (const col of colors) {
    for (const [name, o] of cells(col)) {
      const k = contrast(rgb(digit(o)), rgb(o));
      if (k < w.k) w = { k, what: `${rgb(col).toString(16).padStart(6, '0')}, ${name}: ${k.toFixed(2)}` };
    }
  }
  return w;
}

describe('контраст номера на клетке', () => {
  test('правило шейдера на месте: цвет номера — по яркости WCAG, подсветка и штриховка найдены', () => {
    expect(rule?.[1]).toBe('wcag');
    expect(soft).toBeGreaterThan(0);
    expect(tint).toBeGreaterThan(soft);
  });

  test('каждая нить встроенного набора: не ниже 4,5 : 1', () => {
    const pack = openPack(base64Decode(BASE_PACK));
    const colors = new Map<string, V>();
    for (const p of pack.json.pictures) {
      for (const [hex] of p.palette) colors.set(hex, [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255]);
    }
    expect(colors.size).toBeGreaterThan(100);
    const w = worst(colors.values());
    expect(w.k, w.what).toBeGreaterThanOrEqual(4.5);
  });

  test('любой цвет (свой узор): выборка куба цветов через 15 — не ниже 4,5 : 1', () => {
    const cube: V[] = [];
    for (let r = 0; r <= 255; r += 15) for (let g = 0; g <= 255; g += 15) for (let b = 0; b <= 255; b += 15) cube.push([r / 255, g / 255, b / 255]);
    const w = worst(cube);
    expect(w.k, w.what).toBeGreaterThanOrEqual(4.5);
  });
});

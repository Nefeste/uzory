// «Найти лица» (0.24.0; issue 146): порт pico.js находит лица там же, где рамки лиц карточек «России в
// цвете» (`pattern.focus`), и не находит их на снимках природы без людей; несколько овалов главного — одна маска.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cluster, type Face, faceOvals, faceOvalSteps, PICO_NOTICE, unpackCascade } from '../../src/engine/build/faces';
import { mainRects, ovalMask, ovalsMask } from '../../src/engine/build/main';
import { decode } from '../content/image';

const cascade = unpackCascade(new Uint8Array(readFileSync(join(import.meta.dir, '..', '..', 'assets', 'faces', 'facefinder.bin'))));
const CONTENT = join(import.meta.dir, '..', '..', 'content');
const inside = (x: number, y: number, r: number[]) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];

describe('лица на снимке', () => {
  test('уведомление MIT в «О программе» — слово в слово текст из assets/faces/LICENSES.md', () => {
    const md = readFileSync(join(import.meta.dir, '..', '..', 'assets', 'faces', 'LICENSES.md'), 'utf8');
    const text = md.split('```\n')[1].split('```')[0];
    const words = (s: string) => s.split(/\s+/).filter(Boolean).join(' ');
    expect(words(PICO_NOTICE)).toBe(words(text));
    expect(PICO_NOTICE).toContain('Copyright (c) 2013 Nenad Markus');
  });

  test('каскад pico читается: деревья глубины 6', () => {
    expect(cascade.tdepth).toBe(6);
    expect(cascade.ntrees).toBeGreaterThan(400);
  });

  test('«Грузинка»: овал там, где рамка лица карточки', async () => {
    const r = await decode(join(CONTENT, 'russia', 'pg-gruzinka.jpg'));
    const ovals = faceOvals(r, [0.02, 0.02, 0.98, 0.98], cascade);
    const face = [0.424, 0.232, 0.48, 0.3];   // рамка лица из карточки
    expect(ovals.length).toBeGreaterThan(0);
    const [l, t, rr, b] = ovals[0];
    expect(inside((l + rr) / 2, (t + b) / 2, [face[0] - 0.05, face[1] - 0.05, face[2] + 0.05, face[3] + 0.05])).toBe(true);
  });

  test('поиск кусками — те же овалы: передышки для экрана находок не меняют', async () => {
    const r = await decode(join(CONTENT, 'russia', 'pg-gruzinka.jpg'));
    const steps = faceOvalSteps(r, [0.02, 0.02, 0.98, 0.98], cascade);
    let pauses = 0;
    for (let s = steps.next(); ; s = steps.next()) {
      if (s.done) {
        expect(s.value).toEqual(faceOvals(r, [0.02, 0.02, 0.98, 0.98], cascade));
        break;
      }
      pauses++;
    }
    // серый кадр — полосами по 32 строки, окна — по 4000: у снимка в 1000 точек передышек — десятки
    expect(pauses).toBeGreaterThan(50);
  });

  test('снимок без людей — без овалов', async () => {
    const r = await decode(join(CONTENT, 'nature', 'oduvanchiki.jpg'));
    expect(faceOvals(r, [0, 0, 1, 1], cascade)).toEqual([]);
  });

  test('кучка окон вокруг одного лица — одно лицо, уверенность — сумма', () => {
    const f = (x: number, y: number, s: number, q: number): Face => ({ x, y, size: s, score: q });
    const out = cluster([f(100, 100, 40, 5), f(102, 101, 42, 4), f(300, 300, 40, 6)]);
    expect(out).toHaveLength(2);
    expect(out[0].score).toBe(9);
  });
});

describe('несколько овалов главного', () => {
  test('маска двух овалов — их объединение; один овал — как раньше', () => {
    const a: [number, number, number, number] = [0.1, 0.1, 0.4, 0.5];
    const b: [number, number, number, number] = [0.6, 0.4, 0.9, 0.9];
    const both = ovalsMask([0, 0, 1, 1], 40, 40, [a, b])!;
    const ma = ovalMask([0, 0, 1, 1], 40, 40, a)!, mb = ovalMask([0, 0, 1, 1], 40, 40, b)!;
    for (let i = 0; i < both.length; i++) expect(both[i]).toBe(ma[i] | mb[i]);
    expect(Array.from(ovalsMask([0, 0, 1, 1], 40, 40, a)!)).toEqual(Array.from(ma));
    expect(mainRects(a)).toEqual([a]);
    expect(mainRects([a, b])).toEqual([a, b]);
  });
});

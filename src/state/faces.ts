// «Найти лица» и «Найти главное» (0.24.0; владелец 01.11.2026, issue 146): овалы главного — на лица в кадре
// (детектор pico, src/engine/build/faces.ts) или на самое заметное (src/engine/build/salient.ts). Снимок
// никуда не уходит — всё считается на устройстве; каскад детектора читается один раз, по первой кнопке
// (./facesFile.ts). На телефоне без JIT поиск лиц — около двух секунд счёта: он идёт кусками, и между ними
// экран получает кадр — рамка и пальцы не замирают, круг «Ищу…» крутится.
import { type Cascade, faceOvalSteps, unpackCascade } from '../engine/build/faces';
import type { Raster } from '../engine/build/grid';
import type { Crop } from '../engine/build/mine';
import { salientSteps } from '../engine/build/salient';
import { INTERNAL } from '../version';
import { cascadeBytes } from './facesFile';

/**
 * Кнопки «Найти лица» и «Найти главное» — пока в сборках для проверки (0.x): владелец, issue 146 —
 * «выпускаем, если работает в большинстве случаев». Решение о 1.0 — по снимкам владельца на телефоне
 * (docs/specs/2026-09-custom.md, «Решения», 0.24.0). Несколько овалов вручную («Ещё овал») — у всех.
 */
export const AUTO_MAIN = INTERNAL;

let cascade: Promise<Cascade> | null = null;

/** Счёта подряд — не дольше: потом кадр экрану. */
const BUDGET_MS = 30;

const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
const frame = () => new Promise<void>((done) => setTimeout(done, 0));

/** Шаги поиска — до конца, с кадром экрану после каждых `BUDGET_MS` счёта. */
async function drive<T>(steps: Generator<void, T, void>): Promise<T> {
  // «Ищу…» — на экране до первого счёта
  await frame();
  let t = now();
  for (;;) {
    const s = steps.next();
    if (s.done) return s.value;
    if (now() - t > BUDGET_MS) {
      await frame();
      t = now();
    }
  }
}

/** Овалы главного по лицам кадра; каскад не прочитался — исключение. */
export async function findFaces(r: Raster, crop: Crop): Promise<Crop[]> {
  cascade ??= cascadeBytes().then(unpackCascade).catch((e: unknown) => {
    cascade = null;
    throw e;
  });
  const cs = await cascade;
  return (await drive(faceOvalSteps(r, crop, cs))) as Crop[];
}

/** Овалы главного по заметности: то, что не похоже на края кадра; главного нет — пустой список. */
export async function findSalient(r: Raster, crop: Crop): Promise<Crop[]> {
  return (await drive(salientSteps(r, crop))) as Crop[];
}

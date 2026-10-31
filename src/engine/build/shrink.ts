// Шаги уменьшения снимка (src/state/photo.ts; 0.18.2, разбор отчёта владельца 31.10.2026: снимок с
// телефона в высоком разрешении давал «ужасное качество»). RN Skia рисует drawImageRectOptions со
// строгой границей исходника (kStrict_SrcRectConstraint, cpp/api/JsiSkCanvas.h), а при ней Skia
// мип-карты не берёт: MipmapMode.Linear молча становится None, и снимок 8160 × 6120 уменьшался до 2000
// точек одним шагом — линейная выборка брала по две точки из каждых четырёх, по снимку шла рябь, а по
// узору пестрота. Уменьшение ровно вдвое с линейной выборкой — среднее четырёх точек, без потерь;
// поэтому — половинками, пока снимок вдвое больше нужного, и последний шаг — меньше чем вдвое
// (tools/test/shrink.test.ts — на CanvasKit с той же строгой границей).

/** Размеры после каждого шага уменьшения с sw × sh до w × h; последний — w × h. */
export function shrinkSteps(sw: number, sh: number, w: number, h: number): [number, number][] {
  const steps: [number, number][] = [];
  while (sw >= 2 * w && sh >= 2 * h) {
    sw = Math.ceil(sw / 2);
    sh = Math.ceil(sh / 2);
    steps.push([sw, sh]);
  }
  steps.push([w, h]);
  return steps;
}

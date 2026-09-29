// Проверки узора (docs/09-content.md, §6): ошибка — картинка не попадает в набор,
// предупреждение — попадает, но близко к порогу; владельцу видно, что пересобрать.
import { deltaOK, rgbToLab } from '../../src/engine/color';
import { type Pattern, patternError, sizeClass, type SizeClass } from '../../src/engine/pattern';
import { patternStats, type PatternStats } from '../../src/engine/stats';
import type { Card } from './cards';
import { MIN_DELTA } from './palette';

/** Пределы размеров (docs/08-game-design.md, «Размеры узоров»). */
export const SIZES: Record<SizeClass, { cells: number; side: number; threads: [number, number] }> = {
  S: { cells: 1600, side: 40, threads: [3, 10] },
  M: { cells: 4900, side: 70, threads: [8, 20] },
  L: { cells: 14400, side: 120, threads: [12, 32] },
  // «Огромная» — до четырёх клеток на сантиметр холста (08-game-design): сторона — предел текстуры канвы
  XL: { cells: 600000, side: 1024, threads: [20, 45] },
};

/** Тёмная картинка: больше половины клеток — нити темнее этой светлоты OKLab. */
export const DARK_L = 0.3;
export const DARK_SHARE = 0.5;

/** Цвет невышитой клетки на канве — нить не должна с ним сливаться. */
export const EMPTY_CELL = 0xf3f0e6;

export interface Checked {
  errors: string[];
  warnings: string[];
  stats: PatternStats;
  size: SizeClass;
}

const pct = (x: number) => `${x.toFixed(2)} %`;

export function checkPattern(p: Pattern, card: Card): Checked {
  const errors: string[] = [];
  const warnings: string[] = [];
  const bad = patternError(p);
  if (bad) errors.push(bad);
  // нарисованный орнамент и старинная схема — замысел человека по клеткам: косая линия в
  // клетку у них не «конфетти» (§6)
  const drawn = !!card.drawn || !!card.pattern?.chart;
  const stats = patternStats(p, drawn);
  const size = sizeClass(p);
  const lim = SIZES[size];
  const n = p.threads.length;
  const top = SIZES.XL;
  if (stats.cells > top.cells) errors.push(`${stats.cells} клеток — больше ${top.cells}`);
  if (Math.max(p.w, p.h) > top.side) errors.push(`сторона ${Math.max(p.w, p.h)} — больше ${top.side}`);
  if (n > top.threads[1]) errors.push(`${n} нитей — больше ${top.threads[1]}`);
  if (Math.max(p.w, p.h) > lim.side) warnings.push(`размер ${size}: сторона ${Math.max(p.w, p.h)} больше ${lim.side}`);
  if (n < lim.threads[0] || n > lim.threads[1]) warnings.push(`размер ${size}: ${n} нитей вне ${lim.threads[0]}–${lim.threads[1]}`);
  const minCells = Math.max(8, Math.ceil(stats.cells * 0.002));
  stats.counts.forEach((c, t) => {
    if (c < minCells) errors.push(`нить ${t + 1} «${p.threads[t].name}»: ${c} клеток, нужно не меньше ${minCells}`);
  });
  const min = MIN_DELTA[size];
  if (n > 1 && stats.minDelta < min) {
    const [a, b] = stats.closest;
    errors.push(`нити ${a + 1} и ${b + 1} неразличимы: ${stats.minDelta.toFixed(3)} < ${min}`);
  } else if (n > 1 && stats.minDelta < min * 1.15) warnings.push(`различимость ${stats.minDelta.toFixed(3)} — у порога ${min}`);
  const empty = rgbToLab(EMPTY_CELL);
  p.threads.forEach((t, k) => {
    const d = deltaOK(rgbToLab(t.rgb), empty);
    if (d < min) warnings.push(`нить ${k + 1} «${t.name}» близко к цвету пустой клетки: ${d.toFixed(3)}`);
  });
  const singlesMax = card.collection === 'kids' ? 0 : 1;
  // печатная схема ровными красками: шахматка — замысел, кисть проходит её одним движением
  // на цвет; порог против шума картин ей не мерило — только предупреждение (§6, предложение)
  const exact = !!card.pattern?.exact;
  const confetti = exact ? warnings : errors;
  if (stats.singles > singlesMax) confetti.push(`одиночных клеток ${pct(stats.singles)}, можно ${singlesMax} %${exact ? ' (точная схема — замысел)' : ''}`);
  else if (stats.singles > singlesMax * 0.8 && singlesMax > 0) warnings.push(`одиночных клеток ${pct(stats.singles)} — у порога`);
  if (stats.small > 3) confetti.push(`в мелких пятнах ${pct(stats.small)} клеток, можно 3 %${exact ? ' (точная схема — замысел)' : ''}`);
  else if (stats.small > 2.4) warnings.push(`в мелких пятнах ${pct(stats.small)} — у порога`);
  for (const t of stats.lonely) errors.push(`нить ${t + 1} «${p.threads[t].name}» — из одних одиночек`);
  // «Лунная ночь на Днепре»: почти всё почти чёрное — на телефоне узор сливается в пятно
  const dark = stats.counts.reduce((s, c, t) => s + (rgbToLab(p.threads[t].rgb)[0] < DARK_L ? c : 0), 0) / Math.max(1, stats.cells);
  if (dark > DARK_SHARE) warnings.push(`тёмная картинка: ${pct(dark * 100)} клеток почти чёрные`);
  return { errors, warnings, stats, size };
}

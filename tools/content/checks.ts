// Проверки узора карточки (docs/09-content.md, §6): сами проверки — src/engine/build/checks.ts,
// общие со своим узором в приложении; здесь — что из карточки им важно.
import type { Pattern } from '../../src/engine/pattern';
import { type Checked, checkPatternWith } from '../../src/engine/build/checks';
import { mainMask } from '../../src/engine/build/photo';
import { type Card, patternSpec } from './cards';

export { type Checked, DARK_L, DARK_SHARE, EMPTY_CELL, SIZES } from '../../src/engine/build/checks';

/**
 * `focus` — клетки важных частей узора (src/engine/build/focus.ts), если у карточки есть рамки лиц;
 * `v` — версия узора: у прежней (`was`) свой порог различимости. Главное (`pattern.main`, снимок из
 * «Своего узора», src/engine/build/main.ts) — одиночки и мелкие пятна в нём не считаются, как в приговоре
 * своего узора.
 */
export function checkPattern(p: Pattern, card: Card, focus?: Uint8Array, v = card.v): Checked {
  const spec = card.pattern ? patternSpec(card, v) : undefined;
  const minDelta = spec?.min_delta;
  const skip = spec && !spec.chart ? mainMask(spec, p) : undefined;
  return checkPatternWith(p, {
    kids: card.collection === 'kids',
    // нарисованный орнамент и старинная схема — замысел человека по клеткам: косая линия в
    // клетку у них не «конфетти»
    diagonal: !!card.drawn || !!card.pattern?.chart,
    exact: !!card.pattern?.exact,
    ...(focus ? { focus } : {}),
    ...(skip ? { skip } : {}),
    ...(minDelta !== undefined ? { minDelta } : {}),
  });
}

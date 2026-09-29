// Проверки узора карточки (docs/09-content.md, §6): сами проверки — src/engine/build/checks.ts,
// общие со своим узором в приложении; здесь — что из карточки им важно.
import type { Pattern } from '../../src/engine/pattern';
import { type Checked, checkPatternWith } from '../../src/engine/build/checks';
import type { Card } from './cards';

export { type Checked, DARK_L, DARK_SHARE, EMPTY_CELL, SIZES } from '../../src/engine/build/checks';

export function checkPattern(p: Pattern, card: Card): Checked {
  return checkPatternWith(p, {
    kids: card.collection === 'kids',
    // нарисованный орнамент и старинная схема — замысел человека по клеткам: косая линия в
    // клетку у них не «конфетти»
    diagonal: !!card.drawn || !!card.pattern?.chart,
    exact: !!card.pattern?.exact,
  });
}

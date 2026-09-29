// Подсказки первой картинки (docs/specs/2026-09-first-picture.md, «Первый запуск»): одной
// строкой внизу канвы, по одной; каждая уходит, как только сделано то, о чём она.
// Сделанное запоминается (src/state/player.tsx): закрыли на середине — подсказки идут дальше
// с той же. Кто уже сделал то, о чём подсказка, ещё до неё, — её не увидит.

export type HintId = 'start' | 'brush' | 'zoom' | 'where';
export const HINTS: readonly HintId[] = ['start', 'brush', 'zoom', 'where'];

/** Стежков касаниями до подсказки про кисть. */
export const HINT_TAPS = 5;
/** Процент вышитого, с которого — подсказка про два пальца. */
export const HINT_HALF = 50;
/** Меньше стольких клеток выбранной нити — подсказка про «Где ещё?». */
export const HINT_WHERE_LEFT = 10;

export interface HintState {
  /** сделанные подсказки */
  done: readonly HintId[];
  /** стежков касаниями с открытия экрана */
  taps: number;
  percent: number;
  /** клеток выбранной нити осталось */
  left: number;
}

/**
 * Какая подсказка нужна сейчас. Первая — всегда «коснитесь клетки»; дальше — самая поздняя
 * из тех, чьё время пришло: подсказку, которую игроку не на чем выполнить (два пальца на
 * узоре, который и так целиком на экране), сменяет следующая, а не держит на месте.
 */
export function currentHint(s: HintState): HintId | null {
  const open = (h: HintId) => !s.done.includes(h);
  if (open('start')) return 'start';
  if (open('where') && s.left > 0 && s.left < HINT_WHERE_LEFT) return 'where';
  if (open('zoom') && s.percent >= HINT_HALF) return 'zoom';
  if (open('brush') && s.taps >= HINT_TAPS) return 'brush';
  return null;
}

/** Что делает игрок — и какие подсказки после этого больше не нужны. */
export type HintAction = 'tap' | 'brush' | 'camera' | 'where';

const DONE_BY: Record<HintAction, readonly HintId[]> = {
  tap: ['start'],
  brush: ['start', 'brush'],
  camera: ['zoom'],
  where: ['where'],
};

/** Штрих из `cells` клеток — касание или кисть. */
export const strokeAction = (cells: number): HintAction => (cells > 1 ? 'brush' : 'tap');

/** Сделанные подсказки после действия; порядок — как в HINTS. */
export function hintsAfter(done: readonly HintId[], a: HintAction): HintId[] {
  const out = new Set([...done, ...DONE_BY[a]]);
  return HINTS.filter((h) => out.has(h));
}

/**
 * На экране одна подсказка сменила другую: прежнюю прочли, повторять её не нужно. Исчезла
 * без смены (нить закончилась) — не сделана: придёт время — покажется снова.
 */
export function hintsPassed(done: readonly HintId[], from: HintId | null, to: HintId | null): HintId[] {
  if (!from || !to || from === to || done.includes(from)) return [...done];
  const out = new Set([...done, from]);
  return HINTS.filter((h) => out.has(h));
}

// Ритм звука стежка (src/state/sound.ts; 0.18.2, владелец 31.10.2026: «звук стежков ещё не улучшился»).
// Канва зовёт стежок при кисти каждые 50 мс, и ровные 20 звуков в секунду звучали швейной машинкой,
// какими бы разными ни были сами звуки (разбор оформления 31.10.2026, 4.1). Теперь после стежка
// следующий звучит не раньше чем через случайные 85–140 мс: при кисти — неровная россыпь из 7–12 «тук»
// в секунду, а касание за касанием звучит каждое. Долгая кисть — тише: фон, а не стук.

/** Следующий стежок звучит не раньше чем через столько мс после прежнего — случайно в этих пределах. */
export const STITCH_GAP: [number, number] = [85, 140];
/** Кисть ведут дольше стольких мс — стежки тише в BRUSH_SOFT раз. */
export const BRUSH_SOFT_MS = 400;
export const BRUSH_SOFT = 0.7;
/** Перерыв дольше стольких мс — штрих новый. */
export const STROKE_BREAK_MS = 250;
/** Громкость стежка гуляет на ±20 %. */
export const STITCH_SPREAD = 0.2;

export interface Ticks {
  /** когда звучал прежний стежок, мс */
  lastAt: number;
  /** раньше этого следующий не звучит, мс */
  nextAt: number;
  /** с какого мига идёт штрих, мс */
  strokeFrom: number;
}

export const newTicks = (): Ticks => ({ lastAt: -Infinity, nextAt: -Infinity, strokeFrom: 0 });

/**
 * Стежок позвали в `now` (мс): 0 — промолчать, иначе — доля громкости стежка. `rnd` — случайное 0…1
 * (Math.random; в проверке — своё).
 */
export function stitchTick(s: Ticks, now: number, rnd: () => number): number {
  if (now < s.nextAt) return 0;
  if (now - s.lastAt > STROKE_BREAK_MS) s.strokeFrom = now;
  s.lastAt = now;
  s.nextAt = now + STITCH_GAP[0] + rnd() * (STITCH_GAP[1] - STITCH_GAP[0]);
  return (now - s.strokeFrom > BRUSH_SOFT_MS ? BRUSH_SOFT : 1) * (1 - STITCH_SPREAD + 2 * STITCH_SPREAD * rnd());
}

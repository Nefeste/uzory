// «Меньше движения» — правило 6 ADR 0023 устава («Графика»): как «Узоры» его выполняют —
// docs/02-architecture.md, «Графика (ADR 0023 устава)». Чистые функции: их проверяет tools/test/motion.test.ts.

/** Настройка игрока: `null` — как в системе телефона (так сразу после установки), `true` и `false` — его выбор. */
export type LessMotion = boolean | null;

/** Убирать ли украшающее движение: выбор игрока, а пока его нет — «Уменьшить движение» системы. */
export function lessMotion(setting: LessMotion, system: boolean): boolean {
  return setting ?? system;
}

/**
 * Режим для `ReducedMotionConfig` Reanimated — те же строки, что у `ReduceMotion`: «как в системе», «всегда меньше»,
 * «никогда». Переходы экранов, проявления, отдаление канвы на финише и сдвиги полосы нитей идут через Reanimated и
 * с меньшим движением заканчиваются сразу; взмах канвы и стежки — нет (у них `ReduceMotion.Never`).
 */
export function motionMode(setting: LessMotion): 'system' | 'always' | 'never' {
  return setting === null ? 'system' : setting ? 'always' : 'never';
}

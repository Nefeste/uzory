// из votchina: src/i18n/plural.ts @ 1242776
// Множественное число — своими правилами: на Intl.PluralRules в Hermes под Android
// полагаться нельзя (перенос из «Вотчины»).

/** Русский: 1 нить, 2 нити, 5 нитей; 11–14 — «много», 21 — снова «один». */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

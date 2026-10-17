// Закрепить прошедшие дни календаря картинок дня (решение владельца 17.10.2026, issue 87;
// docs/09-content.md, §9). Перед правкой карточек, которая сдвигает календарь (новое «да»,
// `season`, `day`, правило календаря, пересборка с другим размером), ассистент закрепляет дни по
// завтрашний по Москве: у игроков восточнее он уже наступил.
//
//   bun tools/content/calendar.ts                   какие дни добавятся
//   bun tools/content/calendar.ts --write           и дописать их в content/calendar.yaml
//   bun tools/content/calendar.ts --to 2026-10-20   по эту дату, а не по завтрашний день
//
// Дни — из календаря выпуска (`--release`: картинки с «да»), каким его собирают карточки сейчас,
// до правки: такой он в APK у игроков. Закреплённые раньше дни остаются как были.
import { writeFileSync } from 'node:fs';
import { addDays, daysBetween } from '../../src/engine/dates';
import type { CalendarDay } from '../../src/engine/library';
import { buildAll, FIXED_DAYS, readFixedDays } from './build';

const HEADER = `# Закреплённые дни календаря картинок дня (решение владельца 17.10.2026, issue 87): у игроков
# они уже прошли, и сборка их не трогает — продолжает календарь со следующего дня
# (docs/09-content.md, §9). Дописывает bun tools/content/calendar.ts --write перед правкой
# карточек, которая сдвигает календарь. В PR выпуска 1.0 файл начинается заново — с дня выхода,
# вместе с calendar_from в content/pack.yaml (docs/05-process.md, «Первый каталог»).
`;

/** Файл закреплённых дней: дата → картинка, по порядку. */
export function fixedYaml(days: readonly CalendarDay[]): string {
  return `${HEADER}${days.map((d) => `${d.date}: ${d.picture}\n`).join('')}`;
}

/** Завтрашний день по Москве (UTC+3), «ГГГГ-ММ-ДД». */
export function tomorrowMoscow(now = Date.now()): string {
  return addDays(new Date(now + 3 * 3600_000).toISOString().slice(0, 10), 1);
}

async function main() {
  const args = process.argv.slice(2);
  const to = args.includes('--to') ? args[args.indexOf('--to') + 1] : tomorrowMoscow();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to ?? '')) throw new Error(`--to: нужна дата ГГГГ-ММ-ДД, а не «${to}»`);
  const r = await buildAll({ release: true });
  if (r.failed.length) throw new Error(`сборка с ошибками: ${r.failed.map((f) => f.path).join(', ')}`);
  const from = r.meta.calendar_from ?? r.meta.created;
  const had = readFixedDays(from);
  if (had.length && to < had.at(-1)!.date) throw new Error(`дни уже закреплены по ${had.at(-1)!.date} — позже ${to}`);
  const days = r.calendar.filter((d) => d.date <= to);
  if (days.length !== daysBetween(from, to) + 1) throw new Error(`календарь выпуска кончается ${r.calendar.at(-1)?.date} — раньше ${to}`);
  const fresh = days.slice(had.length);
  console.log(`Закреплено: ${had.length} дн.${had.length ? ` (${from} — ${had.at(-1)!.date})` : ''}; добавится ${fresh.length}:`);
  for (const d of fresh) console.log(`  ${d.date}: ${d.picture}`);
  if (args.includes('--write') && fresh.length) {
    writeFileSync(FIXED_DAYS, fixedYaml(days));
    console.log(`записано: ${FIXED_DAYS.replace(/^.*\/content\//, 'content/')}, ${days.length} дн. по ${to}`);
  }
}

if (import.meta.main) await main();

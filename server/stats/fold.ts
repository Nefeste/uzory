// Свёртка журнала каталога (docs/04-data-model.md, «Счётчики на сервере»; docs/05-process.md,
// «Счётчики»; ADR 0012). Журнал nginx для /uzory/v1/catalog.json пишется без адресов и
// заголовков — только время, строка запроса и код ответа:
//
//   2026-10-12T08:15:02+03:00 "/uzory/v1/catalog.json?v=1.0.0&s=rustore&c=2026-10-05&d=3&p=0&f=2&m=3" 200
//
// Раз в сутки (таймер на сервере) строки законченных дней, которых в таблице ещё нет,
// сворачиваются в суммы `date,v,s,c,d,p,f,m,count`, а строки старше семи дней удаляются.
// Значения проверяются строго: в таблицу не попадает ничего, кроме известных корзин, —
// чужая строка запроса не пронесёт в неё ни текста, ни адреса.
//
//   bun server/stats/fold.ts --log /var/log/nginx/uzory-catalog.log --csv /srv/gornitsa/uzory/stats/stats.csv
//
// После перезаписи журнала nginx должен открыть файл заново: `nginx -s reopen` в том же
// таймере (server/stats/README.md).
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export const HEADER = 'date,v,s,c,d,p,f,m,count';
const KEEP_DAYS = 7;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CHECK: Record<string, RegExp> = {
  v: /^\d{1,4}\.\d{1,4}\.\d{1,4}$/,
  s: /^(rustore|apk|web)$/,
  c: DATE,
  d: /^([0-7]|8-13|14-29|30-59|60\+)$/,
  p: /^[01]$/,
  f: /^[0-4]$/,
  m: /^[0-5]$/,
};
const KEYS = ['v', 's', 'c', 'd', 'p', 'f', 'm'] as const;
const LINE = /^(\d{4}-\d{2}-\d{2})T\S* "([^"]*)" (\d{3})$/;

/** Строка журнала → день и ключ сумм; повтор без счётчиков, ошибка, мусор — null. */
export function parseLine(line: string): { date: string; key: string } | null {
  const m = LINE.exec(line.trim());
  if (!m || (m[3] !== '200' && m[3] !== '304')) return null;
  const [path, query = ''] = m[2].split('?', 2);
  if (path !== '/uzory/v1/catalog.json' || !query) return null;
  const got = new Map<string, string>();
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 1) return null;
    let value: string;
    try {
      value = decodeURIComponent(part.slice(eq + 1));
    } catch {
      return null;
    }
    const k = part.slice(0, eq);
    if (!(k in CHECK) || got.has(k) || !CHECK[k].test(value)) return null;
    got.set(k, value);
  }
  if (got.size !== KEYS.length) return null;
  return { date: m[1], key: KEYS.map((k) => got.get(k)).join(',') };
}

/** День строки журнала — или null, если строка не начинается с даты. */
const dayOf = (line: string) => (DATE.test(line.slice(0, 10)) ? line.slice(0, 10) : null);

/**
 * Суммы по законченным дням (до `today`), которых нет в `have`: строки CSV без заголовка,
 * по дням и ключам.
 */
export function fold(lines: readonly string[], have: ReadonlySet<string>, today: string): { rows: string[]; dates: string[] } {
  const sums = new Map<string, number>();
  for (const line of lines) {
    const r = parseLine(line);
    if (!r || r.date >= today || have.has(r.date)) continue;
    const k = `${r.date},${r.key}`;
    sums.set(k, (sums.get(k) ?? 0) + 1);
  }
  const rows = [...sums.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, n]) => `${k},${n}`);
  return { rows, dates: [...new Set(rows.map((r) => r.slice(0, 10)))] };
}

/** Строки журнала не старше `days` дней до `today`; строки без даты — прочь. */
export function keepRecent(lines: readonly string[], today: string, days = KEEP_DAYS): string[] {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
  return lines.filter((l) => {
    const d = dayOf(l);
    return d !== null && d >= from;
  });
}

/** Дни, уже свёрнутые в таблицу. */
export function csvDates(csv: string): Set<string> {
  return new Set(csv.split('\n').slice(1).map((l) => l.slice(0, 10)).filter((d) => DATE.test(d)));
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.main) {
  const log = arg('--log');
  const csv = arg('--csv');
  if (!log || !csv) {
    console.error('bun server/stats/fold.ts --log <журнал> --csv <таблица> [--today ГГГГ-ММ-ДД]');
    process.exit(2);
  }
  // сегодня — по часам сервера в Москве, как и время в журнале
  const today = arg('--today') ?? new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  const old = existsSync(csv) ? readFileSync(csv, 'utf8') : `${HEADER}\n`;
  const { rows, dates } = fold(lines, csvDates(old), today);
  if (rows.length) writeFileSync(csv, `${old.endsWith('\n') ? old : `${old}\n`}${rows.join('\n')}\n`);
  const kept = keepRecent(lines, today);
  if (kept.length !== lines.length) {
    writeFileSync(`${log}.tmp`, kept.length ? `${kept.join('\n')}\n` : '');
    renameSync(`${log}.tmp`, log);
  }
  console.log(`свёрнуто дней: ${dates.length}${dates.length ? ` (${dates.join(', ')})` : ''}; строк журнала: ${lines.length} → ${kept.length}`);
}

// Итоги закрытого теста (docs/specs/2026-09-v1.md, «Закрытый тест» и «Ворота выпуска 1.0»): отчёты
// «Сообщить об ошибке» складываются в «сессии без сбоев» и «законченные картинки». Строки отчёта
// разбираются по тем же подписям, которыми их пишет игра (src/i18n, src/state/report.ts):
// поменяется подпись — упадёт tools/test/reports.test.ts.
//
//   bun tools/reports/tally.ts отчёты/*.txt
//
// Один файл — один тестировщик: телефон в отчёте — только система и её версия («android 33»), по ней
// людей не различить. В файле может быть несколько отчётов — счёт копится с первого запуска, поэтому
// берётся отчёт, где запусков больше всего.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { T } from '../../src/i18n';

/** Ворота выпуска 1.0, п. 2. */
export const GATE_FINISHED = 200;
export const GATE_CLEAN = 0.995;

export interface Parsed {
  version: string;
  build: number;
  device: string | null;
  /** «5 октября»: год в отчёт не пишется */
  since: string | null;
  done: number | null;
  unclean: number | null;
  finished: number | null;
}

const L = T.report.labels;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const VERSION = new RegExp(`^${esc(L.version)}: (\\S+) \\((\\d+)\\)$`, 'gm');
const DEVICE = new RegExp(`^${esc(L.device)}: (.+)$`, 'm');
const FINISHED = new RegExp(`^${esc(L.finished(7000003)).replace('7000003', '(\\d+)')}$`, 'm');
// «Запусков с 5 октября: 143, из них оборвались: 1»: шаблон — из самой подписи; день — её первая цифра
const SESSIONS = (() => {
  const s = L.sessions('2026-03-01', 7000001, 7000002);
  const at = s.search(/\d/);
  const date = /^\d{1,2} \p{L}+/u.exec(s.slice(at))![0];
  const tail = esc(s.slice(at + date.length)).replace('7000001', '(\\d+)').replace('7000002', '(\\d+)');
  return new RegExp(`^${esc(s.slice(0, at))}(\\d{1,2} \\p{L}+)${tail}$`, 'mu');
})();

/** Все отчёты из текста: каждый начинается строкой версии (раздел «Что случилось» перед ней не нужен). */
export function parseReports(text: string): Parsed[] {
  const t = text.replace(/\r\n?/g, '\n');
  const heads = [...t.matchAll(VERSION)];
  return heads.map((h, i) => {
    const part = t.slice(h.index, heads[i + 1]?.index ?? t.length);
    const s = SESSIONS.exec(part);
    const f = FINISHED.exec(part);
    return {
      version: h[1],
      build: Number(h[2]),
      device: DEVICE.exec(part)?.[1].trim() ?? null,
      since: s ? s[1] : null,
      done: s ? Number(s[2]) : null,
      unclean: s ? Number(s[3]) : null,
      finished: f ? Number(f[1]) : null,
    };
  });
}

export interface Tester {
  name: string;
  reports: number;
  /** отчёт, где запусков больше всего; null — отчёта в файле не нашлось */
  last: Parsed | null;
}

export function tester(name: string, text: string): Tester {
  const all = parseReports(text);
  const last = all.reduce<Parsed | null>((best, r) => (!best || (r.done ?? -1) > (best.done ?? -1) ? r : best), null);
  return { name, reports: all.length, last };
}

export interface Totals {
  testers: number;
  /** у кого счёт запусков прочитался */
  counted: number;
  done: number;
  unclean: number;
  /** доля сессий без сбоев; null — ни одного запуска */
  clean: number | null;
  finished: number;
  cleanOk: boolean;
  finishedOk: boolean;
}

export function totals(list: readonly Tester[]): Totals {
  let done = 0;
  let unclean = 0;
  let finished = 0;
  let counted = 0;
  for (const t of list) {
    if (t.last?.done !== null && t.last?.done !== undefined) {
      counted++;
      done += t.last.done;
      unclean += t.last.unclean ?? 0;
    }
    finished += t.last?.finished ?? 0;
  }
  const clean = done ? (done - unclean) / done : null;
  return { testers: list.length, counted, done, unclean, clean, finished, cleanOk: clean !== null && clean >= GATE_CLEAN, finishedOk: finished >= GATE_FINISHED };
}

// вниз, а не по правилам округления: 99,46 % — не «99,5 %»
const pct = (x: number) => `${(Math.floor(x * 1000 + 1e-9) / 10).toFixed(1).replace('.', ',')} %`;
const n = (x: number | null | undefined) => (x === null || x === undefined ? '—' : String(x));

/** Итог для владельца — таблица в Markdown. */
export function summary(list: readonly Tester[]): string {
  const s = totals(list);
  const rows = list.map((t) => {
    const r = t.last;
    const more = t.reports > 1 ? ` (последний из ${t.reports})` : '';
    if (!r) return `| ${t.name} | отчёта нет | | | | | |`;
    return `| ${t.name}${more} | ${r.version} (${r.build}) | ${r.device ?? '—'} | ${r.since ?? 'счёта нет'} | ${n(r.done)} | ${n(r.unclean)} | ${n(r.finished)} |`;
  });
  const clean = s.clean === null
    ? 'Сессии без сбоев: запусков в отчётах нет'
    : `Сессии без сбоев: ${s.done - s.unclean} из ${s.done} — ${pct(s.clean)} (ворота: не меньше ${pct(GATE_CLEAN)}) — ${s.cleanOk ? 'да' : 'нет'}`;
  const fin = `Законченных картинок: ${s.finished} (ворота: не меньше ${GATE_FINISHED}) — ${s.finishedOk ? 'да' : `нет, не хватает ${GATE_FINISHED - s.finished}`}`;
  return [
    `Тестировщиков: ${s.testers}, со счётом запусков: ${s.counted}`,
    '',
    '| Тестировщик | Версия | Телефон | Счёт с | Запусков | Оборвались | Законченных |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
    clean,
    fin,
    '',
    'Потерянные работы и «не нашла последнюю клетку» — из того, что люди написали: в отчёте их нет.',
  ].join('\n');
}

if (import.meta.main) {
  const files = process.argv.slice(2);
  if (!files.length) throw new Error('нужны файлы с отчётами: один файл — один тестировщик');
  console.log(summary(files.map((f) => tester(basename(f).replace(/\.[^.]+$/, ''), readFileSync(f, 'utf8')))));
}

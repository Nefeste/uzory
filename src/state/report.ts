// из votchina: src/state/report.ts @ 1242776
// Отчёт об ошибке (перенос из «Вотчины»): один текст, который игрок видит целиком до
// отправки. Уходит только его руками — через «Поделиться»; письмо на адрес поддержки —
// когда будет ящик на российском сервисе (docs/07-roadmap.md, В11).
import type { CrashEntry } from './crashlog';

export interface ReportInput {
  what: string;
  version: string;
  build: number;
  device: string;
  screen: string;
  /** с какого дня считаем, сколько сессий прошло и сколько из них оборвались (src/engine/sessions.ts); null — не прочитались */
  sessions?: { since: string; done: number; unclean: number } | null;
  /** сколько работ закончено; null — список работ не прочитался */
  finished?: number | null;
  log: CrashEntry[] | null;
  labels: {
    what: string; version: string; device: string; screen: string; log: string; noLog: string; logUnread: string;
    sessions: (since: string, done: number, unclean: number) => string; sessionsUnread: string;
    finished: (n: number) => string;
  };
}

export const REPORT_MAX = 8000;
export const REPORT_LOG = 10;

const time = (t: number) => new Date(t).toISOString().replace('T', ' ').slice(0, 19);

export function buildReport(r: ReportInput): string {
  const L = r.labels;
  const log = r.log === null ? L.logUnread
    : !r.log.length ? L.noLog
    : r.log.slice(-REPORT_LOG).map((e) => `[${time(e.at)} ${e.kind}] ${e.message}`).join('\n\n');
  // запуски и законченные — для закрытого теста (docs/specs/2026-09-v1.md, «Ворота выпуска 1.0»)
  const sessions = r.sessions === undefined ? '' : r.sessions === null ? L.sessionsUnread
    : L.sessions(r.sessions.since, r.sessions.done, r.sessions.unclean);
  const finished = r.finished === undefined || r.finished === null ? '' : L.finished(r.finished);
  const text = [
    r.what.trim() ? `${L.what}\n${r.what.trim()}` : '',
    `${L.version}: ${r.version} (${r.build})`,
    `${L.device}: ${r.device}`,
    `${L.screen}: ${r.screen}`,
    [sessions, finished].filter(Boolean).join('\n'),
    `${L.log}:\n${log}`,
  ].filter(Boolean).join('\n\n');
  return text.length > REPORT_MAX ? `${text.slice(0, REPORT_MAX - 1)}…` : text;
}

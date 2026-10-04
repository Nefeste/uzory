// Итоги закрытого теста (tools/reports/tally.ts): отчёт, который пишет игра, разбирается обратно
// теми же подписями — запуски, оборвавшиеся, законченные картинки; суммы сверяются с воротами 1.0.
import { describe, expect, test } from 'bun:test';
import { T } from '../../src/i18n';
import { buildReport, type ReportInput } from '../../src/state/report';
import { GATE_FINISHED, parseReports, summary, tester, totals } from '../reports/tally';

const base: ReportInput = { what: '', version: '0.14.3', build: 42, device: 'android 33', screen: 'home', log: [], labels: T.report.labels };
const report = (done: number, unclean: number, finished: number, since = '2026-10-05', what = '') =>
  buildReport({ ...base, what, sessions: { since, done, unclean }, finished });

describe('итоги закрытого теста', () => {
  test('отчёт игры разбирается обратно: версия, телефон, с какого дня счёт, запуски, оборвавшиеся, законченные', () => {
    expect(parseReports(report(143, 1, 12))).toEqual([
      { version: '0.14.3', build: 42, device: 'android 33', since: '5 октября', done: 143, unclean: 1, finished: 12 },
    ]);
    // все месяцы — подписью игры
    for (let m = 1; m <= 12; m++) {
      const since = `2026-${String(m).padStart(2, '0')}-28`;
      expect(parseReports(report(1, 0, 0, since))[0].since).toBe(T.report.labels.sessions(since, 0, 0).match(/28 \S+/u)![0].replace(/:$/, ''));
    }
  });

  test('в файле несколько отчётов — берётся тот, где запусков больше; «Что случилось» и журнал не мешают', () => {
    const text = [report(40, 0, 3, '2026-10-05', 'Не нашла последнюю клетку\nЗаконченных картинок: 99'), report(90, 1, 7), '\r\n'].join('\n\n');
    const t = tester('Анна', text);
    expect(t.reports).toBe(2);
    expect(t.last).toMatchObject({ done: 90, unclean: 1, finished: 7 });
  });

  test('счёт не прочитался или отчёт до 0.14.0 — запусков нет, законченные считаются, если есть', () => {
    const unread = buildReport({ ...base, sessions: null, finished: 4 });
    expect(parseReports(unread)[0]).toMatchObject({ since: null, done: null, unclean: null, finished: 4 });
    expect(tester('Пусто', 'спасибо, всё хорошо').last).toBeNull();
  });

  test('суммы и ворота: без сбоев — не меньше 99,5 %, законченных — не меньше 200', () => {
    const ok = [tester('А', report(600, 2, 120)), tester('Б', report(400, 3, 80))];
    expect(totals(ok)).toMatchObject({ testers: 2, counted: 2, done: 1000, unclean: 5, finished: 200, cleanOk: true, finishedOk: true });
    const bad = [tester('А', report(600, 4, 120)), tester('Б', report(399, 2, GATE_FINISHED - 121))];
    const s = totals(bad);
    expect(s.clean! < 0.995).toBe(true);
    expect([s.cleanOk, s.finishedOk]).toEqual([false, false]);
    const text = summary(bad);
    // 993 из 999 = 99,399… % — вниз, не «99,4 %» с округлением вверх
    expect(text).toContain('Сессии без сбоев: 993 из 999 — 99,3 % (ворота: не меньше 99,5 %) — нет');
    expect(text).toContain('Законченных картинок: 199 (ворота: не меньше 200) — нет, не хватает 1');
    expect(summary(ok)).toContain('99,5 % (ворота: не меньше 99,5 %) — да');
  });
});

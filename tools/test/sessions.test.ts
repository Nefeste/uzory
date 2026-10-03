// Запуски и сбои для закрытого теста (src/engine/sessions.ts; docs/specs/2026-09-v1.md, «Ворота
// выпуска 1.0»): сессия, не ушедшая в фон до следующего запуска, считается оборвавшейся.
import { describe, expect, test } from 'bun:test';
import { normalizeSessions, sessionEnd, sessionStart, sessionTotals } from '../../src/engine/sessions';
import { T } from '../../src/i18n';
import { buildReport, type ReportInput } from '../../src/state/report';

const today = '2026-10-05';

describe('запуски и сбои', () => {
  test('первый запуск: считаем с сегодня, идущая сессия — не в счёте', () => {
    const s = sessionStart(normalizeSessions(null, today));
    expect(s).toEqual({ since: today, starts: 1, unclean: 0, open: true });
    expect(sessionTotals(s)).toEqual({ done: 0, unclean: 0 });
  });

  test('ушла в фон и вернулась — сессия закончилась как положено', () => {
    const s = sessionStart(sessionEnd(sessionStart(normalizeSessions(null, today))));
    expect(s).toEqual({ since: today, starts: 2, unclean: 0, open: true });
    expect(sessionTotals(sessionEnd(s))).toEqual({ done: 2, unclean: 0 });
  });

  test('не ушла в фон до следующего запуска — оборвалась', () => {
    const crashed = sessionStart(normalizeSessions(null, today));
    const next = sessionStart(crashed);
    expect(next.unclean).toBe(1);
    expect(sessionTotals(next)).toEqual({ done: 1, unclean: 1 });
    // закрытая дважды — одна сессия
    expect(sessionEnd(sessionEnd(next))).toEqual(sessionEnd(next));
  });

  test('испорченная запись — счёт с сегодня; оборвавшихся не больше, чем запусков', () => {
    expect(normalizeSessions({ since: 'вчера', starts: -3, unclean: 'много', open: 'да' }, today))
      .toEqual({ since: today, starts: 0, unclean: 0, open: false });
    expect(normalizeSessions({ since: '2026-09-01', starts: 5, unclean: 9, open: true }, today))
      .toEqual({ since: '2026-09-01', starts: 5, unclean: 5, open: true });
  });
});

describe('отчёт об ошибке', () => {
  const base: ReportInput = { what: '', version: '0.14.0', build: 1, device: 'android 29', screen: 'home', log: [], labels: T.report.labels };

  test('запуски, оборвавшиеся и законченные картинки — строками перед журналом', () => {
    const text = buildReport({ ...base, sessions: { since: '2026-10-05', done: 143, unclean: 1 }, finished: 12 });
    expect(text).toContain('Запусков с 5 октября: 143, из них оборвались: 1\nЗаконченных картинок: 12\n\nПоследние ошибки');
  });

  test('счёт не прочитался — так и сказано; не передан — строки нет', () => {
    expect(buildReport({ ...base, sessions: null, finished: null })).toContain('Запуски: счёт не прочитался');
    const plain = buildReport(base);
    expect(plain).not.toContain('Запуск');
    expect(plain).not.toContain('Законченных');
  });
});

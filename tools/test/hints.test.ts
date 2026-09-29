// Подсказки первой картинки и запись игрока (docs/specs/2026-09-first-picture.md, «Первый запуск»,
// «Данные», «Неудачные случаи»).
import { describe, expect, test } from 'bun:test';
import { currentHint, HINT_HALF, HINT_TAPS, HINT_WHERE_LEFT, type HintId, hintsAfter, hintsPassed, strokeAction } from '../../src/engine/hints';
import { normalizePlayer } from '../../src/engine/player';

describe('подсказки', () => {
  const at = (done: HintId[], taps = 0, percent = 0, left = 50) => currentHint({ done, taps, percent, left });

  test('первая картинка по порядку: касание → кисть → два пальца → «Где ещё?»', () => {
    let done: HintId[] = [];
    // открыли экран — «коснитесь клетки»; касание её снимает
    expect(at(done)).toBe('start');
    done = hintsAfter(done, 'tap');
    expect(at(done, 1)).toBeNull();
    // пять стежков касаниями — про кисть; штрих кистью её снимает
    expect(at(done, HINT_TAPS - 1)).toBeNull();
    expect(at(done, HINT_TAPS)).toBe('brush');
    done = hintsAfter(done, 'brush');
    expect(at(done, HINT_TAPS)).toBeNull();
    // половина вышита — про два пальца; приблизили — ушла
    expect(at(done, HINT_TAPS, HINT_HALF - 1)).toBeNull();
    expect(at(done, HINT_TAPS, HINT_HALF)).toBe('zoom');
    done = hintsAfter(done, 'camera');
    // у нити осталось меньше десяти клеток — про «Где ещё?»; нажали — подсказок больше нет
    expect(at(done, HINT_TAPS, 70, HINT_WHERE_LEFT)).toBeNull();
    expect(at(done, HINT_TAPS, 70, HINT_WHERE_LEFT - 1)).toBe('where');
    done = hintsAfter(done, 'where');
    expect(at(done, HINT_TAPS, 90, 1)).toBeNull();
    expect(done).toEqual(['start', 'brush', 'zoom', 'where']);
  });

  test('кто сделал раньше подсказки — её не увидит', () => {
    // сразу провели кистью: и «коснитесь», и «проведите» не нужны
    const done = hintsAfter([], 'brush');
    expect(done).toEqual(['start', 'brush']);
    expect(at(done, HINT_TAPS + 3)).toBeNull();
    // приблизили до половины — про два пальца не будет
    expect(at(hintsAfter(done, 'camera'), 0, 80)).toBeNull();
  });

  test('подсказка, которую не на чем выполнить, уступает следующей и больше не возвращается', () => {
    // узор целиком на экране: приближать незачем, а нить почти вышита
    const done: HintId[] = ['start', 'brush'];
    expect(at(done, 9, 60, 50)).toBe('zoom');
    expect(at(done, 9, 60, 5)).toBe('where');
    const after = hintsPassed(done, 'zoom', 'where');
    expect(after).toEqual(['start', 'brush', 'zoom']);
    // нить сменили — «Где ещё?» ушла без смены другой: не сделана, вернётся у следующей нити
    expect(hintsPassed(after, 'where', null)).toEqual(after);
    expect(at(after, 9, 60, 50)).toBeNull();
  });

  test('касание или кисть — по числу клеток во всём штрихе', () => {
    expect(strokeAction(1)).toBe('tap');
    expect(strokeAction(0)).toBe('tap');
    expect(strokeAction(2)).toBe('brush');
  });
});

describe('игрок', () => {
  test('первый запуск: календарь — с сегодняшнего дня, подсказки — сначала', () => {
    expect(normalizePlayer(null, '2026-10-05')).toEqual({
      installed: '2026-10-05', seen: '2026-10-05', pinned: {}, firstDone: false, hints: [],
    });
  });

  test('испорченная запись приводится в порядок, а не роняет игру', () => {
    const p = normalizePlayer({
      installed: '2026-02-30', seen: 'вчера', pinned: { '2026-10-01': 'a', 'x': 'b', '2026-10-02': 7 },
      firstDone: 'да', hints: ['zoom', 'nope', 'start', 'zoom'],
    }, '2026-10-05');
    expect(p).toEqual({ installed: '2026-10-05', seen: '2026-10-05', pinned: { '2026-10-01': 'a' }, firstDone: false, hints: ['start', 'zoom'] });
  });

  test('`seen` только растёт: часы назад не отнимают виденных дней', () => {
    const p = normalizePlayer({ installed: '2026-09-20', seen: '2026-10-09', firstDone: true, hints: ['start'] }, '2026-10-05');
    expect(p.seen).toBe('2026-10-09');
    expect(p.installed).toBe('2026-09-20');
    expect(p.firstDone).toBe(true);
    // и дата раньше дня установки — не раньше него
    expect(normalizePlayer({ installed: '2026-09-20' }, '2026-09-01').seen).toBe('2026-09-20');
  });
});

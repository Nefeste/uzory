// Музыка экрана вышивания (docs/08-game-design.md, «Звук и музыка»): пьесы по кругу в случайном
// порядке, начало — тихое нарастание. Здесь — только счёт: порядок круга и громкость нарастания;
// проигрыватель — src/state/music.ts, список пьес — assets/music/music.yaml.

/** Пьеса: подписи — для «О программе», `source` — файл для проигрывателя (require). */
export interface Track {
  id: string;
  title: string;
  composer: string;
  performer: string;
  /** «PD» — исполнитель отдал запись в общественное достояние; «CC0»; «CC BY 3.0» */
  license: string;
  /** где сказано про лицензию записи */
  page: string;
  source: number | string;
}

/**
 * Следующий круг: все `n` пьес в случайном порядке, каждая по разу. Первая — не та, что звучала
 * последней (`last`), иначе на стыке кругов пьеса прозвучала бы дважды подряд.
 */
export function shuffleRound(n: number, rand: () => number, last: number | null = null): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rand() * (i + 1)));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (n > 1 && out[0] === last) [out[0], out[n - 1]] = [out[n - 1], out[0]];
  return out;
}

/**
 * Громкость через `t` мс после начала перехода длиной `ms` от `from` к `to`. Ухо слышит
 * громкость логарифмически, поэтому нарастание — по квадрату: первые секунды почти тихо.
 */
export function fadeLevel(t: number, ms: number, from: number, to: number): number {
  if (ms <= 0 || t >= ms) return to;
  if (t <= 0) return from;
  const k = t / ms;
  return from + (to - from) * (to > from ? k * k : 1 - (1 - k) * (1 - k));
}

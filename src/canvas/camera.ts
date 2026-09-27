// Камера канвы: масштаб — размер клетки в dp, сдвиг — где на экране левый верхний угол
// узора. Числа масштабов — docs/08-game-design.md, «Масштабы». Все функции — ворклеты.

/** С этого размера клетки видны номера и работает кисть. */
export const NUMBERS_DP = 18;
/** Масштаб открытия; «Крупные номера» — крупнее. */
export const OPEN_DP = 28;
export const OPEN_BIG_DP = 36;
/** Ближе всего. */
export const MAX_DP = 64;
/** Поля вокруг узора, когда он виден целиком. */
export const MARGIN_DP = 12;

export interface Camera {
  s: number;
  tx: number;
  ty: number;
}

/** Масштаб «весь узор на экране с полями» — он же самый дальний. */
export function fitScale(w: number, h: number, vw: number, vh: number): number {
  'worklet';
  return Math.min(MAX_DP, Math.max(1, (vw - 2 * MARGIN_DP) / w), Math.max(1, (vh - 2 * MARGIN_DP) / h));
}

export function clampScale(s: number, w: number, h: number, vw: number, vh: number): number {
  'worklet';
  return Math.min(MAX_DP, Math.max(fitScale(w, h, vw, vh), s));
}

/** Канву нельзя увести за край дальше половины экрана. */
export function clampX(tx: number, s: number, w: number, vw: number): number {
  'worklet';
  return Math.min(vw / 2, Math.max(vw / 2 - w * s, tx));
}

export function clampY(ty: number, s: number, h: number, vh: number): number {
  'worklet';
  return Math.min(vh / 2, Math.max(vh / 2 - h * s, ty));
}

/** Камера, при которой клетка (cx, cy) — в центре экрана при масштабе s. */
export function centerOn(cx: number, cy: number, s: number, vw: number, vh: number): Camera {
  'worklet';
  return { s, tx: vw / 2 - cx * s, ty: vh / 2 - cy * s };
}

/**
 * Камера открытия: малая картинка, которая целиком помещается в рабочем масштабе, —
 * целиком; иначе — масштаб открытия там, где вышивали в прошлый раз, или в центре.
 */
export function openCamera(w: number, h: number, vw: number, vh: number, big: boolean, at?: { x: number; y: number }): Camera {
  'worklet';
  const fit = fitScale(w, h, vw, vh);
  if (fit >= NUMBERS_DP) return centerOn(w / 2, h / 2, fit, vw, vh);
  const s = big ? OPEN_BIG_DP : OPEN_DP;
  const c = at ?? { x: w / 2, y: h / 2 };
  return { s, tx: clampX(vw / 2 - c.x * s, s, w, vw), ty: clampY(vh / 2 - c.y * s, s, h, vh) };
}

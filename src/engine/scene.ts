// Сцена готовой работы на «Готово» (0.21.0; владелец 01.11.2026: «делай А, Б, В, Г и Д»): где рама или
// пяльцы, паспарту, ткань с работой, гвоздь и бечёвка, если работа висит на стене. Рисует src/render/scene.ts,
// раскладывает и «Поделиться» (src/engine/share.ts) — по тем же правилам, в точках картинки.
// Чистый TypeScript: без React, платформы, времени и случайности (ADR 0002, 0010).

export interface Rect { x: number; y: number; w: number; h: number }

/** Что за сцена: узор (клеток, с подписью мастерицы, если она есть) и оформление. */
export interface SceneSpec {
  w: number;
  h: number;
  /** пяльцы — круг ткани в ободе; иначе рама со скосом */
  hoop: boolean;
  /** паспарту — бумага между рамой и тканью; у пялец его нет */
  mat: boolean;
  /** работа висит на стене: над рамой — гвоздь и бечёвка, у пялец — лента */
  hang: boolean;
  /** резная рама — шире: на ней розетки по углам */
  carved: boolean;
}

/** Размеры сцены «Готово», dp. */
export const STAGE = {
  /** рама со скосом и резная */
  frame: 8,
  carved: 18,
  /** паспарту */
  mat: 18,
  /** обод пялец */
  hoop: 12,
  /** место над рамой под гвоздь и бечёвку */
  hang: 34,
  /** рама с работой — не больше этой доли сцены: вокруг неё стена или фон, а не край экрана */
  fill: 0.86,
} as const;

export interface StageLayout {
  /** точек на клетку работы */
  s: number;
  /** ткань: работа с полем канвы вокруг — место канвы с работой; у пялец — квадрат вокруг круга ткани */
  cloth: Rect;
  /** паспарту — внешний край; без паспарту и у пялец — как ткань */
  mat: Rect;
  /** рама — внешний край; у пялец — квадрат вокруг обода */
  frame: Rect;
  /** гвоздь; нет — работа не висит */
  nail?: { x: number; y: number };
}

/**
 * Раскладка сцены `area` × `areaH` (dp): клетка — не больше `maxCell`, поле канвы вокруг узора — `margin`.
 * Рама — по середине; если работа висит, сцена сдвигается вниз на место гвоздя. У пялец узор целиком внутри
 * круга: его диагональ — поперёк круга, с полями.
 */
export function stageLayout(spec: SceneSpec, areaW: number, areaH: number, maxCell: number, margin: number): StageLayout {
  const hang = spec.hang ? STAGE.hang : 0;
  const aw = areaW * STAGE.fill;
  const ah = areaH * STAGE.fill - hang;
  if (spec.hoop) {
    const d = Math.max(1, Math.floor(Math.min(aw, ah) - 2 * STAGE.hoop));
    const s = Math.min(maxCell, (d - 2 * margin) / Math.hypot(spec.w, spec.h));
    const fx = Math.round((areaW - d - 2 * STAGE.hoop) / 2);
    const fy = Math.round((areaH - d - 2 * STAGE.hoop + hang) / 2);
    const cloth = { x: fx + STAGE.hoop, y: fy + STAGE.hoop, w: d, h: d };
    return { s, cloth, mat: cloth, frame: { x: fx, y: fy, w: d + 2 * STAGE.hoop, h: d + 2 * STAGE.hoop }, ...(hang ? { nail: { x: fx + STAGE.hoop + d / 2, y: fy - hang * 0.7 } } : {}) };
  }
  const t = spec.carved ? STAGE.carved : STAGE.frame;
  const m = spec.mat ? STAGE.mat : 0;
  const edge = t + m + margin;
  const s = Math.max(0.5, Math.min(maxCell, (aw - 2 * edge) / spec.w, (ah - 2 * edge) / spec.h));
  const cw = Math.max(1, Math.floor(spec.w * s + 2 * margin));
  const ch = Math.max(1, Math.floor(spec.h * s + 2 * margin));
  const fw = cw + 2 * (t + m);
  const fh = ch + 2 * (t + m);
  const fx = Math.round((areaW - fw) / 2);
  const fy = Math.round((areaH - fh + hang) / 2);
  return {
    s,
    cloth: { x: fx + t + m, y: fy + t + m, w: cw, h: ch },
    mat: { x: fx + t, y: fy + t, w: cw + 2 * m, h: ch + 2 * m },
    frame: { x: fx, y: fy, w: fw, h: fh },
    ...(hang ? { nail: { x: fx + fw / 2, y: fy - hang * 0.7 } } : {}),
  };
}

/** Бечёвка от гвоздя к раме: точки на верхней грани рамы — на четверти ширины от краёв. */
export function twinePoints(frame: Rect): [{ x: number; y: number }, { x: number; y: number }] {
  return [{ x: frame.x + frame.w / 4, y: frame.y + 2 }, { x: frame.x + (frame.w * 3) / 4, y: frame.y + 2 }];
}

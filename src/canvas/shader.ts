// Вся канва — одним шейдером (docs/02-architecture.md, «Канва»): три маленькие текстуры
// данных — клетки, палитра, цифры — и числа камеры. Проверен на CanvasKit в разборе
// (research/feasibility-2026-09/shader.ts): цвета клеток точные.
//
// Координаты `p` приходят уже в клетках: шейдер создаётся с матрицей «клетка → экран».
import { CANVASES, type CanvasLook, type Rgb } from '../engine/looks';

/** Поле за краем узора: та же канва, темнее; в тёмной теме вдали от узора — в тени. */
const FIELD_LIGHT = 0.93;
const FIELD_DARK = 0.3;

/**
 * Порядок и число униформ — как в SKSL ниже; `makeShaderWithChildren` берёт их списком.
 * Дочерние шейдеры — в том же порядке: клетки (W × H: R — нить, G — вышита, B — «возраст»;
 * без сглаживания), палитра (64 × 1, без сглаживания), цифры (10 белых цифр GW × GH,
 * со сглаживанием).
 */
export interface Uniforms {
  w: number;
  h: number;
  /** размер ячейки атласа цифр в точках */
  gw: number;
  gh: number;
  /** точек экрана на клетку — для сглаживания */
  cellPx: number;
  /** 1 — номера и стиль видны (рабочий масштаб), 0 — далеко */
  near: number;
  /** выбранная нить; −1 — нет */
  selected: number;
  mosaic: number;
  hatch: number;
  /** половина зазора «Мозаики», в клетках */
  gap: number;
  /** рамка группы «Где ещё?» в клетках, включительно */
  px0: number;
  py0: number;
  px1: number;
  py1: number;
  /** секунд с начала пульсации; < 0 — нет */
  pulseT: number;
  /** середина экрана и половина его ширины и высоты, в клетках, — для виньетки; vhx = 0 — без неё */
  vx: number;
  vy: number;
  vhx: number;
  vhy: number;
  /** 1 — тёмная тема: поле за краем узора уходит в тень, виньетка сильнее */
  dark: number;
  /** 1 — невышитое без номеров, бледным следом нити по канве: повтор «Как вышивалось» на «Готово» */
  ghost: number;
  /** 1 — «Тайна»: издалека невышитое — чистая канва, без бледного силуэта картинки */
  mystery: number;
  /** канва (оформление, src/engine/looks.ts): нить, тень дырочек и тон невышитого издалека, sRGB 0…1 */
  cloth: Rgb;
  hole: Rgb;
  tone: Rgb;
  /** поле за краем узора — во столько темнее канвы (FIELD_LIGHT); 1 — та же ткань: пяльцы на «Готово» */
  field: number;
}

export function uniformList(u: Uniforms): number[] {
  'worklet';
  return [
    u.w, u.h, u.gw, u.gh, u.cellPx, u.near, u.selected, u.mosaic, u.hatch, u.gap, u.px0, u.py0, u.px1, u.py1, u.pulseT,
    u.vx, u.vy, u.vhx, u.vhy, u.dark, u.ghost, u.mystery,
    u.cloth[0], u.cloth[1], u.cloth[2], u.hole[0], u.hole[1], u.hole[2], u.tone[0], u.tone[1], u.tone[2], u.field,
  ];
}

export interface CanvasUniforms { cloth: Rgb; hole: Rgb; tone: Rgb; field: number }

/**
 * Униформы канвы оформления: кремовая — прежние константы шейдера до точки. `even` — поле за краем узора
 * той же ткани, без затемнения: узор в пяльцах лежит на целом куске канвы.
 */
export function canvasUniforms(c: CanvasLook, even = false): CanvasUniforms {
  'worklet';
  return { cloth: c.cloth, hole: c.hole, tone: c.ghost, field: even ? 1 : FIELD_LIGHT };
}

/** Без виньетки и в светлой теме: мини-карта, картинка «Поделиться», кадры тестов. */
export const NO_SCENE = { vx: 0, vy: 0, vhx: 0, vhy: 0, dark: 0, ghost: 0, mystery: 0 } as const;

/**
 * Поле за краем узора вдали от него — ровным цветом: фон контейнера канвы до первого кадра и путь
 * «слои». Канва × FIELD_LIGHT и × FIELD_DARK из шейдера (tools/test/shader.test.ts сверяет).
 */
export function fieldOf(c: CanvasLook): { light: string; dark: string } {
  const hex = (k: number) => `#${c.cloth.map((v) => Math.round(v * k * 255).toString(16).padStart(2, '0')).join('')}`;
  return { light: hex(FIELD_LIGHT), dark: hex(FIELD_DARK) };
}

/** Поле кремовой канвы — бесплатной, у всех. */
export const FIELD = fieldOf(CANVASES[0]);

/**
 * Шейдер. Цвет номера на невышитой клетке — тёмный, чёрный или белый — выбирается по яркости
 * клетки под ним, посчитанной точно по кривой sRGB (`wcag`): так контраст номера не ниже 4,5 : 1
 * на любой нити и подсветке (docs/08-game-design.md, «Для старшей аудитории»). С приближением
 * степенью 2,2 (`luma`, им считается далёкий вид) у порогов он падал до 4,4 : 1 —
 * tools/test/contrast.test.ts. Внутри строки шейдера — только латиница (tools/test/i18n.test.ts).
 *
 * Крестик — как настоящая вышивка (разбор оформления 31.10.2026: «решётка из белых ромбов», «лента, а не
 * нить»). Плечи стежка — почти до углов клетки и шириной в половину клетки: нить закрывает около 89 %
 * клетки (было около 72 %), канва видна узкими щелями у середин сторон, в тени плеч. Каждое плечо —
 * прядь-цилиндр под одним светом сверху слева: сторона к свету светлее и с мягким бликом, другая — в
 * тени; скрутка идёт наискось к оси, концы у дырочек темнее. Плечи отбрасывают на канву тень вниз и
 * вправо, верхнее — и на нижнее. В середине клетки свет, блик и скрутка сходятся в ноль — там ровно цвет
 * нити (tools/test/shader.test.ts). Мельче 40 точек свет гаснет, а мельче 44 канва между плечами — в тени
 * нити: мелкую клетку глаз смешивает в один цвет, и светлая канва бледнила работу на картинке
 * «Поделиться» (14.10.2026).
 *
 * Канва — аида: в клетке четыре квадратика корзиночного плетения, у каждого две нити с волокнами вдоль,
 * дырочки в углах клетки. Яркость переплетения — от 0,9 до 1,025 цвета канвы: номер на ней держит
 * 4,5 : 1 (tools/test/contrast.test.ts берёт эти числа из шейдера). Издалека на канве с кистью края
 * вышитых клеток чуть темнее, середина — ровно цвет нити: вышивка, а не карта цветов. Законченная работа на
 * «Готово» и картинка «Поделиться» без стежков — ровные клетки (решение владельца 15.10.2026).
 *
 * Сцена: за краем узора — та же канва, темнее (FIELD_LIGHT); в тёмной теме она за 160 точек от узора
 * уходит в тень (FIELD_DARK), и узор лежит как под лампой. Углы экрана темнее — виньетка, у канвы с
 * кистью (`view`); она темнит клетку до выбора цвета номера, поэтому контраст держится и в углах.
 *
 * Повтор «Как вышивалось» (`ghost`): невышитое — без номеров, бледным серым следом нити по канве, как
 * издалека: повтор — ускоренная вышивка, а не схема (разбор оформления 31.10.2026, Б4).
 *
 * «Тайна» (`mystery`, issue 117): издалека невышитое — чистая канва, а не бледный тон своей нити: силуэт
 * картинки не виден, она проявляется вышитыми клетками.
 */
export const SKSL = `
uniform shader cells;
uniform shader palette;
uniform shader digits;
uniform float2 grid;
uniform float2 glyph;
uniform float cellPx;
uniform float near;
uniform float selected;
uniform float mosaic;
uniform float hatch;
uniform float gap;
uniform float4 pulse;
uniform float pulseT;
uniform float4 view;
uniform float dark;
uniform float ghost;
uniform float mystery;
uniform float3 tCloth;
uniform float3 tHole;
uniform float3 tGhost;
uniform float tField;

const half3 TILE = half3(0.925, 0.929, 0.906);
const half3 GAP = half3(0.851, 0.859, 0.820);
const half3 DIGIT = half3(0.231, 0.243, 0.235);
// light from the upper left: its direction in the canvas plane (cells, y down) and towards the viewer
const float2 LXY = float2(-0.30, -0.53);
const float LZ = 0.79;
// field beyond the pattern: the same canvas, darker; in the dark theme it fades into shadow within 160 px
const float FIELD_DARK = ${FIELD_DARK};

half luma(half3 c) {
  half3 l = pow(c, half3(2.2));
  return dot(l, half3(0.2126, 0.7152, 0.0722));
}

half wcag(half3 c) {
  half3 l = mix(c / 12.92, pow((c + 0.055) / 1.055, half3(2.4)), step(half3(0.04045), c));
  return dot(l, half3(0.2126, 0.7152, 0.0722));
}

float hash(float2 q) {
  float3 h = fract(q.xyx * 0.1031);
  h += dot(h, h.yzx + 33.33);
  return fract((h.x + h.y) * h.z);
}

float segDist(float2 p, float2 a, float2 b) {
  float2 pa = p - a;
  float2 ba = b - a;
  float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * t);
}

half3 cloth(float2 p, float aa, float tex) {
  float2 f = fract(p);
  float2 e = min(f, 1.0 - f);
  float2 g = p * 2.0;
  float2 gf = fract(g);
  bool hor = mod(floor(g.x) + floor(g.y), 2.0) < 0.5;
  float across = hor ? gf.y : gf.x;
  float along = hor ? g.x : g.y;
  float lane = hor ? g.y : g.x;
  float yarn = sin(fract(across * 2.0) * 3.1416);
  float dome = 1.0 - 0.8 * dot(gf - 0.5, gf - 0.5);
  float fi = floor(lane * 10.0);
  float s = along * 1.5;
  float fl = floor(s);
  float fib = mix(hash(float2(fi, fl)), hash(float2(fi, fl + 1.0)), smoothstep(0.0, 1.0, s - fl)) - 0.5;
  float k = 0.9 + 0.06 * yarn + 0.04 * dome + 0.05 * fib;
  half3 o = half3(tCloth) * half(mix(1.0, k, tex));
  float d = length(max(e - 0.035, 0.0)) - 0.045;
  float hole = 1.0 - smoothstep(-aa, aa, d);
  return mix(o, half3(tHole), half(hole * 0.9));
}

half3 strand(half3 col, float a, float n, float2 u, float lit) {
  float m = clamp(n, -1.0, 1.0);
  float c = sqrt(1.0 - m * m);
  float side = dot(u, LXY);
  float shade = (0.6 + 0.5 * max(0.0, m * side + c * LZ)) / (0.6 + 0.5 * LZ);
  float twist = sin((a * 4.0 + m * 2.4) * 6.2832);
  float ends = 1.0 - 0.3 * smoothstep(0.5, 0.68, abs(a));
  float x = (m + 0.45 * sign(side)) / 0.3;
  float spec = max(0.0, 1.0 - x * x) * smoothstep(0.0, 0.3, abs(m));
  half3 o = col * half(mix(1.0, shade * ends * (1.0 + 0.07 * twist), lit));
  return mix(o, half3(1.0), half(0.1 * spec * spec * lit));
}

half3 cross(float2 p, float2 f, half3 col, float aa, float tex, float lit, float dense) {
  float e = 0.045;
  float w = 0.235;
  float2 q = f - 0.5;
  float2 u1 = float2(0.7071, -0.7071);
  float2 u2 = float2(0.7071, 0.7071);
  float2 a2 = float2(1.0 - e, e);
  float2 b2 = float2(e, 1.0 - e);
  float d2 = segDist(f, a2, b2);
  float c2 = 1.0 - smoothstep(w - aa, w + aa, d2);
  half3 upper = strand(col, dot(q, float2(-0.7071, 0.7071)), dot(q, u2) / w, u2, lit);
  // inside the upper arm nothing else shows: no canva, shadows or lower arm to compute
  if (c2 >= 1.0) return upper;
  float2 a1 = float2(e, e);
  float2 b1 = float2(1.0 - e, 1.0 - e);
  float d1 = segDist(f, a1, b1);
  float c1 = 1.0 - smoothstep(w - aa, w + aa, d1);
  float2 off = float2(0.035, 0.06);
  float s2 = segDist(f - off, a2, b2);
  half3 o;
  if (c1 >= 1.0) {
    o = strand(col, dot(q, float2(0.7071, 0.7071)), dot(q, u1) / w, u1, lit) * half(mix(0.92, 0.95, dense));
  } else {
    // canva between the arms: in their shade, and in the shadow cast down and right
    float s1 = segDist(f - off, a1, b1);
    float drop = 1.0 - smoothstep(w - 0.05, w + 0.08, min(s1, s2));
    float ao = smoothstep(w, w + 0.18, min(d1, d2));
    o = mix(cloth(p, aa, tex), col * 0.6, half(0.6 * dense));
    o *= half(1.0 - lit * (0.28 * (1.0 - ao) + 0.22 * drop));
    if (c1 > 0.0) {
      half3 lower = strand(col, dot(q, float2(0.7071, 0.7071)), dot(q, u1) / w, u1, lit);
      o = mix(o, lower * half(mix(0.92, 0.95, dense)), half(c1));
    }
  }
  float sh = 1.0 - smoothstep(w - 0.04, w + 0.05, s2);
  o = mix(o, o * 0.7, half(sh * (1.0 - c2) * 0.6 * lit));
  return mix(o, upper, half(c2));
}

half glyphAt(float2 q, float d) {
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return 0.0;
  return digits.eval(float2((d + q.x) * glyph.x, q.y * glyph.y)).a;
}

half number(float2 f, float n, float bold) {
  float tens = floor(n / 10.0);
  float ones = n - tens * 10.0;
  float two = step(9.5, n);
  float gh = 0.70;
  float gw = gh * glyph.x / glyph.y;
  float2 box = float2(gw, gh);
  float2 q1 = (f - float2(0.5 + two * gw * 0.46, 0.5)) / box + 0.5;
  float2 q2 = (f - float2(0.5 - gw * 0.46, 0.5)) / box + 0.5;
  half a = glyphAt(q1, ones);
  if (two > 0.5) a = max(a, glyphAt(q2, tens));
  if (bold > 0.5) {
    float2 o = float2(0.9 / glyph.x, 0.0);
    a = max(a, glyphAt(q1 + o, ones));
    a = max(a, glyphAt(q1 - o, ones));
    if (two > 0.5) {
      a = max(a, glyphAt(q2 + o, tens));
      a = max(a, glyphAt(q2 - o, tens));
    }
  }
  return a;
}

half4 main(float2 p) {
  float2 cell = floor(p);
  float aa = 1.0 / max(cellPx, 1.0);
  float tex = smoothstep(18.0, 44.0, cellPx);
  // vignette: darker screen corners; the number colour below is chosen from the darkened cell
  float vig = 1.0;
  if (view.z > 0.0) {
    float r = length((p - view.xy) / view.zw) * 0.7071;
    vig = 1.0 - mix(0.1, 0.22, dark) * smoothstep(0.45, 1.0, r);
  }
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= grid.x || cell.y >= grid.y) {
    float2 beyond = max(max(-p, p - grid), 0.0);
    float k = mix(tField, FIELD_DARK, dark * smoothstep(0.0, 1.0, length(beyond) * cellPx / 160.0));
    return half4((near < 0.5 || mosaic > 0.5 ? half3(tCloth) : cloth(p, aa, tex)) * half(k * vig), 1.0);
  }
  half4 c = cells.eval(cell + 0.5);
  float idx = floor(c.r * 255.0 + 0.5);
  bool done = c.g > 0.5;
  float2 f = fract(p);
  float lit = smoothstep(16.0, 40.0, cellPx);
  float dense = 1.0 - smoothstep(28.0, 44.0, cellPx);
  if (idx > 254.5) {
    if (near < 0.5) return half4(half3(tCloth) * half(vig), 1.0);
    return half4((mosaic > 0.5 ? half3(tCloth) : cloth(p, aa, tex)) * half(vig), 1.0);
  }
  half3 col = palette.eval(float2(idx + 0.5, 0.5)).rgb;
  bool sel = abs(idx - selected) < 0.5;
  half3 o;
  if (near < 0.5) {
    half g = pow(luma(col), 0.4545);
    // mystery: from afar the cell to come is plain canva, otherwise its pale tone would show the picture
    o = done ? col : (mystery > 0.5 ? half3(tCloth) : mix(half3(tGhost), half3(g), 0.35));
    if (!done && sel) o = mix(o, col, 0.3);
    // texture from afar only on the working canvas (the scene): the finished work on "Done" and
    // the shared picture stay flat cells
    if (done && view.z > 0.0) {
      float2 e = min(f, 1.0 - f);
      float edge = 1.0 - smoothstep(0.0, 0.3, min(e.x, e.y));
      o *= half(1.0 - 0.06 * edge * smoothstep(3.0, 8.0, cellPx));
    }
    return half4(o * half(vig), 1.0);
  }
  float stripe = step(0.5, fract((p.x + p.y) * 2.0));
  if (mosaic > 0.5) {
    float2 e = min(f, 1.0 - f);
    float inside = smoothstep(gap - aa * 0.5, gap + aa * 0.5, min(e.x, e.y));
    half3 tile = done ? col : TILE;
    if (!done && sel) tile = hatch > 0.5 ? mix(tile, col, half(0.45 * stripe)) : mix(tile, col, 0.25);
    o = mix(GAP, tile, half(inside));
  } else {
    if (done) {
      o = cross(p, f, col, aa, tex, lit, dense);
    } else {
      half3 base = cloth(p, aa, tex);
      if (sel) base = hatch > 0.5 ? mix(base, col, half(0.45 * stripe)) : mix(base, col, 0.25);
      o = base;
    }
  }
  o *= half(vig);
  if (!done && ghost > 0.5) {
    // replay: the cell to come is a faint grey print on the canva, as from afar, without its number
    return half4(mix(o, half3(pow(luma(col), 0.4545)), 0.3), 1.0);
  }
  if (!done) {
    half a = number(f, idx + 1.0, sel ? 1.0 : 0.0);
    half l = wcag(o);
    half3 dc = l > 0.39 ? DIGIT : (l > 0.18 ? half3(0.0) : half3(1.0));
    o = mix(o, dc, a);
    if (sel && pulseT >= 0.0 && pulseT < 1.5 && cell.x >= pulse.x && cell.x <= pulse.z && cell.y >= pulse.y && cell.y <= pulse.w) {
      float k = (1.0 - pulseT / 1.5) * (0.5 + 0.5 * sin(pulseT * 12.566));
      o = mix(o, col, half(0.55 * k));
    }
  }
  return half4(o, 1.0);
}
`;

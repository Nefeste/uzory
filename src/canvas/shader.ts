// Вся канва — одним шейдером (docs/02-architecture.md, «Канва»): три маленькие текстуры
// данных — клетки, палитра, цифры — и числа камеры. Проверен на CanvasKit в разборе
// (research/feasibility-2026-09/shader.ts): цвета клеток точные.
//
// Координаты `p` приходят уже в клетках: шейдер создаётся с матрицей «клетка → экран».

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
}

export function uniformList(u: Uniforms): number[] {
  'worklet';
  return [u.w, u.h, u.gw, u.gh, u.cellPx, u.near, u.selected, u.mosaic, u.hatch, u.gap, u.px0, u.py0, u.px1, u.py1, u.pulseT];
}

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

const half3 CLOTH = half3(0.953, 0.941, 0.902);
const half3 OUTSIDE = half3(0.886, 0.890, 0.855);
const half3 HOLE = half3(0.667, 0.643, 0.580);
const half3 GHOST = half3(0.965, 0.965, 0.949);
const half3 TILE = half3(0.925, 0.929, 0.906);
const half3 GAP = half3(0.851, 0.859, 0.820);
const half3 DIGIT = half3(0.231, 0.243, 0.235);

half luma(half3 c) {
  half3 l = pow(c, half3(2.2));
  return dot(l, half3(0.2126, 0.7152, 0.0722));
}

float segDist(float2 p, float2 a, float2 b) {
  float2 pa = p - a;
  float2 ba = b - a;
  float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * t);
}

half3 cloth(float2 f, float aa, float tex) {
  float2 e = min(f, 1.0 - f);
  float hole = 1.0 - smoothstep(0.075, 0.075 + 1.5 * aa, length(e));
  float wv = sin(f.x * 18.85) * sin(f.y * 18.85);
  half3 o = CLOTH * half(0.985 + 0.02 * wv * tex);
  return mix(o, HOLE, half(hole * 0.85));
}

half3 floss(half3 col, float d, float w, float along, float across, float tex) {
  float r = d / w;
  float tw = sin((along * 3.0 + across * 9.0) * 6.2832);
  return col * half((1.0 - 0.30 * r * r) * (1.0 + 0.07 * tw * tex));
}

half3 cross(float2 f, half3 col, half3 base, float aa, float tex) {
  const float e = 0.11;
  const float w = 0.165;
  float d1 = segDist(f, float2(e, e), float2(1.0 - e, 1.0 - e));
  float d2 = segDist(f, float2(1.0 - e, e), float2(e, 1.0 - e));
  float c1 = 1.0 - smoothstep(w - aa, w + aa, d1);
  float c2 = 1.0 - smoothstep(w - aa, w + aa, d2);
  half3 o = base;
  o = mix(o, floss(col, d1, w, f.x + f.y, f.x - f.y, tex) * 0.9, half(c1));
  float sh = 1.0 - smoothstep(w, w + 0.09, d2);
  o = mix(o, o * 0.72, half(sh * (1.0 - c2) * 0.7));
  o = mix(o, floss(col, d2, w, f.x - f.y, f.x + f.y, tex), half(c2));
  return o;
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
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= grid.x || cell.y >= grid.y) return half4(OUTSIDE, 1.0);
  half4 c = cells.eval(cell + 0.5);
  float idx = floor(c.r * 255.0 + 0.5);
  bool done = c.g > 0.5;
  float2 f = fract(p);
  float aa = 1.0 / max(cellPx, 1.0);
  float tex = smoothstep(18.0, 44.0, cellPx);
  if (idx > 254.5) {
    if (near < 0.5) return half4(CLOTH, 1.0);
    return half4(mosaic > 0.5 ? CLOTH : cloth(f, aa, tex), 1.0);
  }
  half3 col = palette.eval(float2(idx + 0.5, 0.5)).rgb;
  bool sel = abs(idx - selected) < 0.5;
  half3 o;
  if (near < 0.5) {
    half g = pow(luma(col), 0.4545);
    o = done ? col : mix(GHOST, half3(g), 0.35);
    if (!done && sel) o = mix(o, col, 0.3);
    return half4(o, 1.0);
  }
  float stripe = step(0.5, fract((p.x + p.y) * 2.0));
  if (mosaic > 0.5) {
    float2 e = min(f, 1.0 - f);
    float inside = smoothstep(gap - aa * 0.5, gap + aa * 0.5, min(e.x, e.y));
    half3 tile = done ? col : TILE;
    if (!done && sel) tile = hatch > 0.5 ? mix(tile, col, half(0.45 * stripe)) : mix(tile, col, 0.25);
    o = mix(GAP, tile, half(inside));
  } else {
    half3 base = cloth(f, aa, tex);
    if (!done && sel) base = hatch > 0.5 ? mix(base, col, half(0.45 * stripe)) : mix(base, col, 0.25);
    o = done ? cross(f, col, base, aa, tex) : base;
  }
  if (!done) {
    half a = number(f, idx + 1.0, sel ? 1.0 : 0.0);
    half l = luma(o);
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

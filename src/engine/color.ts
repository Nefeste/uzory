// Цвет: sRGB ↔ линейный свет ↔ OKLab (Björn Ottosson, 2020). Нужен сборке картинок
// (docs/specs/2026-09-content-pipeline.md), подбору цвета цифр и будущему «Своему узору».

export type Lab = [number, number, number];

/** Канал sRGB 0…255 → линейный свет 0…1. */
export function toLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

/** Линейный свет 0…1 → канал sRGB 0…255, округлённый. */
export function fromLinear(x: number): number {
  const v = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.max(0, x) ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

const LINEAR = Float64Array.from({ length: 256 }, (_, i) => toLinear(i));

/** Таблица «канал → линейный свет» без пересчёта степеней. */
export const linear = (c: number) => LINEAR[c];

export function linearToLab(r: number, g: number, b: number): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function labToLinear([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** 0xRRGGBB → OKLab. */
export function rgbToLab(rgb: number): Lab {
  return linearToLab(LINEAR[(rgb >> 16) & 255], LINEAR[(rgb >> 8) & 255], LINEAR[rgb & 255]);
}

/** OKLab → 0xRRGGBB (цвета вне sRGB обрезаются по каналам). */
export function labToRgb(lab: Lab): number {
  const [r, g, b] = labToLinear(lab);
  return (fromLinear(r) << 16) | (fromLinear(g) << 8) | fromLinear(b);
}

/** Расстояние в OKLab — порог различимости нитей (docs/09-content.md, §6). */
export function deltaOK(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** OKLab → OKLCh: светлота, насыщенность, оттенок в градусах 0…360. */
export function labToLch([L, a, b]: Lab): [number, number, number] {
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return [L, Math.hypot(a, b), h < 0 ? h + 360 : h];
}

/** Относительная яркость по WCAG 2. */
export function luminance(rgb: number): number {
  return 0.2126 * LINEAR[(rgb >> 16) & 255] + 0.7152 * LINEAR[(rgb >> 8) & 255] + 0.0722 * LINEAR[rgb & 255];
}

/** Контраст двух цветов по WCAG 2: 1…21. */
export function contrast(a: number, b: number): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Цифра на кружке нити: чёрная или белая — что контрастнее (docs/specs/2026-09-canvas.md). */
export const digitOn = (rgb: number) => (contrast(rgb, 0x000000) >= contrast(rgb, 0xffffff) ? 0x000000 : 0xffffff);

/** Смешать два цвета в sRGB: t = 0 — `a`, t = 1 — `b`. */
export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

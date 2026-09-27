// Вид студии: цвета — токены сайта gornitsa.games (site/assets/site.css), шрифты — Kurale
// для заголовков и Onest для остального (docs/08-game-design.md, «Вид»).

export interface Theme {
  /** фон: отбелённый лён */
  bg: string;
  /** поверхности: бумага */
  surface: string;
  surfaceAlt: string;
  text: string;
  textDim: string;
  border: string;
  /** кумач — главная кнопка и акценты */
  accent: string;
  accentText: string;
  spruce: string;
  flax: string;
  danger: string;
  dark: boolean;
}

export const LIGHT: Theme = {
  bg: '#ECEDE6',
  surface: '#F7F7F2',
  surfaceAlt: '#E4E5DC',
  text: '#1A1B1E',
  textDim: '#4B4F4C',
  border: '#CFD1C6',
  accent: '#B3162F',
  accentText: '#FFFFFF',
  spruce: '#1F3C34',
  flax: '#A8904F',
  danger: '#B3162F',
  dark: false,
};

export const DARK: Theme = {
  bg: '#111816',
  surface: '#18211E',
  surfaceAlt: '#1F2A26',
  text: '#E9E8E0',
  textDim: '#A9AEA7',
  border: '#2C3833',
  accent: '#E5566A',
  accentText: '#16090C',
  spruce: '#7FB3A3',
  flax: '#D2BD84',
  danger: '#E5566A',
  dark: true,
};

/**
 * Канва всегда светлая, и в тёмной теме: вышивка на тёмном холсте — отдельный стиль
 * после 1.0 (docs/08-game-design.md, «Вид»).
 */
export const CANVAS_COLORS = {
  /** лён под канвой и поля за краем узора */
  linen: 0xecede6,
  /** пустая клетка */
  cell: 0xd9dbd1,
  /** номера невышитых клеток */
  digit: 0x3b3e3c,
};

/** Имена шрифтов после загрузки (src/ui/fonts.ts). */
export const FONTS = {
  title: 'Kurale',
  body: 'Onest',
  medium: 'Onest-Medium',
  bold: 'Onest-SemiBold',
} as const;

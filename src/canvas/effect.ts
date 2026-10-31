// Шейдер канвы — один на процесс, и при запуске он прогревается невидимым кадром (docs/02-architecture.md,
// «Канва»). До 0.16.8 шейдер разбирался заново на каждом открытии канвы и собирался видеокартой на первом
// кадре работы (разбор оформления 31.10.2026, Б9).
import { FilterMode, MipmapMode, Skia, type SkImage, type SkRuntimeEffect, TileMode } from '@shopify/react-native-skia';
import { logError } from '../state/crashlog';
import { NO_SCENE, SKSL, uniformList } from './shader';
import { rgbaImage } from './textures';

let effect: SkRuntimeEffect | null = null;

/** Разобранный шейдер канвы: канва, «Готово», «Поделиться» и замеры берут его отсюда. */
export function canvasEffect(): SkRuntimeEffect | null {
  effect ??= Skia.RuntimeEffect.Make(SKSL);
  return effect;
}

/**
 * Невидимый кадр 64 × 64 тем же шейдером и теми же фильтрами текстур: видеокарта собирает программу
 * при запуске, а не на первом кадре работы. Ошибка прогрева игре не мешает — только запись в журнал.
 */
export function warmCanvas(): void {
  try {
    const e = canvasEffect();
    const surface = Skia.Surface.MakeOffscreen(64, 64);
    const cells = rgbaImage(Uint8Array.from([0, 255, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 255, 0, 255]), 2, 2);
    const pal = rgbaImage(new Uint8Array(64 * 4).fill(200), 64, 1);
    const dig = rgbaImage(new Uint8Array(4).fill(255), 1, 1);
    if (!e || !surface || !cells || !pal || !dig) return;
    const child = (i: SkImage, f: FilterMode) => i.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, f, MipmapMode.None);
    const m = Skia.Matrix();
    m.scale(32, 32);
    const shader = e.makeShaderWithChildren(uniformList({
      w: 2, h: 2, gw: 1, gh: 1, cellPx: 80, near: 1, selected: 0, mosaic: 0, hatch: 0, gap: 0.01,
      px0: -1, py0: -1, px1: -1, py1: -1, pulseT: -1, ...NO_SCENE,
    }), [child(cells, FilterMode.Nearest), child(pal, FilterMode.Nearest), child(dig, FilterMode.Linear)], m);
    const paint = Skia.Paint();
    paint.setShader(shader);
    surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 64, 64), paint);
    surface.flush();
  } catch (err) {
    logError('render', err, 'warm canvas');
  }
}

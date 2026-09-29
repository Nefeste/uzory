// Рамка кадра поверх снимка (docs/specs/2026-09-custom.md, «Кадр»): рамку двигают мышью или
// пальцем, тянут за угол справа внизу, колёсиком — ближе и дальше у курсора. Это и есть
// «лупа»: рядом сразу узор этого кадра.
import { useEffect, useRef } from 'react';
import { type GestureResponderEvent, Image, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import type { Crop } from '../engine/build/mine';

/** Самая узкая рамка — такая доля снимка по стороне. */
export const CROP_MIN = 0.04;
/** Рамка не длиннее стольких своих ширин: у малого узора (40 клеток) короткая сторона — от 8. */
export const CROP_ASPECT = 5;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Сдвигает рамку, не выпуская за снимок. */
function shift([l, t, r, b]: Crop, dx: number, dy: number): Crop {
  const w = r - l;
  const h = b - t;
  const nl = clamp(l + dx, 0, 1 - w);
  const nt = clamp(t + dy, 0, 1 - h);
  return [nl, nt, nl + w, nt + h];
}

/** Рамка ближе или дальше в `f` раз; точка (ax, ay) снимка остаётся на месте. */
export function zoomCrop([l, t, r, b]: Crop, ax: number, ay: number, f: number): Crop {
  const w = clamp((r - l) * f, CROP_MIN, 1);
  const h = clamp((b - t) * f, CROP_MIN, 1);
  const nl = ax - (ax - l) * (w / (r - l));
  const nt = ay - (ay - t) * (h / (b - t));
  return shift([nl, nt, nl + w, nt + h], 0, 0);
}

// у мыши — свой вид курсора над рамкой и углом (только веб)
const MOVE = Platform.OS === 'web' ? ({ cursor: 'move' } as unknown as ViewStyle) : null;
const RESIZE = Platform.OS === 'web' ? ({ cursor: 'nwse-resize' } as unknown as ViewStyle) : null;

type Drag = { mode: 'move' | 'resize'; x: number; y: number; crop: Crop };

export function CropBox({ uri, width, height, maxW, maxH, crop, onChange }: {
  uri: string;
  /** размер снимка, точек */
  width: number;
  height: number;
  /** сколько места под снимок на экране */
  maxW: number;
  maxH: number;
  crop: Crop;
  onChange: (c: Crop) => void;
}) {
  const k = Math.min(maxW / width, maxH / height);
  const dw = Math.max(1, Math.round(width * k));
  const dh = Math.max(1, Math.round(height * k));
  // перетаскивание: откуда начали и какой была рамка — только в обработчиках событий
  const drag = useRef<Drag | null>(null);
  const grant = (mode: Drag['mode'], e: GestureResponderEvent) => {
    drag.current = { mode, x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, crop };
  };
  const onMove = (e: GestureResponderEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.nativeEvent.pageX - d.x) / dw;
    const dy = (e.nativeEvent.pageY - d.y) / dh;
    const [l, t, r, b] = d.crop;
    if (d.mode === 'move') {
      onChange(shift(d.crop, dx, dy));
      return;
    }
    // угол: не уже CROP_MIN и не вытянуть больше CROP_ASPECT : 1 (в точках снимка)
    let nr = clamp(r + dx, l + CROP_MIN, 1);
    let nb = clamp(b + dy, t + CROP_MIN, 1);
    const wpx = (nr - l) * width;
    const hpx = (nb - t) * height;
    if (wpx > CROP_ASPECT * hpx) nr = l + (CROP_ASPECT * hpx) / width;
    if (hpx > CROP_ASPECT * wpx) nb = t + (CROP_ASPECT * wpx) / height;
    onChange([l, t, nr, nb]);
  };
  const onRelease = () => {
    drag.current = null;
  };
  const yes = () => true;
  const no = () => false;

  // колёсико мыши и щипок на тачпаде (он приходит колёсиком с Ctrl) — рамка у курсора
  const box = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = box.current as unknown as HTMLElement | null;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const step = e.deltaMode === 1 ? e.deltaY * 0.05 : e.deltaY * 0.002;
      onChange(zoomCrop(crop, (e.clientX - rect.left) / dw, (e.clientY - rect.top) / dh, Math.exp(clamp(step, -0.5, 0.5))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [dw, dh, crop, onChange]);

  const [l, t, r, b] = crop;
  const fx = l * dw;
  const fy = t * dh;
  const fw = (r - l) * dw;
  const fh = (b - t) * dh;
  return (
    <View ref={box} style={{ width: dw, height: dh }} testID="mine-photo">
      <Image source={{ uri }} style={{ width: dw, height: dh }} />
      <View pointerEvents="none" style={[styles.shade, { left: 0, top: 0, width: dw, height: fy }]} />
      <View pointerEvents="none" style={[styles.shade, { left: 0, top: fy + fh, width: dw, height: Math.max(0, dh - fy - fh) }]} />
      <View pointerEvents="none" style={[styles.shade, { left: 0, top: fy, width: fx, height: fh }]} />
      <View pointerEvents="none" style={[styles.shade, { left: fx + fw, top: fy, width: Math.max(0, dw - fx - fw), height: fh }]} />
      <View onStartShouldSetResponder={yes} onMoveShouldSetResponder={yes} onResponderTerminationRequest={no}
        onResponderGrant={(e) => grant('move', e)} onResponderMove={onMove} onResponderRelease={onRelease}
        style={[styles.frame, MOVE, { left: fx, top: fy, width: fw, height: fh }]} testID="mine-frame">
        <View onStartShouldSetResponder={yes} onMoveShouldSetResponder={yes} onResponderTerminationRequest={no}
          onResponderGrant={(e) => grant('resize', e)} onResponderMove={onMove} onResponderRelease={onRelease}
          style={[styles.handle, RESIZE]} testID="mine-handle" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shade: { position: 'absolute', backgroundColor: 'rgba(20, 20, 24, 0.5)' },
  frame: { position: 'absolute', borderWidth: 2, borderColor: '#ffffff' },
  handle: {
    position: 'absolute', right: -9, bottom: -9, width: 18, height: 18, borderRadius: 3,
    backgroundColor: '#ffffff', borderWidth: 2, borderColor: '#b3162f',
  },
});

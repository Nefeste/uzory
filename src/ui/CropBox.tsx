// Рамка кадра поверх снимка (docs/specs/2026-09-custom.md, «Кадр»): рамку двигают мышью или
// пальцем, тянут за угол справа внизу; колёсиком у курсора и щипком двумя пальцами — ближе и
// дальше. Это и есть «лупа»: рядом сразу узор этого кадра. Сама математика рамки —
// src/engine/build/crop.ts.
//
// Рамка стоит в прокрутке экрана. Взявший касание обработчик отвечает `true` — «касание моё»: иначе
// на Android прокрутка забирает палец, едва он сдвинется на несколько точек, и рамка стоит, а экран
// едет (0.18.1 на телефоне владельца). Пока рамку держат, экран и прокрутку не включает (`onActive`).
import { useEffect, useRef } from 'react';
import { type GestureResponderEvent, Image, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { CROP_ASPECT, CROP_MIN, pinchCrop, shiftCrop, zoomCrop } from '../engine/build/crop';
import type { Crop } from '../engine/build/mine';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

// у мыши — свой вид курсора над рамкой и углом (только веб)
const MOVE = Platform.OS === 'web' ? ({ cursor: 'move' } as unknown as ViewStyle) : null;
const RESIZE = Platform.OS === 'web' ? ({ cursor: 'nwse-resize' } as unknown as ViewStyle) : null;
// угол виден маленьким, а ловит палец на 14 точек вокруг: 18 точек — мимо пальца
const HANDLE_SLOP = { top: 14, left: 14, right: 14, bottom: 14 };

type Drag = { mode: 'move' | 'resize'; x: number; y: number; crop: Crop } | { mode: 'pinch'; span: number; crop: Crop };

/** Расстояние между двумя пальцами; палец один — 0. */
function span(e: GestureResponderEvent): number {
  const t = e.nativeEvent.touches;
  return t && t.length >= 2 ? Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY) : 0;
}

export function CropBox({ uri, width, height, maxW, maxH, crop, onChange, onActive }: {
  uri: string;
  /** размер снимка, точек */
  width: number;
  height: number;
  /** сколько места под снимок на экране */
  maxW: number;
  maxH: number;
  crop: Crop;
  onChange: (c: Crop) => void;
  /** рамку взяли пальцем или мышью (true) и отпустили (false) */
  onActive?: (active: boolean) => void;
}) {
  const k = Math.min(maxW / width, maxH / height);
  const dw = Math.max(1, Math.round(width * k));
  const dh = Math.max(1, Math.round(height * k));
  // перетаскивание: откуда начали и какой была рамка — только в обработчиках событий
  const drag = useRef<Drag | null>(null);
  // рамку убрали посреди касания (другой снимок) — экран снова прокручивается
  const active = useRef(onActive);
  useEffect(() => {
    active.current = onActive;
  }, [onActive]);
  useEffect(() => () => active.current?.(false), []);
  // true — касание не отдать прокрутке экрана (blockNativeResponder в системе касаний React Native)
  const grant = (mode: 'move' | 'resize', e: GestureResponderEvent): boolean => {
    const two = span(e);
    drag.current = two > 0 ? { mode: 'pinch', span: two, crop } : { mode, x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, crop };
    onActive?.(true);
    return true;
  };
  const onMove = (e: GestureResponderEvent) => {
    const d = drag.current;
    if (!d) return;
    // второй палец — щипок: рамка ближе или дальше вокруг своей середины
    const two = span(e);
    if (two > 0) {
      if (d.mode === 'pinch') onChange(pinchCrop(d.crop, d.span, two));
      else drag.current = { mode: 'pinch', span: two, crop };
      return;
    }
    if (d.mode === 'pinch') {
      // палец остался один — дальше он двигает рамку, от того места, где она теперь
      drag.current = { mode: 'move', x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, crop };
      return;
    }
    const dx = (e.nativeEvent.pageX - d.x) / dw;
    const dy = (e.nativeEvent.pageY - d.y) / dh;
    const [l, t, r, b] = d.crop;
    if (d.mode === 'move') {
      onChange(shiftCrop(d.crop, dx, dy));
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
  // отпустили — или касание отняли (входящий звонок, системный жест): рамка остаётся, где была
  const onRelease = () => {
    drag.current = null;
    onActive?.(false);
  };
  const yes = () => true;
  const no = () => false;
  // два пальца мимо рамки — тоже щипок: снимок берёт касание, только когда пальцев два
  const twoFingers = (e: GestureResponderEvent) => span(e) > 0;

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
    <View ref={box} style={{ width: dw, height: dh }} testID="mine-photo"
      onStartShouldSetResponder={twoFingers} onMoveShouldSetResponder={twoFingers} onResponderTerminationRequest={no}
      onResponderGrant={(e) => grant('move', e)} onResponderMove={onMove} onResponderRelease={onRelease} onResponderTerminate={onRelease}>
      <Image source={{ uri }} style={{ width: dw, height: dh }} />
      <View pointerEvents="none" style={[styles.shade, { left: 0, top: 0, width: dw, height: fy }]} />
      <View pointerEvents="none" style={[styles.shade, { left: 0, top: fy + fh, width: dw, height: Math.max(0, dh - fy - fh) }]} />
      <View pointerEvents="none" style={[styles.shade, { left: 0, top: fy, width: fx, height: fh }]} />
      <View pointerEvents="none" style={[styles.shade, { left: fx + fw, top: fy, width: Math.max(0, dw - fx - fw), height: fh }]} />
      <View onStartShouldSetResponder={yes} onMoveShouldSetResponder={yes} onResponderTerminationRequest={no}
        onResponderGrant={(e) => grant('move', e)} onResponderMove={onMove} onResponderRelease={onRelease} onResponderTerminate={onRelease}
        style={[styles.frame, MOVE, { left: fx, top: fy, width: fw, height: fh }]} testID="mine-frame">
        <View onStartShouldSetResponder={yes} onMoveShouldSetResponder={yes} onResponderTerminationRequest={no}
          onResponderGrant={(e) => grant('resize', e)} onResponderMove={onMove} onResponderRelease={onRelease} onResponderTerminate={onRelease}
          hitSlop={HANDLE_SLOP} style={[styles.handle, RESIZE]} testID="mine-handle" />
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

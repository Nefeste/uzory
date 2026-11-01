// Рамка кадра поверх снимка (docs/specs/2026-09-custom.md, «Кадр»): рамку двигают мышью или
// пальцем, тянут за угол справа внизу; колёсиком у курсора и щипком двумя пальцами — ближе и
// дальше. Это и есть «лупа»: рядом сразу узор этого кадра. Сама математика рамки —
// src/engine/build/crop.ts.
//
// «Главное» (с 0.19.0, решение владельца 01.11.2026) — овал поверх снимка: его двигают, тянут за
// золотой уголок на краю овала и сводят-разводят двумя пальцами так же, как рамку кадра. Касание в
// овале — овалу, мимо овала в рамке — рамке; два пальца мимо обоих — щипок рамки.
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
/** Уголок овала — на его краю справа внизу, под 45°: cos 45°. */
const DIAG = Math.SQRT1_2;

/** Что двигает касание: рамку кадра или овал главного. */
type Target = 'crop' | 'main';
type Drag = { target: Target; mode: 'move' | 'resize'; x: number; y: number; rect: Crop } | { target: Target; mode: 'pinch'; span: number; rect: Crop };

/** Расстояние между двумя пальцами; палец один — 0. */
function span(e: GestureResponderEvent): number {
  const t = e.nativeEvent.touches;
  return t && t.length >= 2 ? Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY) : 0;
}

export function CropBox({ uri, width, height, maxW, maxH, crop, onChange, main, onMain, onActive }: {
  uri: string;
  /** размер снимка, точек */
  width: number;
  height: number;
  /** сколько места под снимок на экране */
  maxW: number;
  maxH: number;
  crop: Crop;
  onChange: (c: Crop) => void;
  /** главное — рамка овала, доли снимка; нет — овала нет */
  main?: Crop | null;
  onMain?: (c: Crop) => void;
  /** рамку взяли пальцем или мышью (true) и отпустили (false) */
  onActive?: (active: boolean) => void;
}) {
  const k = Math.min(maxW / width, maxH / height);
  const dw = Math.max(1, Math.round(width * k));
  const dh = Math.max(1, Math.round(height * k));
  // перетаскивание: что, откуда начали и какой была рамка — только в обработчиках событий
  const drag = useRef<Drag | null>(null);
  // рамку убрали посреди касания (другой снимок) — экран снова прокручивается
  const active = useRef(onActive);
  useEffect(() => {
    active.current = onActive;
  }, [onActive]);
  useEffect(() => () => active.current?.(false), []);
  const rectOf = (target: Target): Crop => (target === 'main' && main ? main : crop);
  const emit = (target: Target, c: Crop) => (target === 'main' ? onMain?.(c) : onChange(c));
  // true — касание не отдать прокрутке экрана (blockNativeResponder в системе касаний React Native)
  const grant = (target: Target, mode: 'move' | 'resize', e: GestureResponderEvent): boolean => {
    const two = span(e);
    const rect = rectOf(target);
    drag.current = two > 0 ? { target, mode: 'pinch', span: two, rect } : { target, mode, x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, rect };
    onActive?.(true);
    return true;
  };
  const onMove = (e: GestureResponderEvent) => {
    const d = drag.current;
    if (!d) return;
    // второй палец — щипок: рамка ближе или дальше вокруг своей середины
    const two = span(e);
    if (two > 0) {
      if (d.mode === 'pinch') emit(d.target, pinchCrop(d.rect, d.span, two));
      else drag.current = { target: d.target, mode: 'pinch', span: two, rect: rectOf(d.target) };
      return;
    }
    if (d.mode === 'pinch') {
      // палец остался один — дальше он двигает рамку, от того места, где она теперь
      drag.current = { target: d.target, mode: 'move', x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, rect: rectOf(d.target) };
      return;
    }
    const dx = (e.nativeEvent.pageX - d.x) / dw;
    const dy = (e.nativeEvent.pageY - d.y) / dh;
    const [l, t, r, b] = d.rect;
    if (d.mode === 'move') {
      emit(d.target, shiftCrop(d.rect, dx, dy));
      return;
    }
    // угол: не уже CROP_MIN и не вытянуть больше CROP_ASPECT : 1 (в точках снимка)
    let nr = clamp(r + dx, l + CROP_MIN, 1);
    let nb = clamp(b + dy, t + CROP_MIN, 1);
    const wpx = (nr - l) * width;
    const hpx = (nb - t) * height;
    if (wpx > CROP_ASPECT * hpx) nr = l + (CROP_ASPECT * hpx) / width;
    if (hpx > CROP_ASPECT * wpx) nb = t + (CROP_ASPECT * wpx) / height;
    emit(d.target, [l, t, nr, nb]);
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
      onResponderGrant={(e) => grant('crop', 'move', e)} onResponderMove={onMove} onResponderRelease={onRelease} onResponderTerminate={onRelease}>
      <Image source={{ uri }} style={{ width: dw, height: dh }} />
      <View pointerEvents="none" style={[styles.shade, { left: 0, top: 0, width: dw, height: fy }]} />
      <View pointerEvents="none" style={[styles.shade, { left: 0, top: fy + fh, width: dw, height: Math.max(0, dh - fy - fh) }]} />
      <View pointerEvents="none" style={[styles.shade, { left: 0, top: fy, width: fx, height: fh }]} />
      <View pointerEvents="none" style={[styles.shade, { left: fx + fw, top: fy, width: Math.max(0, dw - fx - fw), height: fh }]} />
      <View onStartShouldSetResponder={yes} onMoveShouldSetResponder={yes} onResponderTerminationRequest={no}
        onResponderGrant={(e) => grant('crop', 'move', e)} onResponderMove={onMove} onResponderRelease={onRelease} onResponderTerminate={onRelease}
        style={[styles.frame, MOVE, { left: fx, top: fy, width: fw, height: fh }]} testID="mine-frame">
        <View onStartShouldSetResponder={yes} onMoveShouldSetResponder={yes} onResponderTerminationRequest={no}
          onResponderGrant={(e) => grant('crop', 'resize', e)} onResponderMove={onMove} onResponderRelease={onRelease} onResponderTerminate={onRelease}
          hitSlop={HANDLE_SLOP} style={[styles.handle, RESIZE]} testID="mine-handle" />
      </View>
      {main ? (
        // овал — View со скруглением 50 %: по ширине и по высоте свой радиус, как в CSS (RN — CornerRadii)
        <View onStartShouldSetResponder={yes} onMoveShouldSetResponder={yes} onResponderTerminationRequest={no}
          onResponderGrant={(e) => grant('main', 'move', e)} onResponderMove={onMove} onResponderRelease={onRelease} onResponderTerminate={onRelease}
          testID="mine-main"
          style={[styles.oval, MOVE, { left: main[0] * dw, top: main[1] * dh, width: (main[2] - main[0]) * dw, height: (main[3] - main[1]) * dh }]}>
          <View onStartShouldSetResponder={yes} onMoveShouldSetResponder={yes} onResponderTerminationRequest={no}
            onResponderGrant={(e) => grant('main', 'resize', e)} onResponderMove={onMove} onResponderRelease={onRelease} onResponderTerminate={onRelease}
            hitSlop={HANDLE_SLOP} testID="mine-main-handle"
            style={[styles.mainHandle, RESIZE, {
              left: ((main[2] - main[0]) * dw * (1 + DIAG)) / 2 - 9,
              top: ((main[3] - main[1]) * dh * (1 + DIAG)) / 2 - 9,
            }]} />
        </View>
      ) : null}
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
  oval: { position: 'absolute', borderWidth: 2, borderColor: '#f2c94c', borderRadius: '50%' },
  mainHandle: {
    position: 'absolute', width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#f2c94c', borderWidth: 2, borderColor: '#3b2f12',
  },
});

// Экран кадра «Своего узора» (0.19.0; владелец 01.11.2026: «так и не удаётся двигать рамку пальцем за угол
// справа внизу и менять размер двумя пальцами — возможно, это нужно делать в отдельном окне сразу после
// выбора фото»). Открывается сразу после выбора снимка: снимок на весь экран, без прокрутки, которая на
// Android отнимала палец. Жесты — react-native-gesture-handler, как у канвы, где пальцы на телефоне
// владельца работают: один палец двигает рамку или овал главного, за уголок — тянет, два пальца — ближе
// и дальше (на овале — овал больше и меньше). Что берёт палец и куда двигается рамка — чистые функции
// src/engine/build/crop.ts. Внизу — маленькое превью узора этого кадра: собирается, когда палец отпустили.
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Image, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import { dragFrame, type FrameGrip, gripAt, insideOval, pinchCrop, scaleRect, zoomCrop } from '../engine/build/crop';
import type { Crop } from '../engine/build/mine';
import { T } from '../i18n';
import { useSettings } from '../state/settings';
import { Button, Screen, Txt } from './components';
import { FrameView } from './FrameView';

/** Уголок ловит палец на столько точек вокруг: сам он — 26. */
const GRAB = 34;
/** Место под кнопки и превью внизу экрана, точек. */
const BELOW = 236;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function FrameEditor({ uri, width, height, crop, onCrop, main, onMain, onToggleMain, onWhole, preview, building, onActive, onDone }: {
  uri: string;
  /** размер снимка, точек */
  width: number;
  height: number;
  crop: Crop;
  onCrop: (c: Crop) => void;
  main: Crop | null;
  onMain: (c: Crop) => void;
  onToggleMain: () => void;
  onWhole: () => void;
  /** превью узора этого кадра; нет — ещё не собран */
  preview: string | null;
  building: boolean;
  /** палец на снимке (true) и отпущен (false): пока держат, узор не собирается */
  onActive: (active: boolean) => void;
  onDone: () => void;
}) {
  const { theme } = useSettings();
  const { width: ww, height: wh } = useWindowDimensions();
  const k = Math.min((ww - 32) / width, Math.max(160, wh - BELOW - 120) / height);
  const dw = Math.max(1, Math.round(width * k));
  const dh = Math.max(1, Math.round(height * k));

  // что взял палец и какой была рамка — общие значения жестов (react-native-reanimated), не состояние экрана
  const grip = useSharedValue<{ g: FrameGrip; start: Crop } | null>(null);
  const pinchAt = useSharedValue<{ target: FrameGrip['target']; start: Crop } | null>(null);
  const emit = (target: FrameGrip['target'], c: Crop) => (target === 'main' ? onMain(c) : onCrop(c));

  const pan = Gesture.Pan()
    .runOnJS(true)
    .maxPointers(1)
    .minDistance(0)
    .onBegin((e) => {
      const g = gripAt(e.x, e.y, crop, main, dw, dh, GRAB);
      grip.set({ g, start: g.target === 'main' && main ? main : crop });
      onActive(true);
    })
    .onUpdate((e) => {
      const d = grip.get();
      if (d) emit(d.g.target, dragFrame(d.start, d.g.mode, e.translationX / dw, e.translationY / dh, width, height));
    })
    .onFinalize(() => {
      grip.set(null);
      onActive(false);
    });
  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onStart((e) => {
      // пальцы на овале — овал больше и меньше; иначе — рамка ближе и дальше
      const onOval = !!main && insideOval(e.focalX / dw, e.focalY / dh, main);
      pinchAt.set({ target: onOval ? 'main' : 'crop', start: onOval && main ? main : crop });
      grip.set(null);
      onActive(true);
    })
    .onUpdate((e) => {
      const p = pinchAt.get();
      if (!p) return;
      emit(p.target, p.target === 'main' ? scaleRect(p.start, e.scale) : pinchCrop(p.start, 1, e.scale));
    })
    .onFinalize(() => {
      pinchAt.set(null);
      onActive(false);
    });
  const gesture = Gesture.Simultaneous(pan, pinch);

  // колёсико мыши и щипок на тачпаде (он приходит колёсиком с Ctrl) — рамка у курсора (веб)
  const box = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = box.current as unknown as HTMLElement | null;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const step = e.deltaMode === 1 ? e.deltaY * 0.05 : e.deltaY * 0.002;
      onCrop(zoomCrop(crop, (e.clientX - rect.left) / dw, (e.clientY - rect.top) / dh, Math.exp(clamp(step, -0.5, 0.5))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [dw, dh, crop, onCrop]);

  return (
    <Screen title={T.mine.frameTitle} onBack={onDone}
      right={<Button small label={T.mine.frameDone} onPress={onDone} testID="mine-frame-done" />}>
      <View style={styles.body} testID="mine-frame-screen">
        <GestureDetector gesture={gesture}>
          <View collapsable={false}>
            <FrameView ref={box} uri={uri} dw={dw} dh={dh} crop={crop} main={main} big testID="mine-photo" />
          </View>
        </GestureDetector>
        <View style={styles.below}>
          <View style={[styles.preview, { backgroundColor: theme.surfaceAlt }]}>
            {preview ? <Image source={{ uri: preview }} style={styles.previewImg} resizeMode="contain" testID="mine-frame-preview" /> : null}
            {building ? <ActivityIndicator style={styles.spinner} color={theme.accent} /> : null}
          </View>
          <View style={styles.side}>
            <Txt dim style={styles.small}>{Platform.OS === 'web' ? T.mine.hint : T.mine.hintTouch}</Txt>
            <View style={styles.row}>
              <Button small kind="secondary" label={T.mine.whole} onPress={onWhole} testID="mine-whole" />
              <Button small kind={main ? 'ghost' : 'secondary'} label={main ? T.mine.mainOff : T.mine.mainOn} onPress={onToggleMain} testID="mine-main-toggle" />
            </View>
            {main ? <Txt dim style={styles.small}>{T.mine.mainNote}</Txt> : null}
          </View>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', paddingTop: 12, gap: 12 },
  below: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, alignSelf: 'stretch' },
  preview: { width: 132, height: 132, borderRadius: 6, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  previewImg: { width: '100%', height: '100%' },
  spinner: { position: 'absolute' },
  side: { flex: 1, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  small: { fontSize: 13 },
});

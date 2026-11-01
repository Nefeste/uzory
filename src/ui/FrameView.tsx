// Рамка кадра и овал главного поверх снимка — только рисунок, без касаний (docs/specs/2026-09-custom.md,
// «Кадр»): на экране кадра его обнимают жесты (./FrameEditor.tsx), в настройках «Своего узора» — маленький,
// касанием открывает экран кадра.
import { forwardRef } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { mainHandle } from '../engine/build/crop';
import type { Crop } from '../engine/build/mine';

/** Уголки — крупнее на экране кадра: их берут пальцем. */
const HANDLE = { small: 18, big: 26 } as const;

export const FrameView = forwardRef<View, {
  uri: string;
  /** размер снимка на экране, точек */
  dw: number;
  dh: number;
  crop: Crop;
  /** овалы главного (с 0.24.0 — несколько: «Найти лица» ставит овал на каждое лицо) */
  mains?: readonly Crop[];
  /** выбранный овал — ярче прочих: его убирает «Убрать овал» (экран кадра, овалов несколько) */
  sel?: number;
  /** уголки рамки и овала крупные — экран кадра */
  big?: boolean;
  testID?: string;
}>(function FrameView({ uri, dw, dh, crop, mains = [], sel, big, testID }, ref) {
  const [l, t, r, b] = crop;
  const fx = l * dw;
  const fy = t * dh;
  const fw = (r - l) * dw;
  const fh = (b - t) * dh;
  const hs = big ? HANDLE.big : HANDLE.small;
  return (
    <View ref={ref} style={{ width: dw, height: dh }} testID={testID}>
      <Image source={{ uri }} style={{ width: dw, height: dh }} />
      <View pointerEvents="none" style={[styles.shade, { left: 0, top: 0, width: dw, height: fy }]} />
      <View pointerEvents="none" style={[styles.shade, { left: 0, top: fy + fh, width: dw, height: Math.max(0, dh - fy - fh) }]} />
      <View pointerEvents="none" style={[styles.shade, { left: 0, top: fy, width: fx, height: fh }]} />
      <View pointerEvents="none" style={[styles.shade, { left: fx + fw, top: fy, width: Math.max(0, dw - fx - fw), height: fh }]} />
      <View pointerEvents="none" style={[styles.frame, { left: fx, top: fy, width: fw, height: fh }]} testID="mine-frame" />
      <View pointerEvents="none" testID="mine-handle"
        style={[styles.handle, { left: fx + fw - hs / 2, top: fy + fh - hs / 2, width: hs, height: hs, borderRadius: hs / 6 }]} />
      {mains.map((main, i) => {
        const [hx, hy] = mainHandle(main);
        // первый овал — «mine-main», как до нескольких овалов (сценарий Playwright)
        const id = i ? `mine-main-${i}` : 'mine-main';
        const dim = sel !== undefined && mains.length > 1 && i !== sel;
        return (
          <View key={i} pointerEvents="none" style={[StyleSheet.absoluteFill, dim && styles.dim]}>
            {/* овал — скругление 50 %: по ширине и по высоте свой радиус, как в CSS (RN — CornerRadii) */}
            <View pointerEvents="none" testID={id}
              style={[styles.oval, { left: main[0] * dw, top: main[1] * dh, width: (main[2] - main[0]) * dw, height: (main[3] - main[1]) * dh }]} />
            <View pointerEvents="none" testID={`${id}-handle`}
              style={[styles.mainHandle, { left: hx * dw - hs / 2, top: hy * dh - hs / 2, width: hs, height: hs, borderRadius: hs / 2 }]} />
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  shade: { position: 'absolute', backgroundColor: 'rgba(20, 20, 24, 0.5)' },
  frame: { position: 'absolute', borderWidth: 2, borderColor: '#ffffff' },
  handle: { position: 'absolute', backgroundColor: '#ffffff', borderWidth: 2, borderColor: '#b3162f' },
  oval: { position: 'absolute', borderWidth: 2, borderColor: '#f2c94c', borderRadius: '50%' },
  mainHandle: { position: 'absolute', backgroundColor: '#f2c94c', borderWidth: 2, borderColor: '#3b2f12' },
  dim: { opacity: 0.55 },
});

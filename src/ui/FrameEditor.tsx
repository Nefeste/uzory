// Экран кадра «Своего узора» (0.19.0; владелец 01.11.2026: «так и не удаётся двигать рамку пальцем за угол
// справа внизу и менять размер двумя пальцами — возможно, это нужно делать в отдельном окне сразу после
// выбора фото»). Открывается сразу после выбора снимка: снимок на весь экран, без прокрутки, которая на
// Android отнимала палец. Жесты — react-native-gesture-handler, как у канвы, где пальцы на телефоне
// владельца работают: один палец двигает рамку или овал главного, за уголок — тянет, два пальца — ближе
// и дальше (на овале — овал больше и меньше). Что берёт палец и куда двигается рамка — чистые функции
// src/engine/build/crop.ts. Узор здесь не собирается (владелец 01.11.2026: «пока человек ещё не выделил
// рамку и не выбрал овал, при каждом мини-изменении происходит пересчёт предпросмотра, на телефоне это
// медленно»): сначала рамка и главное, сборка — один раз, по «Собрать узор».
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import { dragFrame, type FrameGrip, gripAt, ovalAt, pinchCrop, scaleRect, zoomCrop } from '../engine/build/crop';
import { FACE_MAX } from '../engine/build/faces';
import type { Crop } from '../engine/build/mine';
import { T } from '../i18n';
import { AUTO_MAIN } from '../state/faces';
import { useSettings } from '../state/settings';
import { Button, Screen, Txt } from './components';
import { FrameView } from './FrameView';

/** Уголок ловит палец на столько точек вокруг: сам он — 26. */
const GRAB = 34;
/** Место под подсказку и кнопки внизу экрана, точек. */
const BELOW = 260;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** «Найти лица» и «Найти главное»: что искали и что вышло — ищем, нашлось столько (0 — ни одного), не вышло. */
type Search = { kind: 'faces' | 'salient'; n: 'busy' | 'error' | number } | null;

export function FrameEditor({ uri, width, height, crop, onCrop, mains, onMains, onAddMain, onWhole, onFaces, onSalient, onDone }: {
  uri: string;
  /** размер снимка, точек */
  width: number;
  height: number;
  crop: Crop;
  onCrop: (c: Crop) => void;
  /** овалы главного; с 0.24.0 — несколько (issue 146) */
  mains: readonly Crop[];
  onMains: (m: Crop[]) => void;
  /** новый овал посередине кадра */
  onAddMain: () => void;
  onWhole: () => void;
  /** «Найти лица» — овал на каждое лицо в кадре (src/state/faces.ts); ответ — сколько нашлось */
  onFaces: () => Promise<number>;
  /** «Найти главное» — овалы на самое заметное в кадре; ответ — сколько нашлось */
  onSalient: () => Promise<number>;
  /** кадр готов — к узору: он соберётся по этому кадру и главному */
  onDone: () => void;
}) {
  const { theme } = useSettings();
  const { width: ww, height: wh } = useWindowDimensions();
  const k = Math.min((ww - 32) / width, Math.max(160, wh - BELOW - 120) / height);
  const dw = Math.max(1, Math.round(width * k));
  const dh = Math.max(1, Math.round(height * k));

  // что взял палец и какой была рамка — общие значения жестов (react-native-reanimated), не состояние экрана
  const grip = useSharedValue<{ g: FrameGrip; start: Crop } | null>(null);
  const pinchAt = useSharedValue<{ target: FrameGrip['target']; index: number; start: Crop } | null>(null);
  // какой овал трогали последним — он ярче прочих, его убирает «Убрать овал»
  const [sel, setSel] = useState(0);
  const [search, setSearch] = useState<Search>(null);
  const busy = search?.n === 'busy';
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);
  const find = (kind: 'faces' | 'salient') => {
    if (busy) return;
    setSearch({ kind, n: 'busy' });
    (kind === 'faces' ? onFaces : onSalient)().then((n) => {
      if (!alive.current) return;
      setSearch({ kind, n });
      setSel(0);
    }, () => alive.current && setSearch({ kind, n: 'error' }));
  };
  const emit = (target: FrameGrip['target'], c: Crop, index = 0) => {
    if (target === 'crop') return onCrop(c);
    onMains(mains.map((m, i) => (i === index ? c : m)));
  };
  // новый овал — сразу выбранный: его и двигают, и убирают, если поставили зря
  const addMain = () => {
    setSel(mains.length);
    onAddMain();
  };
  const removeMain = () => {
    onMains(mains.filter((_, i) => i !== Math.min(sel, mains.length - 1)));
    setSel(0);
  };

  const pan = Gesture.Pan()
    .runOnJS(true)
    .maxPointers(1)
    .minDistance(0)
    .onBegin((e) => {
      const g = gripAt(e.x, e.y, crop, mains, dw, dh, GRAB);
      if (g.target === 'main' && g.index !== undefined) setSel(g.index);
      grip.set({ g, start: g.target === 'main' && g.index !== undefined ? mains[g.index] : crop });
    })
    .onUpdate((e) => {
      const d = grip.get();
      if (d) emit(d.g.target, dragFrame(d.start, d.g.mode, e.translationX / dw, e.translationY / dh, width, height), d.g.index);
    })
    .onFinalize(() => {
      grip.set(null);
    });
  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onStart((e) => {
      // пальцы на овале — этот овал больше и меньше; иначе — рамка ближе и дальше
      const at = ovalAt(e.focalX / dw, e.focalY / dh, mains);
      if (at >= 0) setSel(at);
      pinchAt.set({ target: at >= 0 ? 'main' : 'crop', index: at, start: at >= 0 ? mains[at] : crop });
      grip.set(null);
    })
    .onUpdate((e) => {
      const p = pinchAt.get();
      if (!p) return;
      emit(p.target, p.target === 'main' ? scaleRect(p.start, e.scale) : pinchCrop(p.start, 1, e.scale), p.index);
    })
    .onFinalize(() => {
      pinchAt.set(null);
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
            <FrameView ref={box} uri={uri} dw={dw} dh={dh} crop={crop} mains={mains} sel={Math.min(sel, mains.length - 1)} big testID="mine-photo" />
          </View>
        </GestureDetector>
        {/* под снимком — прокрутка: на невысоком экране кнопки и строки о находках не уходят за край; сам снимок
            с жестами — вне её, палец у рамки прокрутка не отнимает */}
        <ScrollView style={styles.belowScroll} contentContainerStyle={styles.below}>
          <Txt dim style={styles.small}>{Platform.OS === 'web' ? T.mine.hint : T.mine.hintTouch}</Txt>
          <View style={styles.row}>
            <Button small kind="secondary" label={T.mine.whole} onPress={onWhole} testID="mine-whole" />
            {!mains.length ? <Button small kind="secondary" label={T.mine.mainOn} onPress={addMain} testID="mine-main-toggle" /> : null}
            {AUTO_MAIN ? (
              <>
                <Button small kind="secondary" label={busy && search?.kind === 'faces' ? T.mine.facesBusy : T.mine.faces} onPress={() => find('faces')} disabled={busy} testID="mine-faces" />
                <Button small kind="secondary" label={busy && search?.kind === 'salient' ? T.mine.salientBusy : T.mine.salient} onPress={() => find('salient')} disabled={busy} testID="mine-salient" />
              </>
            ) : null}
            {/* круг — родной: крутится, даже пока поиск считает */}
            {busy ? <ActivityIndicator color={theme.accent} testID="mine-find-busy" /> : null}
            {mains.length && mains.length < FACE_MAX ? <Button small kind="ghost" label={T.mine.mainMore} onPress={addMain} testID="mine-main-more" /> : null}
            {mains.length ? <Button small kind="ghost" label={mains.length > 1 ? T.mine.mainRemoveOne : T.mine.mainOff} onPress={removeMain} testID="mine-main-off" /> : null}
          </View>
          {search && search.n !== 'busy' ? (
            <Txt dim style={styles.small} testID={search.kind === 'faces' ? 'mine-faces-result' : 'mine-salient-result'}>
              {search.kind === 'faces'
                ? (search.n === 'error' ? T.mine.facesError : T.mine.facesFound(search.n))
                : (search.n === 'error' ? T.mine.salientError : T.mine.salientFound(search.n))}
            </Txt>
          ) : null}
          {mains.length > 1 ? <Txt dim style={styles.small}>{T.mine.mainsPick}</Txt> : null}
          {mains.length ? <Txt dim style={styles.small}>{mains.length > 1 ? T.mine.mainsNote : T.mine.mainNote}</Txt> : null}
          <Button label={T.mine.frameBuild} onPress={onDone} testID="mine-frame-build" />
          <Txt dim style={styles.small}>{T.mine.frameLater}</Txt>
        </ScrollView>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', paddingTop: 12, gap: 12 },
  belowScroll: { flex: 1, alignSelf: 'stretch' },
  below: { gap: 8, paddingHorizontal: 16, paddingBottom: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  small: { fontSize: 13 },
});

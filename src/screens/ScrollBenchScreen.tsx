// «Замер прокрутки» (docs/specs/2026-09-library.md, критерий 4; docs/06-testing.md, §6, п. 5): вся
// библиотека сеткой коллекции — те же плитки и колонки, превью ещё не нарисованы; список сам едет
// вниз до конца и обратно со скоростью быстрого взмаха, кадры считает поток интерфейса, как у
// «Замера канвы». Числа — на экране и кнопкой «Поделиться числами»: без компьютера и adb.
import { useRef, useState } from 'react';
import { type FlatList, Platform, Share, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { scrollTo, useAnimatedRef, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { frameSummary } from '../canvas/StitchCanvas';
import type { PackPicture } from '../engine/pack';
import { T } from '../i18n';
import { clearPreviews } from '../render/preview';
import { percentOf, useCatalog } from '../state/catalog';
import { Button, Screen, Txt } from '../ui/components';
import { PicTile } from '../ui/PicTile';
import { APP_BUILD, APP_VERSION } from '../version';

/** Скорость прокрутки, dp в секунду: быстрый взмах пальцем. */
const SPEED = 4000;

export function ScrollBenchScreen({ onBack }: { onBack: () => void }) {
  const cat = useCatalog();
  const { width } = useWindowDimensions();
  // колонки и плитка — как в коллекции (src/screens/CollectionScreen.tsx)
  const inner = Math.min(width, 1200) - 32;
  const cols = Math.max(3, Math.floor(inner / 150));
  const tile = Math.floor((inner - 10 * (cols - 1)) / cols);
  const list = cat?.pictures ?? [];

  const ref = useAnimatedRef<FlatList<PackPicture>>();
  const dir = useSharedValue(0);
  const y = useSharedValue(0);
  const end = useSharedValue(0);
  const frames = useSharedValue<number[]>([]);
  const view = useRef(0);
  const content = useRef(0);
  const armed = useRef(false);
  const [round, setRound] = useState(0);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const finish = (a: number[]) => {
    setRunning(false);
    const f = frameSummary(a);
    const B = T.bench;
    setResult([
      `${T.common.appName} ${APP_VERSION} (${APP_BUILD}) · ${Platform.OS} ${String(Platform.Version)}`,
      T.scrollBench.what(list.length, cols, SPEED),
      `${f.n} ${B.frames}, ${B.p50} ${f.p50.toFixed(1)}, ${B.p95} ${f.p95.toFixed(1)}, ${B.slow} ${f.slow.toFixed(1)} %, `
        + `${T.scrollBench.over50} ${a.filter((x) => x > 50).length}, ${B.worst} ${f.worst.toFixed(0)}`,
    ].join('\n'));
  };

  // вниз до конца, потом вверх до начала; каждый кадр — его длительность
  useFrameCallback((info) => {
    'worklet';
    const d = dir.get();
    if (d === 0) return;
    const dt = info.timeSincePreviousFrame ?? 16;
    frames.get().push(dt);
    let next = y.get() + (d * SPEED * dt) / 1000;
    if (d > 0 && next >= end.get()) {
      next = end.get();
      dir.set(-1);
    } else if (d < 0 && next <= 0) {
      next = 0;
      dir.set(0);
      scheduleOnRN(finish, frames.get().slice());
    }
    y.set(next);
    scrollTo(ref, 0, next, false);
  });

  /** Новый список — плитки без превью; едет, когда узнает свою высоту. */
  const run = () => {
    clearPreviews();
    setResult(null);
    setRunning(true);
    armed.current = true;
    setRound((r) => r + 1);
  };

  /** Высоты списка и его содержимого известны — докуда ехать; первый раз после «Запустить» — поехали. */
  const sized = () => {
    end.set(Math.max(0, content.current - view.current));
    if (!armed.current || !view.current || content.current <= view.current) return;
    armed.current = false;
    frames.set([]);
    y.set(0);
    dir.set(1);
  };

  return (
    <Screen title={T.scrollBench.title} onBack={onBack} wide={cols > 3}>
      <View style={styles.panel}>
        <Txt dim testID="scroll-bench-state">{running ? T.scrollBench.running : T.scrollBench.idle(list.length)}</Txt>
        {result ? <Txt selectable style={styles.result} testID="scroll-bench-result">{result}</Txt> : null}
        <View style={styles.row}>
          <Button label={T.bench.run} onPress={run} disabled={running || !cat} testID="scroll-bench-run" />
          {result ? <Button kind="secondary" label={T.bench.share} onPress={() => void Share.share({ message: result })} /> : null}
        </View>
      </View>
      {cat && round > 0 ? (
        <Animated.FlatList key={`${round}-${cols}`} ref={ref} numColumns={cols} data={list} keyExtractor={(p: PackPicture) => p.id}
          testID="scroll-bench-list" scrollEnabled={!running}
          columnWrapperStyle={styles.gridRow} contentContainerStyle={styles.list}
          onLayout={(e) => {
            view.current = e.nativeEvent.layout.height;
            sized();
          }}
          onContentSizeChange={(_w: number, h: number) => {
            content.current = h;
            sized();
          }}
          renderItem={({ item }: { item: PackPicture }) => {
            const w = cat.workOf(item);
            return (
              <PicTile pic={item} size={tile} done={cat.done(item)} percent={w && !w.finished ? percentOf(w) : undefined}
                isNew={cat.isNew(item)} plus={cat.plusOnly(item)} onPress={() => undefined} />
            );
          }} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  panel: { padding: 12, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  result: { fontSize: 13, lineHeight: 19 },
  list: { padding: 16, gap: 14 },
  gridRow: { gap: 10 },
});

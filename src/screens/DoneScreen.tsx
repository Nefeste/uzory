// «Готово» и «Как вышивалось» (docs/08-game-design.md, «Готово»): работа целиком,
// повтор всех стежков по порядку за 8–12 секунд.
import { useFont } from '@shopify/react-native-skia';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { type CanvasApi, StitchCanvas } from '../canvas/StitchCanvas';
import { DIGIT_FONT_SIZE } from '../canvas/textures';
import type { Pattern } from '../engine/pattern';
import { replayMs, stitchOrder } from '../engine/work';
import { T } from '../i18n';
import { useSettings } from '../state/settings';
import { openWork, type WorkSession } from '../state/works';
import { Button, Screen, Txt } from '../ui/components';
import { DIGIT_FONT } from '../ui/fonts';

/** «Как вышивалось»: все стежки по порядку за replayMs — по кадрам, пачками. */
function playStitches(api: { current: CanvasApi | null }, cells: number[], onEnd: () => void): ReturnType<typeof setInterval> {
  api.current?.clear();
  const total = replayMs(cells.length);
  const t0 = Date.now();
  let shown = 0;
  const timer = setInterval(() => {
    const k = Math.min(cells.length, Math.floor((cells.length * (Date.now() - t0)) / total));
    if (k > shown) {
      api.current?.stitch(cells.slice(shown, k));
      shown = k;
    }
    if (k >= cells.length) {
      clearInterval(timer);
      onEnd();
    }
  }, 16);
  return timer;
}

export function DoneScreen({ pattern, title, caption, workId, onNext }: {
  pattern: Pattern;
  title: string;
  caption?: string;
  workId: string;
  onNext: () => void;
}) {
  const { settings, theme } = useSettings();
  const font = useFont(DIGIT_FONT, DIGIT_FONT_SIZE);
  const [session, setSession] = useState<WorkSession | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const api = useRef<CanvasApi | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;
    void openWork(pattern, workId).then((s) => {
      if (alive) setSession(s);
    });
    return () => {
      alive = false;
    };
  }, [pattern, workId]);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const order = session ? stitchOrder(session.strokes) : [];
  const minutes = session ? Math.max(1, Math.round(((session.finished ?? session.started) - session.started) / 60000)) : 0;

  const replay = () => {
    if (!api.current || !order.length) return;
    if (timer.current) clearInterval(timer.current);
    setPlaying(true);
    timer.current = playStitches(api, order.map((o) => o.cell), () => {
      timer.current = null;
      setPlaying(false);
    });
  };

  const skip = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    api.current?.stitch(order.map((o) => o.cell));
    setPlaying(false);
  };

  return (
    <Screen title={T.done.title}>
      <View style={styles.canvas} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {size && font && session ? (
          <StitchCanvas pattern={pattern} stitched={session.state.stitched} selected={-1}
            mosaic={settings.style === 'mosaic'} hatch={false} bigNumbers={false} fill={false} font={font}
            width={size.w} height={size.h} apiRef={api} viewOnly initial="fit" />
        ) : <ActivityIndicator style={styles.wait} color={theme.accent} />}
      </View>
      <View style={styles.info}>
        <Txt title style={styles.title}>{title}</Txt>
        {caption ? <Txt dim style={styles.caption}>{caption}</Txt> : null}
        {session ? <Txt dim testID="done-stats">{T.done.stats(order.length, minutes)}</Txt> : null}
        <View style={styles.buttons}>
          {playing
            ? <Button kind="secondary" label={T.done.skip} onPress={skip} testID="skip" />
            : <Button kind="secondary" label={T.done.replay} onPress={replay} testID="replay" />}
          <Button label={T.done.next} onPress={onNext} testID="next" />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, overflow: 'hidden' },
  wait: { margin: 24 },
  info: { padding: 16, gap: 6 },
  title: { fontSize: 24 },
  caption: { fontSize: 14 },
  buttons: { gap: 10, marginTop: 10 },
});

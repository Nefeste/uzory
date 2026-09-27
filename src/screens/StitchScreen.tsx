// Экран вышивания (docs/08-game-design.md, «Экран вышивания»; docs/specs/2026-09-canvas.md).
import { useFont } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, View } from 'react-native';
import { type Camera, openCamera } from '../canvas/camera';
import { type CanvasApi, StitchCanvas } from '../canvas/StitchCanvas';
import { DIGIT_FONT_SIZE } from '../canvas/textures';
import { ThreadBar } from '../canvas/ThreadBar';
import type { Pattern } from '../engine/pattern';
import { fillRegion, nearestGroup, nextThread } from '../engine/regions';
import { T } from '../i18n';
import { useSettings } from '../state/settings';
import { openWork, startWork, type WorkSession } from '../state/works';
import { Button, Screen, Txt } from '../ui/components';
import { DIGIT_FONT } from '../ui/fonts';

/** Уход с экрана: где вышивали — работа откроется там же (docs/specs/2026-09-canvas.md, «Камера»). */
function leave(session: WorkSession, api: { current: CanvasApi | null }, size: { current: { w: number; h: number } | null }) {
  const c = api.current?.camera();
  const sz = size.current;
  if (c && sz) session.at = { x: (sz.w / 2 - c.tx) / c.s, y: (sz.h / 2 - c.ty) / c.s };
  void session.flush(true);
  session.dispose();
}

export function StitchScreen({ pattern, title, workId, onBack, onDone }: {
  pattern: Pattern;
  title: string;
  /** нет — новая работа */
  workId?: string;
  onBack: () => void;
  onDone: (workId: string) => void;
}) {
  const { settings, theme } = useSettings();
  const font = useFont(DIGIT_FONT, DIGIT_FONT_SIZE);
  const [session, setSession] = useState<WorkSession | null>(null);
  const [broken, setBroken] = useState(false);
  const [selected, setSelected] = useState(0);
  const [, setVersion] = useState(0);
  const [line, setLine] = useState<{ text: string; pick?: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const sizeRef = useRef<{ w: number; h: number } | null>(null);
  const api = useRef<CanvasApi | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const s = workId ? await openWork(pattern, workId) : await startWork(pattern, Date.now());
      if (!alive) return;
      if (!s) {
        setBroken(true);
        return;
      }
      s.onSaveError = () => setLine({ text: T.stitch.saveFailed });
      const first = s.state.left.findIndex((n) => n > 0);
      setSelected(first < 0 ? 0 : first);
      setSession(s);
    })();
    return () => {
      alive = false;
    };
  }, [pattern, workId]);

  // уход с экрана и сворачивание — запись сразу (docs/04-data-model.md, «Файл стежков»)
  useEffect(() => {
    if (!session) return;
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') void session.flush();
    });
    return () => {
      sub.remove();
      leave(session, api, sizeRef);
    };
  }, [session]);

  const tick = () => {
    if (settings.haptics && Platform.OS !== 'web') void Haptics.selectionAsync();
  };

  const after = (s: WorkSession, thread: number) => {
    setVersion((v) => v + 1);
    if (s.state.finished) {
      api.current?.fit(800);
      void s.flush(true).then(() => setTimeout(() => onDone(s.id), 1200));
      return;
    }
    if (s.state.left[thread] === 0 && settings.autoNext) {
      const n = nextThread(s.state.left, thread);
      if (n >= 0) setSelected(n);
    }
  };

  const onStroke = (thread: number, cells: number[], final: boolean) => {
    if (!session) return;
    session.stitch(thread, cells, Date.now(), final);
    if (final) {
      setLine(null);
      after(session, thread);
    }
  };

  const onForeign = (cell: number) => {
    const t = pattern.cells[cell];
    setLine({ text: T.stitch.foreign(t + 1, pattern.threads[t].name), pick: t });
  };

  const onPick = (cell: number) => {
    setSelected(pattern.cells[cell]);
    setLine(null);
    tick();
  };

  const onFill = (cell: number) => {
    if (!session) return;
    const t = pattern.cells[cell];
    const region = fillRegion(pattern, session.state.stitched, cell);
    const ok = session.stitch(t, region, Date.now(), true);
    api.current?.stitch(ok);
    after(session, t);
  };

  const where = () => {
    if (!session || !size) return;
    let t = selected;
    if (session.state.left[t] === 0) {
      t = nextThread(session.state.left, t);
      if (t < 0) return;
      setSelected(t);
    }
    const c: Camera = api.current?.camera() ?? { s: 1, tx: 0, ty: 0 };
    const g = nearestGroup(pattern, session.state.stitched, t, (size.w / 2 - c.tx) / c.s, (size.h / 2 - c.ty) / c.s);
    if (g) api.current?.flyTo(g);
  };

  const percent = session ? session.state.percent : 0;
  const left = session ? session.state.left[selected] : 0;

  return (
    <Screen title={title} onBack={onBack} right={<Txt dim testID="percent">{T.common.percent(percent)}</Txt>}>
      <View style={[styles.canvas, { backgroundColor: '#e2e3da' }]} onLayout={(e) => {
        const next = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
        sizeRef.current = next;
        setSize(next);
      }} testID="canvas">
        {broken ? <Txt style={styles.msg}>{T.stitch.broken}</Txt>
          : size && font && session ? (
            <StitchCanvas
              pattern={pattern} stitched={session.state.stitched} selected={selected}
              mosaic={settings.style === 'mosaic'} hatch={settings.highlight === 'hatch'}
              bigNumbers={settings.bigNumbers} fill={settings.fill} font={font}
              width={size.w} height={size.h} apiRef={api}
              initial={openCamera(pattern.w, pattern.h, size.w, size.h, settings.bigNumbers, session.at)}
              onStroke={onStroke} onForeign={onForeign} onPick={onPick} onFill={onFill} onTick={tick}
            />
          ) : <ActivityIndicator style={styles.msg} color={theme.accent} />}
        {line ? (
          <View style={[styles.line, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="hint">
            <Txt style={styles.lineText}>{line.text}</Txt>
            {line.pick !== undefined ? (
              <Button small kind="secondary" label={T.stitch.pick} testID="pick"
                onPress={() => { setSelected(line.pick!); setLine(null); }} />
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={styles.bar}>
        <Button small kind="secondary" label={`${T.stitch.where} ${left}`} onPress={where} testID="where" style={styles.where} />
        {session ? (
          <ThreadBar threads={pattern.threads} left={session.state.left} selected={selected}
            onSelect={(t) => { setSelected(t); setLine(null); }}
            onLong={(t) => setLine({ text: T.stitch.threadName(t + 1, pattern.threads[t].name) })} />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, overflow: 'hidden' },
  msg: { margin: 24 },
  // строка — поверх канвы: её появление не меняет размер канвы и не сдвигает клетки
  line: { position: 'absolute', left: 8, right: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 6 },
  lineText: { flex: 1, fontSize: 15 },
  bar: { paddingTop: 6 },
  where: { alignSelf: 'flex-start', marginLeft: 10, marginBottom: 4 },
});

// Экран вышивания (docs/08-game-design.md, «Экран вышивания»; docs/specs/2026-09-canvas.md).
// Подсказки первой картинки — строкой внизу канвы (docs/specs/2026-09-first-picture.md), меню ⋮ —
// «О картине», «Стиль», «Настройки».
import { useFont } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { type Camera, openCamera } from '../canvas/camera';
import { type CanvasApi, StitchCanvas } from '../canvas/StitchCanvas';
import { DIGIT_FONT_SIZE } from '../canvas/textures';
import { ThreadBar } from '../canvas/ThreadBar';
import { currentHint, type HintAction, type HintId, hintsAfter, hintsPassed, strokeAction } from '../engine/hints';
import type { Pattern } from '../engine/pattern';
import { fillRegion, nearestGroup, nextThread } from '../engine/regions';
import { T } from '../i18n';
import { usePlayer } from '../state/player';
import { type StitchStyle, useSettings } from '../state/settings';
import { play } from '../state/sound';
import { openWork, startWork, type WorkSession } from '../state/works';
import { Button, Screen, Segmented, Txt } from '../ui/components';
import { DIGIT_FONT } from '../ui/fonts';

/** «О картине»: кто, когда, где хранится, рассказ (docs/09-content.md, «Рассказ о картине»). */
export interface PictureInfo {
  author?: string;
  made?: string;
  place?: string;
  about?: string;
}

/** Уход с экрана: где вышивали — работа откроется там же (docs/specs/2026-09-canvas.md, «Камера»). */
function leave(session: WorkSession, api: { current: CanvasApi | null }, size: { current: { w: number; h: number } | null }) {
  const c = api.current?.camera();
  const sz = size.current;
  if (c && sz) session.at = { x: (sz.w / 2 - c.tx) / c.s, y: (sz.h / 2 - c.ty) / c.s };
  void session.flush(true);
  session.dispose();
}

export function StitchScreen({ pattern, title, workId, info, onBack, onDone, onStarted, onSettings }: {
  pattern: Pattern;
  title: string;
  /** нет — новая работа */
  workId?: string;
  info?: PictureInfo;
  onBack: () => void;
  onDone: (workId: string) => void;
  /** новая работа записана: вернувшись из настроек, экран откроет её, а не начнёт ещё одну */
  onStarted?: (workId: string) => void;
  onSettings?: () => void;
}) {
  const { settings, update, theme } = useSettings();
  const player = usePlayer();
  const font = useFont(DIGIT_FONT, DIGIT_FONT_SIZE);
  const [session, setSession] = useState<WorkSession | null>(null);
  const [broken, setBroken] = useState(false);
  const [selected, setSelected] = useState(0);
  const [, setVersion] = useState(0);
  const [line, setLine] = useState<{ text: string; pick?: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [panel, setPanel] = useState<'menu' | 'about' | null>(null);
  const [taps, setTaps] = useState(0);
  // законченная нить секунду стоит на месте с ✓ (docs/specs/2026-09-canvas.md, «Полоса нитей»)
  const [justDone, setJustDone] = useState<number | null>(null);
  // работа экрана — та, с которой он открылся: новую корень запомнит (onStarted), а экран её не пересоздаст
  const [openId] = useState(workId);
  const sizeRef = useRef<{ w: number; h: number } | null>(null);
  const api = useRef<CanvasApi | null>(null);
  /** клеток в штрихе, который ещё идёт: канва шлёт долгий штрих частями */
  const strokeCells = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const s = openId ? await openWork(pattern, openId) : await startWork(pattern, Date.now());
      if (!alive) return;
      if (!s) {
        setBroken(true);
        return;
      }
      if (!openId) onStarted?.(s.id);
      s.onSaveError = () => setLine({ text: Platform.OS === 'web' ? T.stitch.saveFailedWeb : T.stitch.saveFailed });
      const first = s.state.left.findIndex((n) => n > 0);
      setSelected(first < 0 ? 0 : first);
      setSession(s);
    })();
    return () => {
      alive = false;
    };
    // работа открывается один раз на экран; onStarted — новая функция с каждым рендером корня
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern, openId]);

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

  // подсказки: одной строкой, пока их не выключили и пока на канве нет другой строки
  const percent = session ? session.state.percent : 0;
  const left = session ? session.state.left[selected] : 0;
  const done = player.player.hints;
  const hint: HintId | null = settings.hints && player.loaded && session && !session.state.finished
    ? currentHint({ done, taps, percent, left }) : null;
  // подсказку сменила другая — прежняя прочитана (src/engine/hints.ts)
  const shownHint = useRef<HintId | null>(null);
  const updatePlayer = player.update;
  useEffect(() => {
    const prev = shownHint.current;
    shownHint.current = hint;
    if (prev && hint && prev !== hint) updatePlayer((p) => ({ hints: hintsPassed(p.hints, prev, hint) }));
  }, [hint, updatePlayer]);

  const act = (a: HintAction) => {
    if (!settings.hints || hintsAfter(done, a).length === done.length) return;
    updatePlayer((p) => ({ hints: hintsAfter(p.hints, a) }));
  };

  // стежок: шорох и щелчок вибрации — канва зовёт не чаще 20 раз в секунду
  const tick = () => {
    if (settings.sound) play('stitch');
    if (settings.haptics && Platform.OS !== 'web') void Haptics.selectionAsync();
  };

  const after = (s: WorkSession, thread: number) => {
    setVersion((v) => v + 1);
    if (s.state.left[thread] === 0 && justDone !== thread) {
      setJustDone(thread);
      setTimeout(() => setJustDone((j) => (j === thread ? null : j)), 1000);
      // нить готова — тихий звон; картинка готова — свой звук
      if (settings.sound) play(s.state.finished ? 'done' : 'thread');
    }
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
    strokeCells.current += cells.length;
    if (final) {
      const a = strokeAction(strokeCells.current);
      strokeCells.current = 0;
      if (a === 'tap') setTaps((n) => n + 1);
      act(a);
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
    if (ok.length) tick();
    after(session, t);
  };

  const where = () => {
    if (!session || !size) return;
    act('where');
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

  const hintText = hint ? (Platform.OS === 'web' ? T.stitch.hintsMouse : T.stitch.hints)[hint] : null;
  const shown = line ?? (hintText ? { text: hintText } : null);
  const hasAbout = !!(info && (info.about || info.author || info.place));

  const right = (
    <View style={styles.right}>
      <Txt dim testID="percent">{T.common.percent(percent)}</Txt>
      <Pressable onPress={() => setPanel(panel ? null : 'menu')} hitSlop={10} accessibilityRole="button"
        accessibilityLabel={T.stitch.menu} style={styles.menuBtn} testID="menu">
        <Txt bold style={styles.menuIcon}>⋮</Txt>
      </Pressable>
    </View>
  );

  return (
    <Screen title={title} onBack={onBack} wide right={right}>
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
              onCamera={() => act('camera')}
            />
          ) : <ActivityIndicator style={styles.msg} color={theme.accent} />}
        {shown ? (
          <View style={[styles.line, { backgroundColor: theme.surface, borderColor: theme.border }, shown.pick === undefined && styles.through]}
            testID={line ? 'hint' : `hint-${hint}`}>
            <Txt style={styles.lineText}>{shown.text}</Txt>
            {shown.pick !== undefined ? (
              <Button small kind="secondary" label={T.stitch.pick} testID="pick"
                onPress={() => { setSelected(shown.pick!); setLine(null); }} />
            ) : null}
          </View>
        ) : null}
        {panel ? (
          <Pressable style={styles.backdrop} onPress={() => setPanel(null)} accessibilityLabel={T.stitch.close} testID="panel-close">
            <Pressable style={[styles.panel, panel === 'about' && styles.aboutPanel, { backgroundColor: theme.surface, borderColor: theme.border }]}
              onPress={() => undefined} testID={panel === 'menu' ? 'menu-panel' : 'about-panel'}>
              {panel === 'menu' ? (
                <>
                  {hasAbout ? <Button kind="ghost" label={T.stitch.about} onPress={() => setPanel('about')} testID="menu-about" /> : null}
                  <Txt dim style={styles.panelLabel}>{T.stitch.style}</Txt>
                  <Segmented<StitchStyle> value={settings.style} onChange={(v) => update({ style: v })} testID="menu-style"
                    options={[{ id: 'cross', label: T.stitch.styles.cross }, { id: 'mosaic', label: T.stitch.styles.mosaic }]} />
                  {onSettings ? <Button kind="ghost" label={T.stitch.settings} onPress={() => { setPanel(null); onSettings(); }} testID="menu-settings" /> : null}
                </>
              ) : (
                <ScrollView contentContainerStyle={styles.aboutBody}>
                  <Txt title style={styles.aboutTitle}>{title}</Txt>
                  {info?.author || info?.made ? <Txt dim>{[info.author, info.made].filter(Boolean).join(', ')}</Txt> : null}
                  {info?.place ? <Txt dim>{info.place}</Txt> : null}
                  {info?.about ? <Txt style={styles.aboutText}>{info.about}</Txt> : null}
                  <Button kind="secondary" small label={T.stitch.close} onPress={() => setPanel(null)} testID="about-close" />
                </ScrollView>
              )}
            </Pressable>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.bar}>
        <Button small kind="secondary" label={`${T.stitch.where} ${left}`} onPress={where} testID="where" style={styles.where} />
        {session ? (
          <ThreadBar threads={pattern.threads} left={session.state.left} selected={selected} stay={justDone}
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
  right: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  menuBtn: { width: 30, height: 40, alignItems: 'center', justifyContent: 'center' },
  menuIcon: { fontSize: 24, lineHeight: 28 },
  // строка — поверх канвы: её появление не меняет размер канвы и не сдвигает клетки
  line: { position: 'absolute', left: 8, right: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 6 },
  lineText: { flex: 1, fontSize: 15 },
  // строка без кнопки не мешает вышивать клетки под ней
  through: { pointerEvents: 'none' },
  backdrop: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(20, 20, 24, 0.25)' },
  panel: { position: 'absolute', top: 8, right: 8, width: 260, maxWidth: '92%', borderWidth: 1, borderRadius: 8, padding: 12, gap: 8 },
  aboutPanel: { left: 8, width: undefined, maxWidth: 520, bottom: 8 },
  panelLabel: { fontSize: 13, marginTop: 4 },
  aboutBody: { gap: 8 },
  aboutTitle: { fontSize: 22 },
  aboutText: { fontSize: 16, lineHeight: 23 },
  bar: { paddingTop: 6 },
  where: { alignSelf: 'flex-start', marginLeft: 10, marginBottom: 4 },
});

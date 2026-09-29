// «Готово» и «Как вышивалось» (docs/08-game-design.md, «Готово»): работа целиком в рамке на
// льняном фоне, повтор всех стежков по порядку за 8–12 секунд, «О картине», «Поделиться» —
// картинкой PNG, «Дальше» — сегодняшняя картинка дня, если не вышита, иначе следующая в коллекции.
import { Kurale_400Regular } from '@expo-google-fonts/kurale/400Regular';
import { Onest_500Medium } from '@expo-google-fonts/onest/500Medium';
import { useFont } from '@shopify/react-native-skia';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MARGIN_DP, MAX_DP } from '../canvas/camera';
import { type CanvasApi, StitchCanvas } from '../canvas/StitchCanvas';
import { DIGIT_FONT_SIZE } from '../canvas/textures';
import { canStitch } from '../engine/access';
import { nextPicture } from '../engine/library';
import type { PackPicture } from '../engine/pack';
import type { Pattern } from '../engine/pattern';
import { replayMs, stitchOrder } from '../engine/work';
import { T } from '../i18n';
import { shareImage } from '../render/share';
import { useCatalog } from '../state/catalog';
import { logError } from '../state/crashlog';
import { dailyCalendar, FIRST_PICTURE, pictureById } from '../state/library';
import { usePlayer } from '../state/player';
import { useSettings } from '../state/settings';
import { sharePng } from '../state/share';
import { openWork, type WorkSession } from '../state/works';
import { Button, Screen, Txt } from '../ui/components';
import { DIGIT_FONT } from '../ui/fonts';
import { hasAbout, PicAbout } from '../ui/PicAbout';

/** Рамка вокруг работы на экране, dp. */
const FRAME_DP = 8;

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

export function DoneScreen({ pattern, title, caption, workId, pic, onNext }: {
  pattern: Pattern;
  title: string;
  caption?: string;
  workId: string;
  /** картинка библиотеки — для «О картине» и «Дальше»; у своего узора её нет */
  pic?: PackPicture;
  /** «Дальше»: карточка следующей картинки или главная */
  onNext: (next: PackPicture | null) => void;
}) {
  const { settings, theme } = useSettings();
  const { player, today } = usePlayer();
  const cat = useCatalog();
  const font = useFont(DIGIT_FONT, DIGIT_FONT_SIZE);
  const titleFont = useFont(Kurale_400Regular, 64);
  const textFont = useFont(Onest_500Medium, 34);
  const [session, setSession] = useState<WorkSession | null>(null);
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [about, setAbout] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
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

  const share = async () => {
    if (!session || !font || !titleFont || !textFont || sharing) return;
    setSharing(true);
    setNote(null);
    try {
      // картинка большой работы рисуется заметное время: сначала — «Готовлю…» на кнопке
      await new Promise((r) => setTimeout(r, 30));
      const png = shareImage(pattern, session.state.stitched, settings.style === 'mosaic', { title: titleFont, text: textFont, digits: font },
        { title, caption, mark: pic?.author ? T.done.markBased(T.picture.basedOn[pic.collection]) : T.done.mark });
      const name = `uzory-${pattern.key.replace(/@.*$/, '')}.png`;
      if (!png || !(await sharePng(png, name, T.done.share))) setNote(T.done.shareFailed);
    } catch (e) {
      logError('work', e, 'share');
      setNote(T.done.shareFailed);
    } finally {
      setSharing(false);
    }
  };

  // «Дальше»: после первой картинки — главная; не вышита картинка дня — она; иначе следующая
  // доступная в той же коллекции (docs/08-game-design.md, «Готово»)
  const next = (): PackPicture | null => {
    if (!pic || !cat || pic.id === FIRST_PICTURE) return null;
    const dailyId = dailyCalendar(player.pinned).on(today);
    const list = cat.collections.find((c) => c.id === pic.collection)?.pictures ?? [];
    return nextPicture(pic, dailyId ? pictureById(dailyId) : undefined, list, (p) => !cat.done(p) && canStitch(cat.access(p)));
  };

  // канва — по размеру работы в рамке: поле канвы вокруг узора и есть паспарту
  let cw = 0;
  let ch = 0;
  if (area) {
    const s = Math.min(MAX_DP, (area.w - 2 * FRAME_DP - 2 * MARGIN_DP) / pattern.w, (area.h - 2 * FRAME_DP - 2 * MARGIN_DP) / pattern.h);
    cw = Math.max(1, Math.floor(pattern.w * s + 2 * MARGIN_DP));
    ch = Math.max(1, Math.floor(pattern.h * s + 2 * MARGIN_DP));
  }

  return (
    <Screen title={T.done.title}>
      <View style={[styles.stage, { backgroundColor: theme.bg }]} onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {area && font && session && cw > 0 ? (
          <View style={[styles.frame, { width: cw + 2 * FRAME_DP, height: ch + 2 * FRAME_DP }]} testID="done-frame">
            <StitchCanvas pattern={pattern} stitched={session.state.stitched} selected={-1}
              mosaic={settings.style === 'mosaic'} hatch={false} bigNumbers={false} fill={false} font={font}
              width={cw} height={ch} apiRef={api} viewOnly initial="fit" />
          </View>
        ) : <ActivityIndicator style={styles.wait} color={theme.accent} />}
        {about && pic ? (
          <Pressable style={styles.backdrop} onPress={() => setAbout(false)} accessibilityLabel={T.stitch.close}>
            <Pressable style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]} onPress={() => undefined} testID="done-about-panel">
              <ScrollView contentContainerStyle={styles.aboutBody}>
                <PicAbout pic={pic} />
                <Button kind="secondary" small label={T.stitch.close} onPress={() => setAbout(false)} testID="done-about-close" />
              </ScrollView>
            </Pressable>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.info}>
        <Txt title style={styles.title}>{title}</Txt>
        {caption ? <Txt dim style={styles.caption}>{caption}</Txt> : null}
        {session ? <Txt dim testID="done-stats">{T.done.stats(order.length, minutes)}</Txt> : null}
        {note ? <Txt style={{ color: theme.danger }}>{note}</Txt> : null}
        <View style={styles.row}>
          {playing
            ? <Button kind="secondary" label={T.done.skip} onPress={skip} testID="skip" style={styles.half} />
            : <Button kind="secondary" label={T.done.replay} onPress={replay} testID="replay" style={styles.half} />}
          <Button kind="secondary" label={sharing ? T.done.sharing : T.done.share} onPress={() => void share()} disabled={!session || !font || !titleFont || !textFont || sharing}
            testID="share" style={styles.half} />
        </View>
        {pic && hasAbout(pic) ? <Button kind="ghost" small label={T.done.about} onPress={() => setAbout(!about)} testID="done-about" /> : null}
        <Button label={T.done.next} onPress={() => onNext(next())} testID="next" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  frame: { borderWidth: FRAME_DP, borderColor: '#6f5641', borderRadius: 2 },
  wait: { margin: 24 },
  backdrop: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(20, 20, 24, 0.25)', padding: 12, justifyContent: 'center' },
  panel: { borderWidth: 1, borderRadius: 8, padding: 14, maxHeight: '100%' },
  aboutBody: { gap: 10 },
  info: { padding: 16, gap: 6 },
  title: { fontSize: 24 },
  caption: { fontSize: 14 },
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },
  half: { flex: 1 },
});

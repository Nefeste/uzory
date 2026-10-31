// «Готово» и «Как вышивалось» (docs/08-game-design.md, «Готово»): работа целиком в рамке на
// льняном фоне, повтор всех стежков по порядку за 8–12 секунд, «О картине», «Поделиться» —
// картинкой PNG, «Дальше» — сегодняшняя картинка дня, если не вышита, иначе следующая в коллекции.
// Только что вышитая работа встаёт в рамку: рамка проявляется, подпись с кнопками поднимается снизу,
// в этот момент — звук «готово» и вибрация (разбор оформления 31.10.2026, 6.1 и 4.4).
// Готовая работа из «Моих работ» или «Моих узоров» — тот же экран: «назад» к списку и «Вышить ещё
// раз» вместо «Дальше». «Настройки» в шапке — стежки на картинке «Поделиться» и обратно сюда.
import { Kurale_400Regular } from '@expo-google-fonts/kurale/400Regular';
import { Onest_500Medium } from '@expo-google-fonts/onest/500Medium';
import { useFont } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { type Camera, MARGIN_DP, MAX_DP } from '../canvas/camera';
import { type CanvasApi, StitchCanvas } from '../canvas/StitchCanvas';
import { DIGIT_FONT_SIZE } from '../canvas/textures';
import { canStitch } from '../engine/access';
import { nextPicture } from '../engine/library';
import type { PackPicture } from '../engine/pack';
import type { Pattern } from '../engine/pattern';
import { offerOnDone } from '../engine/plus';
import { replayMs, stitchOrder } from '../engine/work';
import { T } from '../i18n';
import { shareImage } from '../render/share';
import { billing } from '../state/billing';
import { useCatalog } from '../state/catalog';
import { logError } from '../state/crashlog';
import { dailyCalendar, FIRST_PICTURE, pictureById } from '../state/library';
import { useLooks } from '../state/looks';
import { usePlayer } from '../state/player';
import { useGate, usePlus } from '../state/plus';
import { useSettings } from '../state/settings';
import { shareFile } from '../state/share';
import { play } from '../state/sound';
import { openWork, type WorkSession } from '../state/works';
import { Button, Screen, Txt } from '../ui/components';
import { DIGIT_FONT } from '../ui/fonts';
import { hasAbout, PicAbout } from '../ui/PicAbout';

/** Рамка вокруг работы на экране, dp: дерево со скосом — свет сверху слева, как на канве (разбор 6.4). */
const FRAME_DP = 8;
/** Пяльцы: обод из двух колец вокруг круга ткани, dp. */
const HOOP_DP = 12;
/** Рамка с работой — не больше этой доли сцены: вокруг неё лён, а не край экрана. */
const STAGE_FILL = 0.86;
/** Звук и вибрация «готово» — один раз на работу, когда она встаёт в рамку: не снова после «Настроек». */
const celebrated = new Set<string>();
/**
 * «Как вышивалось» и «Поделиться» рядом — только если обе подписи влезают целиком: на экране
 * уже этого (с поправкой на крупный шрифт телефона) кнопки встают одна под другой.
 */
const ROW_MIN_DP = 390;

/** «Как вышивалось»: все стежки по порядку за replayMs — по кадрам, пачками; счётчик — не чаще 10 раз в секунду. */
function playStitches(api: { current: CanvasApi | null }, cells: number[], onEnd: () => void, onCount: (k: number) => void): ReturnType<typeof setInterval> {
  api.current?.clear();
  const total = replayMs(cells.length);
  const t0 = Date.now();
  let shown = 0;
  let counted = 0;
  onCount(0);
  const timer = setInterval(() => {
    const now = Date.now();
    const k = Math.min(cells.length, Math.floor((cells.length * (now - t0)) / total));
    if (k > shown) {
      api.current?.stitch(cells.slice(shown, k));
      shown = k;
    }
    if (now - counted >= 100 || k >= cells.length) {
      counted = now;
      onCount(k);
    }
    if (k >= cells.length) {
      clearInterval(timer);
      onEnd();
    }
  }, 16);
  return timer;
}

export function DoneScreen({ pattern, title, caption, workId, pic, onNext, onBack, onAgain, onSettings, onPlus }: {
  pattern: Pattern;
  title: string;
  caption?: string;
  workId: string;
  /** картинка библиотеки — для «О картине» и «Дальше»; у своего узора её нет */
  pic?: PackPicture;
  /** «Дальше» у только что вышитой работы: карточка следующей картинки или главная */
  onNext?: (next: PackPicture | null) => void;
  /** готовая работа открыта из списка: «назад» — к нему; «Дальше» и строки «Узоры+» нет */
  onBack?: () => void;
  /** там же «Вышить ещё раз» — карточка картинки, где новая работа начинается */
  onAgain?: () => void;
  /** «Настройки» в шапке */
  onSettings: () => void;
  /** строка «Вся библиотека — в „Узоры+“» — экран подписки */
  onPlus: () => void;
}) {
  const { settings, theme } = useSettings();
  // оформление игрока: канва и рамка (src/state/looks.ts); пяльцы — круг ткани
  const looks = useLooks();
  const frame = looks.frame;
  const hoop = frame.kind === 'hoop';
  const { player, today, update: updatePlayer } = usePlayer();
  const plus = usePlus();
  const gate = useGate();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < ROW_MIN_DP * Math.max(1, fontScale);
  const cat = useCatalog();
  const font = useFont(DIGIT_FONT, DIGIT_FONT_SIZE);
  const titleFont = useFont(Kurale_400Regular, 64);
  const textFont = useFont(Onest_500Medium, 34);
  const [session, setSession] = useState<WorkSession | null>(null);
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  /** стежков на повторе — для счётчика и полосы под рамкой */
  const [count, setCount] = useState(0);
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

  // только что вышитая — «Дальше» есть: звук «готово» и вибрация, когда работа встаёт в рамку
  const fresh = !!onNext;
  const framed = !!session && !!font && !!area;
  useEffect(() => {
    if (!fresh || !framed || celebrated.has(workId)) return;
    const t = setTimeout(() => {
      celebrated.add(workId);
      if (settings.sound) play('done');
      if (settings.haptics && Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, 250);
    return () => clearTimeout(t);
  }, [fresh, framed, workId, settings.sound, settings.haptics]);

  // строка «Узоры+» (docs/08-game-design.md, «„Узоры+“ глазами игрока»): только где подписку
  // можно оформить, у игрока без неё, сразу после бесплатной картинки, не в первые три дня после
  // установки и не чаще раза в сутки; день прошлого показа запомнен при открытии экрана —
  // отметка сегодняшнего показа строку на этом же экране не прячет
  const [shownOn] = useState(player.plusOfferShownOn);
  const offerAccess = cat && pic ? cat.access(pic) : null;
  const offer = !!onNext && gate && billing.available && !plus.open && offerAccess !== null
    && offerOnDone({ today, installed: player.installed, shownOn, free: offerAccess === 'free' || offerAccess === 'daily' });
  useEffect(() => {
    if (offer && player.plusOfferShownOn !== today) updatePlayer({ plusOfferShownOn: today });
  }, [offer, player.plusOfferShownOn, today, updatePlayer]);

  const order = session ? stitchOrder(session.strokes) : [];

  const replay = () => {
    if (!api.current || !order.length) return;
    if (timer.current) clearInterval(timer.current);
    setPlaying(true);
    timer.current = playStitches(api, order.map((o) => o.cell), () => {
      timer.current = null;
      setPlaying(false);
    }, setCount);
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
      const png = shareImage(pattern, session.state.stitched, { mosaic: settings.style === 'mosaic', stitches: settings.shareStitches, canvas: looks.canvas, frame },
        { title: titleFont, text: textFont, digits: font },
        { title, caption, mark: pic?.author ? T.done.markBased(T.picture.basedOn[pic.collection]) : T.done.mark });
      const name = `uzory-${pattern.key.replace(/@.*$/, '')}.png`;
      if (!png || !(await shareFile(png, name, 'image/png', T.done.share))) setNote(T.done.shareFailed);
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

  // канва — по размеру работы в рамке: поле канвы вокруг узора и есть паспарту. В пяльцах — круг ткани,
  // узор внутри круга целиком: его диагональ — поперёк круга, с полями
  let cw = 0;
  let ch = 0;
  let hoopCam: Camera | null = null;
  if (area) {
    const aw = area.w * STAGE_FILL;
    const ah = area.h * STAGE_FILL;
    if (hoop) {
      const d = Math.max(1, Math.floor(Math.min(aw, ah) - 2 * HOOP_DP));
      const s = Math.min(MAX_DP, (d - 2 * MARGIN_DP) / Math.hypot(pattern.w, pattern.h));
      cw = d;
      ch = d;
      hoopCam = { s, tx: (d - pattern.w * s) / 2, ty: (d - pattern.h * s) / 2 };
    } else {
      const s = Math.min(MAX_DP, (aw - 2 * FRAME_DP - 2 * MARGIN_DP) / pattern.w, (ah - 2 * FRAME_DP - 2 * MARGIN_DP) / pattern.h);
      cw = Math.max(1, Math.floor(pattern.w * s + 2 * MARGIN_DP));
      ch = Math.max(1, Math.floor(pattern.h * s + 2 * MARGIN_DP));
    }
  }
  const work = (
    <StitchCanvas pattern={pattern} stitched={session?.state.stitched ?? new Uint8Array(0)} selected={-1}
      mosaic={settings.style === 'mosaic'} hatch={false} bigNumbers={false} fill={false} font={font!}
      width={cw} height={ch} apiRef={api} viewOnly ghost canvas={looks.canvas} evenField={hoop} initial={hoopCam ?? 'fit'} />
  );

  return (
    <Screen title={T.done.title} onBack={onBack}
      right={<Button small kind="ghost" label={T.done.settings} onPress={onSettings} testID="done-settings" />}>
      <View style={styles.body}>
        <View style={[styles.stage, { backgroundColor: theme.bg }]} onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {area && font && session && cw > 0 ? (
            hoop ? (
              // пяльцы: светлый обод из двух колец, внутри — круг ткани; винт — сверху
              <Animated.View entering={fresh ? FadeIn.duration(450) : undefined} testID="done-frame"
                style={[styles.hoop, { width: cw + 2 * HOOP_DP, height: ch + 2 * HOOP_DP, borderRadius: cw / 2 + HOOP_DP, backgroundColor: frame.light }]}>
                <View style={[styles.hoopRing, { borderRadius: cw / 2 + HOOP_DP / 2, borderColor: frame.dark }]} />
                <View style={{ width: cw, height: ch, borderRadius: cw / 2, overflow: 'hidden' }}>{work}</View>
                <View style={[styles.inset, { left: HOOP_DP, top: HOOP_DP, right: HOOP_DP, bottom: HOOP_DP, borderRadius: cw / 2 }]} />
                <View style={[styles.clasp, { left: cw / 2 + HOOP_DP - 15, borderColor: frame.dark }]} />
              </Animated.View>
            ) : (
              <Animated.View entering={fresh ? FadeIn.duration(450) : undefined} testID="done-frame"
                style={[styles.frame, {
                  width: cw + 2 * FRAME_DP, height: ch + 2 * FRAME_DP,
                  borderTopColor: frame.light, borderLeftColor: frame.light, borderBottomColor: frame.dark, borderRightColor: frame.dark,
                }]}>
                {work}
                {/* золочение багета — тонкой полоской по внутреннему краю */}
                {frame.inner ? <View style={[styles.gilt, { borderColor: frame.inner }]} /> : null}
                {/* рамка бросает тень на паспарту */}
                <View style={styles.inset} />
              </Animated.View>
            )
          ) : <ActivityIndicator style={styles.wait} color={theme.accent} />}
          {playing && order.length ? (
            <View style={[styles.track, { backgroundColor: theme.border }]} testID="replay-bar">
              <View style={[styles.fill, { backgroundColor: theme.accent, width: `${(100 * count) / order.length}%` }]} />
            </View>
          ) : null}
        </View>
        <Animated.View entering={fresh ? FadeInDown.duration(350).delay(200) : undefined} style={styles.info}>
          <Txt title style={styles.title}>{title}</Txt>
          {caption ? <Txt dim style={styles.caption}>{caption}</Txt> : null}
          {session ? (
            playing
              ? <Txt dim testID="replay-count">{T.done.replayCount(count, order.length)}</Txt>
              : <Txt dim testID="done-stats">{T.done.stats(order.length, session.minutes)}</Txt>
          ) : null}
          {note ? <Txt style={{ color: theme.danger }}>{note}</Txt> : null}
          <View style={[styles.row, stacked && styles.stacked]}>
            {playing
              ? <Button kind="secondary" label={T.done.skip} onPress={skip} testID="skip" style={stacked ? undefined : styles.half} />
              : <Button kind="secondary" label={T.done.replay} onPress={replay} testID="replay" style={stacked ? undefined : styles.half} />}
            <Button kind="secondary" label={sharing ? T.done.sharing : T.done.share} onPress={() => void share()} disabled={!session || !font || !titleFont || !textFont || sharing}
              testID="share" style={stacked ? undefined : styles.half} />
          </View>
          {pic && hasAbout(pic) ? <Button kind="ghost" small label={T.done.about} onPress={() => setAbout(!about)} testID="done-about" /> : null}
          {onNext ? <Button label={T.done.next} onPress={() => onNext(next())} testID="next" /> : null}
          {onAgain ? <Button label={T.done.again} onPress={onAgain} testID="done-again" /> : null}
          {offer ? <Button kind="ghost" small label={T.plus.offer} onPress={onPlus} testID="done-plus" /> : null}
        </Animated.View>
        {/* «О картине» — поверх всего экрана, а не только работы: на узком телефоне ей там тесно */}
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  stage: { flex: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  frame: { borderWidth: FRAME_DP, borderRadius: 2, boxShadow: '0px 6px 16px rgba(28, 20, 12, 0.35)' },
  gilt: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderWidth: 1.5, pointerEvents: 'none' },
  hoop: { padding: HOOP_DP, boxShadow: '0px 6px 16px rgba(28, 20, 12, 0.35)' },
  // шов между внутренним и внешним кольцом пялец
  hoopRing: { position: 'absolute', left: HOOP_DP / 2, top: HOOP_DP / 2, right: HOOP_DP / 2, bottom: HOOP_DP / 2, borderWidth: 1.5, opacity: 0.55, pointerEvents: 'none' },
  // винт пялец — латунная планка поверх обода
  clasp: { position: 'absolute', top: -7, width: 30, height: 16, borderRadius: 4, borderWidth: 1.5, backgroundColor: '#c9b98f', pointerEvents: 'none' },
  inset: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, pointerEvents: 'none', boxShadow: 'inset 1px 2px 4px rgba(20, 14, 8, 0.45)' },
  // полоса повтора — у нижнего края сцены, поверх льна: её появление ничего не сдвигает
  track: { position: 'absolute', left: 24, right: 24, bottom: 6, height: 3, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 3 },
  wait: { margin: 24 },
  backdrop: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(20, 20, 24, 0.25)', padding: 12, justifyContent: 'center' },
  panel: { borderWidth: 1, borderRadius: 8, padding: 14, maxHeight: '100%' },
  aboutBody: { gap: 10 },
  info: { padding: 16, gap: 6 },
  title: { fontSize: 24 },
  caption: { fontSize: 14 },
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },
  stacked: { flexDirection: 'column' },
  half: { flexGrow: 1, flexBasis: 0 },
});

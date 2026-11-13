// «Светлица» (1.1.0, docs/specs/2026-11-svetlitsa.md): все готовые работы висят на стенах комнаты, новые — первыми.
// Стены листаются вбок; касание работы открывает её «Готово». Только что вышитая работа (`focus`) вешается на гвоздь
// у вас на глазах: стена рисуется без неё, а она опускается на своё место отдельной картинкой. «Поделиться стеной» —
// стена картинкой PNG с подписью «Вышито в „Узорах“».
import { Onest_500Medium } from '@expo-google-fonts/onest/500Medium';
import { useFont } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, PixelRatio, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import { wallOf } from '../engine/gallery';
import type { WallLook } from '../engine/looks';
import { T } from '../i18n';
import { pieceUri, wallImage, wallPng, wallUri } from '../render/gallery';
import { picturesOf, wallPicture, wallsOf } from '../render/walls';
import { logError } from '../state/crashlog';
import { useLooks } from '../state/looks';
import { useSettings } from '../state/settings';
import { shareFile } from '../state/share';
import { type HungWork, loadHung } from '../state/svetlitsa';
import { Button, Screen, Txt } from '../ui/components';

/** Точек на dp у картинок стен: как у «Готово». */
const K_MAX = 2.5;

export function SvetlitsaScreen({ focus, onBack, onOpen, onLooks }: {
  /** только что вышитая работа: стена с ней — первой, а она вешается на гвоздь у вас на глазах */
  focus?: string;
  onBack: () => void;
  onOpen: (work: HungWork) => void;
  onLooks: () => void;
}) {
  const { theme, settings } = useSettings();
  const looks = useLooks();
  const font = useFont(Onest_500Medium, 20);
  const [works, setWorks] = useState<HungWork[] | null>(null);
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  const [page, setPage] = useState(0);
  const [uris, setUris] = useState<Map<string, string | null>>(new Map());
  const [sharing, setSharing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const scroller = useRef<ScrollView | null>(null);
  const k = Math.min(K_MAX, PixelRatio.get());

  useEffect(() => {
    let alive = true;
    void loadHung().then((list) => {
      if (alive) setWorks(list);
    }, (e) => {
      logError('work', e, 'svetlitsa');
      if (alive) setWorks([]);
    });
    return () => {
      alive = false;
    };
  }, []);

  const layout = useMemo(() => (works && area ? wallsOf(works, looks, area.w, area.h) : null),
    // раскладка — одна на работы, площадь и оформление
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [works, area?.w, area?.h, looks.owned, looks.open, looks.mat, k]);
  const walls = layout?.walls ?? [];
  const focusWall = focus && layout ? wallOf(layout.walls, focus) : -1;
  const lookKey = `${looks.wall.id} ${looks.mat ? 1 : 0} ${looks.owned.join(',')} ${looks.open ? 1 : 0} ${area?.w}x${area?.h}`;

  // стена с только что вышитой работой — сразу на экране
  useEffect(() => {
    if (focusWall > 0 && area) {
      requestAnimationFrame(() => {
        setPage(focusWall);
        scroller.current?.scrollTo({ x: focusWall * area.w, animated: false });
      });
    }
  }, [focusWall, area]);

  // стены рисуются по одной, нынешняя и соседние, — пока экран не ушёл
  useEffect(() => {
    if (!layout || !area || !works || !font) return;
    let alive = true;
    const want = [page, page + 1, page - 1].filter((i) => i >= 0 && i < layout.walls.length);
    void (async () => {
      for (const i of want) {
        const key = `${i} ${lookKey}`;
        if (uris.has(key)) continue;
        await new Promise((r) => setTimeout(r, 0));
        if (!alive) return;
        const uri = wallPicture({ plan: layout.walls[i], pieces: layout.pieces, works, W: area.w, H: area.h, k, wall: looks.wall, font,
          skip: i === focusWall ? focus : undefined });
        if (!alive) return;
        setUris((m) => new Map(m).set(key, uri));
      }
    })();
    return () => {
      alive = false;
    };
    // uris — не повод рисовать снова: стены с ключом уже есть
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, area, works, font, page, lookKey]);

  // только что вышитая работа — отдельной картинкой поверх своей стены
  const piece = useMemo(() => {
    const p = focus && layout ? layout.pieces.get(focus) : undefined;
    const wall = layout?.walls[focusWall];
    if (!p || !wall || !works || !font || !layout) return null;
    picturesOf(wall, layout.pieces, works, k);
    return pieceUri(p, k, font);
  }, [focus, layout, focusWall, works, font, k]);
  useEffect(() => {
    if (!piece || !settings.haptics || Platform.OS === 'web') return;
    // щелчок — когда работа садится на гвоздь
    const t = setTimeout(() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), 1000);
    return () => clearTimeout(t);
  }, [piece, settings.haptics]);

  const share = async () => {
    if (!layout || !area || !works || !font || sharing) return;
    setSharing(true);
    setNote(null);
    try {
      await new Promise((r) => setTimeout(r, 30));
      const plan = layout.walls[page];
      const png = wallPng(wallImage({ W: area.w, H: area.h, k: 3, wall: looks.wall, pieces: picturesOf(plan, layout.pieces, works, 3), font, mark: T.svetlitsa.mark }));
      font.setSize(20);
      if (!png || !(await shareFile(png, 'uzory-svetlitsa.png', 'image/png', T.svetlitsa.share))) setNote(T.svetlitsa.shareFailed);
    } catch (e) {
      logError('work', e, 'svetlitsa share');
      setNote(T.svetlitsa.shareFailed);
    } finally {
      setSharing(false);
    }
  };

  const go = (i: number) => {
    if (!area) return;
    const to = Math.max(0, Math.min(walls.length - 1, i));
    setPage(to);
    scroller.current?.scrollTo({ x: to * area.w, animated: true });
  };

  const count = works?.length ?? 0;
  return (
    <Screen title={T.svetlitsa.title} onBack={onBack}
      right={<Button small kind="ghost" label={T.svetlitsa.looks} onPress={onLooks} testID="svetlitsa-looks" />}>
      <View style={styles.body}>
        <View style={styles.stage} onLayout={(e) => setArea({ w: Math.floor(e.nativeEvent.layout.width), h: Math.floor(e.nativeEvent.layout.height) })}>
          {!works || !area || !font ? <ActivityIndicator style={styles.wait} color={theme.accent} /> : walls.length ? (
            <ScrollView ref={scroller} horizontal pagingEnabled showsHorizontalScrollIndicator={false} testID="svetlitsa-walls"
              onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / area.w))}>
              {walls.map((plan, i) => {
                const uri = uris.get(`${i} ${lookKey}`);
                return (
                  <View key={i} style={{ width: area.w, height: area.h }} testID={`svetlitsa-wall-${i}`}>
                    {uri ? <Animated.Image entering={FadeIn.duration(250)} source={{ uri }} style={{ width: area.w, height: area.h }} testID="svetlitsa-wall-image" />
                      : <ActivityIndicator style={styles.wait} color={theme.accent} />}
                    {uri && i === focusWall && piece?.uri ? (
                      <Animated.Image entering={FadeInUp.duration(700).delay(350)} source={{ uri: piece.uri }} testID="svetlitsa-new"
                        style={{ position: 'absolute', left: piece.at.x, top: piece.at.y, width: piece.at.w, height: piece.at.h }} />
                    ) : null}
                    {plan.items.map((h) => {
                      const w = works.find((x) => x.id === h.id);
                      return w ? (
                        <Pressable key={h.id} onPress={() => onOpen(w)} accessibilityRole="button" accessibilityLabel={w.title} testID={`svetlitsa-work-${h.id}`}
                          style={{ position: 'absolute', left: h.frame.x, top: h.frame.y, width: h.frame.w, height: h.plaque.y + h.plaque.h - h.frame.y }} />
                      ) : null;
                    })}
                  </View>
                );
              })}
            </ScrollView>
          ) : (
            <View style={styles.empty}>
              <EmptyRoom w={area.w} h={area.h} wall={looks.wall} k={k} />
              <Txt style={styles.emptyText} testID="svetlitsa-empty">{T.svetlitsa.empty}</Txt>
            </View>
          )}
        </View>
        <View style={styles.info}>
          {walls.length ? (
            <View style={styles.row}>
              <Button small kind="ghost" label="‹" onPress={() => go(page - 1)} disabled={page === 0} testID="svetlitsa-prev" />
              <Txt dim style={styles.grow} testID="svetlitsa-count">{`${T.svetlitsa.count(count)} · ${T.svetlitsa.wall(page + 1, walls.length)}`}</Txt>
              <Button small kind="ghost" label="›" onPress={() => go(page + 1)} disabled={page >= walls.length - 1} testID="svetlitsa-next" />
            </View>
          ) : null}
          {note ? <Txt style={{ color: theme.danger }}>{note}</Txt> : null}
          {walls.length ? (
            <Button kind="secondary" label={sharing ? T.svetlitsa.sharing : T.svetlitsa.share} onPress={() => void share()} disabled={sharing} testID="svetlitsa-share" />
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

/** Пустая комната — та же стена с рушником и полом, без работ. */
function EmptyRoom({ w, h, wall, k }: { w: number; h: number; wall: WallLook; k: number }) {
  const uri = useMemo(() => wallUri(wallImage({ W: w, H: h, k, wall, pieces: [], font: null })), [w, h, wall, k]);
  return uri ? <Image source={{ uri }} style={{ position: 'absolute', left: 0, top: 0, width: w, height: h }} /> : null;
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  stage: { flex: 1, overflow: 'hidden' },
  wait: { margin: 24 },
  empty: { flex: 1, justifyContent: 'center', padding: 32 },
  emptyText: { textAlign: 'center', backgroundColor: 'rgba(244, 239, 228, 0.92)', color: '#2d302e', padding: 14, borderRadius: 6 },
  info: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1, textAlign: 'center' },
});

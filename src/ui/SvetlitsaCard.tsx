// «Светлица» на главной (1.1.0, docs/specs/2026-11-svetlitsa.md): полоса стены с последними готовыми работами и
// число работ; касание — «Светлица». Пока готовых работ нет, карточки нет.
import { Onest_500Medium } from '@expo-google-fonts/onest/500Medium';
import { useFont } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { T } from '../i18n';
import { wallPicture, wallsOf } from '../render/walls';
import { useLooks } from '../state/looks';
import { useSettings } from '../state/settings';
import { type HungWork, loadHung } from '../state/svetlitsa';
import type { WorkEntry } from '../state/works';
import { Card, Txt } from './components';

/** Высота полосы стены, dp: один ряд работ. */
const STRIP_H = 220;

export function SvetlitsaCard({ works, onOpen }: { works: WorkEntry[] | null; onOpen: () => void }) {
  const { theme } = useSettings();
  const looks = useLooks();
  const font = useFont(Onest_500Medium, 20);
  const done = works?.filter((w) => !!w.finished) ?? [];
  const key = done.map((w) => w.id).join(',');
  const [hung, setHung] = useState<HungWork[] | null>(null);
  const [width, setWidth] = useState(0);
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    if (!key) return;
    let alive = true;
    void loadHung().then((list) => {
      if (alive) setHung(list);
    }, () => undefined);
    return () => {
      alive = false;
    };
  }, [key]);

  const lookKey = `${looks.wall.id} ${looks.mat ? 1 : 0} ${looks.owned.join(',')} ${looks.open ? 1 : 0}`;
  useEffect(() => {
    if (!hung?.length || !width || !font) return;
    // главная уже на экране: стена рисуется чуть позже, не задерживая её
    const t = setTimeout(() => {
      const k = Math.min(2, PixelRatio.get());
      const { walls, pieces } = wallsOf(hung, looks, width, STRIP_H);
      if (walls[0]) setUri(wallPicture({ plan: walls[0], pieces, works: hung, W: width, H: STRIP_H, k, wall: looks.wall, font }));
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hung, width, font, lookKey]);

  if (!done.length) return null;
  return (
    <Card style={styles.card} onPress={onOpen} testID="home-svetlitsa">
      <View style={[styles.strip, { backgroundColor: theme.surfaceAlt }]} onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}>
        {uri ? <Animated.Image entering={FadeIn.duration(300)} source={{ uri }} style={styles.img} /> : null}
      </View>
      <View style={styles.text}>
        <Txt title style={styles.h}>{T.svetlitsa.open}</Txt>
        <Txt dim testID="home-svetlitsa-count">{hung ? T.svetlitsa.count(hung.length) : T.svetlitsa.note}</Txt>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: 0, overflow: 'hidden' },
  strip: { width: '100%', height: STRIP_H },
  img: { width: '100%', height: '100%' },
  text: { padding: 14, gap: 2 },
  h: { fontSize: 20 },
});

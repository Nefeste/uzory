// «Лист» (docs/specs/2026-09-spikes.md, П3): узоры встроенного набора на телефоне —
// как их увидит игрок, с числами проверок. Владелец отмечает, что «узнаётся и красиво».
import { useMemo } from 'react';
import { FlatList, Image, StyleSheet, View } from 'react-native';
import type { PackPicture } from '../engine/pack';
import { estimateMinutes } from '../engine/pattern';
import { patternStats } from '../engine/stats';
import { T } from '../i18n';
import { patternOf, pictures } from '../state/library';
import { Card, Screen, Txt } from '../ui/components';
import { previewUri } from '../render/preview';

interface Row {
  pic: PackPicture;
  uri: string | null;
  meta: string;
  stats: string;
}

export function SheetScreen({ onBack, onOpen }: { onBack: () => void; onOpen: (pic: PackPicture) => void }) {
  const rows = useMemo<Row[]>(() => pictures().filter((p) => !p.hidden).map((pic) => {
    const p = patternOf(pic);
    const st = patternStats(p);
    return {
      pic,
      uri: previewUri(p, 'done', 480),
      meta: `${T.common.sizes[pic.size]} · ${T.common.meta(p.w, p.h, p.threads.length, estimateMinutes(p))}`,
      stats: T.sheet.stats(st.singles.toFixed(1), st.small.toFixed(1), Number.isFinite(st.minDelta) ? st.minDelta.toFixed(3) : '—'),
    };
  }), []);

  return (
    <Screen title={T.sheet.title} onBack={onBack}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.pic.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Txt dim style={styles.empty}>{T.sheet.empty}</Txt>}
        renderItem={({ item }) => (
          <Card onPress={() => onOpen(item.pic)} style={styles.card} testID={`sheet-${item.pic.id}`}>
            {item.uri ? <Image source={{ uri: item.uri }} style={styles.img} resizeMode="contain" /> : null}
            <View style={styles.text}>
              <Txt title style={styles.title}>{item.pic.title}</Txt>
              {item.pic.author ? <Txt dim>{[item.pic.author.name, item.pic.made].filter(Boolean).join(', ')}</Txt> : null}
              <Txt>{item.meta}</Txt>
              <Txt dim style={styles.small}>{item.stats}</Txt>
              {item.pic.trial ? <Txt dim style={styles.small}>{T.sheet.notForRelease}</Txt> : null}
            </View>
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: 12, gap: 12 },
  card: { padding: 0, overflow: 'hidden' },
  img: { width: '100%', aspectRatio: 1.25, backgroundColor: '#e2e3da' },
  text: { padding: 12, gap: 2 },
  title: { fontSize: 19 },
  small: { fontSize: 12 },
  empty: { margin: 24 },
});

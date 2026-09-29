// Коллекция целиком (docs/specs/2026-09-library.md, «Библиотека», «Все»): сетка по три превью в
// ряд (на широком экране — больше), сверху — размер и «Скрыть готовые».
import { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';
import type { CollectionId } from '../engine/library';
import type { PackPicture } from '../engine/pack';
import type { SizeClass } from '../engine/pattern';
import { T } from '../i18n';
import { percentOf, useCatalog } from '../state/catalog';
import { useSettings } from '../state/settings';
import { Screen, Segmented, ToggleRow, Txt } from '../ui/components';
import { PicTile } from '../ui/PicTile';

type SizeFilter = 'all' | SizeClass;
const SIZES: SizeFilter[] = ['all', 'S', 'M', 'L', 'XL'];

export function CollectionScreen({ id, onBack, onOpen }: { id: CollectionId; onBack: () => void; onOpen: (pic: PackPicture) => void }) {
  const { theme } = useSettings();
  const cat = useCatalog();
  const { width } = useWindowDimensions();
  const [size, setSize] = useState<SizeFilter>('all');
  const [hideDone, setHideDone] = useState(false);
  // три в ряд на телефоне; на широком окне — сколько войдёт по ~150 dp
  const inner = Math.min(width, 1200) - 32;
  const cols = Math.max(3, Math.floor(inner / 150));
  const tile = Math.floor((inner - 10 * (cols - 1)) / cols);
  const all = cat?.collections.find((c) => c.id === id)?.pictures ?? [];
  const has = new Set(all.map((p) => p.size));
  const list = cat ? all.filter((p) => (size === 'all' || p.size === size) && !(hideDone && cat.done(p))) : [];

  return (
    <Screen title={T.library.collections[id]} onBack={onBack} wide={cols > 3}>
      {!cat ? <ActivityIndicator style={styles.wait} color={theme.accent} /> : (
        <FlatList key={cols} numColumns={cols} data={list} keyExtractor={(p) => p.id} testID="collection"
          columnWrapperStyle={styles.gridRow} contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.filters}>
              <Segmented<SizeFilter> value={size} onChange={setSize} testID="col-size"
                options={SIZES.filter((s) => s === 'all' || has.has(s)).map((s) => ({ id: s, label: T.library.sizes[s] }))} />
              <ToggleRow label={T.library.hideDone} value={hideDone} onChange={setHideDone} testID="col-hide-done" />
            </View>
          }
          ListEmptyComponent={<Txt dim>{T.library.none}</Txt>}
          renderItem={({ item }) => {
            const w = cat.workOf(item);
            return (
              <PicTile pic={item} size={tile} done={cat.done(item)} percent={w && !w.finished ? percentOf(w) : undefined}
                isNew={cat.isNew(item)} plus={cat.plusOnly(item)} onPress={() => onOpen(item)} testID={`tile-${item.id}`} />
            );
          }} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  wait: { margin: 24 },
  list: { padding: 16, gap: 14 },
  gridRow: { gap: 10 },
  filters: { gap: 4, marginBottom: 6 },
});

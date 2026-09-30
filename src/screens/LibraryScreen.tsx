// Библиотека (docs/specs/2026-09-library.md, «Библиотека»): коллекции рядами по восемь превью
// с прокруткой вбок и кнопкой «Все»; порядок коллекций — docs/09-content.md, §1.
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, View } from 'react-native';
import type { CollectionId } from '../engine/library';
import type { PackPicture } from '../engine/pack';
import { T } from '../i18n';
import { percentOf, useCatalog } from '../state/catalog';
import { useSettings } from '../state/settings';
import { Button, Screen, Txt } from '../ui/components';
import { PicTile } from '../ui/PicTile';

/** Превью в ряду коллекции. */
export const ROW_TILES = 8;
const TILE = 112;

export function LibraryScreen({ onBack, onOpen, onCollection }: {
  onBack: () => void;
  onOpen: (pic: PackPicture) => void;
  onCollection: (id: CollectionId) => void;
}) {
  const { theme } = useSettings();
  const cat = useCatalog();
  return (
    <Screen title={T.library.title} onBack={onBack}>
      {!cat ? <ActivityIndicator style={styles.wait} color={theme.accent} /> : (
        <FlatList data={cat.collections} keyExtractor={(c) => c.id} contentContainerStyle={styles.list} testID="library"
          // ряд коллекции — восемь превью: сразу — ряды первого экрана, дальше — по прокрутке
          initialNumToRender={4} windowSize={5}
          ListEmptyComponent={<Txt dim>{T.library.none}</Txt>}
          renderItem={({ item }) => (
            <View style={styles.row} testID={`lib-${item.id}`}>
              <View style={styles.head}>
                <View style={styles.headText}>
                  <Txt title style={styles.h}>{T.library.collections[item.id]}</Txt>
                  <Txt dim style={styles.count}>{T.library.count(item.pictures.length)}</Txt>
                </View>
                <Button small kind="ghost" label={T.library.all} onPress={() => onCollection(item.id)} testID={`lib-all-${item.id}`} />
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tiles}>
                {item.pictures.slice(0, ROW_TILES).map((p) => {
                  const w = cat.workOf(p);
                  return (
                    <PicTile key={p.id} pic={p} size={TILE} done={cat.done(p)} percent={w && !w.finished ? percentOf(w) : undefined}
                      isNew={cat.isNew(p)} plus={cat.plusOnly(p)} onPress={() => onOpen(p)} testID={`tile-${p.id}`} />
                  );
                })}
              </ScrollView>
            </View>
          )} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  wait: { margin: 24 },
  list: { paddingVertical: 12, gap: 18 },
  row: { gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  headText: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  h: { fontSize: 20 },
  count: { fontSize: 13 },
  tiles: { paddingHorizontal: 16, gap: 10 },
});

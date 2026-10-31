// Библиотека (docs/specs/2026-09-library.md, «Библиотека»): коллекции рядами по восемь превью
// с прокруткой вбок и кнопкой «Все»; порядок коллекций — docs/09-content.md, §1. Вверху — «Тайна»
// (issue 117, А): выбор размера, а пока начатая «тайна» не закончена — «Продолжить тайну».
import { useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, View } from 'react-native';
import type { CollectionId } from '../engine/library';
import { type MysterySize, mysteryPool, pickMystery } from '../engine/mystery';
import type { PackPicture } from '../engine/pack';
import { T } from '../i18n';
import { percentOf, useCatalog } from '../state/catalog';
import { patternByKey } from '../state/library';
import { useSettings } from '../state/settings';
import { Button, Card, Screen, Txt } from '../ui/components';
import { PicTile } from '../ui/PicTile';

/** Превью в ряду коллекции. */
export const ROW_TILES = 8;
const TILE = 112;

export function LibraryScreen({ onBack, onOpen, onCollection, onMystery }: {
  onBack: () => void;
  onOpen: (pic: PackPicture) => void;
  onCollection: (id: CollectionId) => void;
  /** «Тайна»: новая работа по картинке `pic` или продолжение начатой */
  onMystery: (pic: PackPicture, workId?: string) => void;
}) {
  const { theme } = useSettings();
  const cat = useCatalog();
  const [none, setNone] = useState(false);

  // одна «тайна» за раз: пока начатая не закончена, кнопка ведёт к ней
  const open = cat?.works.find((w) => w.mystery && !w.finished);
  const openPic = open ? patternByKey(open.pattern)?.pic : undefined;
  const pick = (size: MysterySize) => {
    if (!cat) return;
    const started = new Set(cat.works.map((w) => w.pattern.slice(0, w.pattern.lastIndexOf('@'))));
    const pool = mysteryPool(cat.pictures, size, {
      // в сборке для проверки без замка «Узоров+» доступно всё, как и на карточке картинки
      access: (p) => (cat.locked(p) ? 'locked' : cat.access(p) === 'locked' ? 'plus' : cat.access(p)),
      hasWork: (p) => started.has(p.id),
      dailyId: cat.dailyId,
    });
    const p = pickMystery(pool, Math.random);
    setNone(!p);
    if (p) onMystery(p);
  };
  const mystery = (
    <Card style={styles.mystery} testID="mystery">
      <Txt title style={styles.h}>{T.mystery.title}</Txt>
      <Txt dim>{T.mystery.note}</Txt>
      {open && openPic ? (
        <Button label={T.mystery.continue(percentOf(open))} onPress={() => onMystery(openPic, open.id)} testID="mystery-continue" />
      ) : (
        <View style={styles.sizes}>
          {(['S', 'M', 'L'] as const).map((s) => (
            <Button key={s} kind="secondary" small label={T.mystery.sizes[s]} onPress={() => pick(s)} testID={`mystery-${s}`} style={styles.size} />
          ))}
        </View>
      )}
      {none ? <Txt dim testID="mystery-none">{T.mystery.none}</Txt> : null}
    </Card>
  );
  return (
    <Screen title={T.library.title} onBack={onBack}>
      {!cat ? <ActivityIndicator style={styles.wait} color={theme.accent} /> : (
        <FlatList data={cat.collections} keyExtractor={(c) => c.id} contentContainerStyle={styles.list} testID="library"
          // ряд коллекции — восемь превью: сразу — ряды первого экрана, дальше — по прокрутке
          initialNumToRender={4} windowSize={5}
          ListHeaderComponent={mystery}
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
  mystery: { marginHorizontal: 16, gap: 8 },
  sizes: { flexDirection: 'row', gap: 8 },
  size: { flexGrow: 1, flexBasis: 0 },
  list: { paddingVertical: 12, gap: 18 },
  row: { gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  headText: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  h: { fontSize: 20 },
  count: { fontSize: 13 },
  tiles: { paddingHorizontal: 16, gap: 10 },
});

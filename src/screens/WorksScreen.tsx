// Мои работы (docs/specs/2026-09-library.md, «Мои работы»): «Начатые» — по последнему открытию,
// превью в нынешнем виде и процент; «Готовые» — по дате окончания. Долгое касание — «Удалить
// работу?». Испорченная работа — «Работа повреждена», исчезнувшая картинка — «Картинка
// недоступна»: не удаляются сами, только руками. Работы своих узоров — в «Моих узорах».
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import type { PackPicture } from '../engine/pack';
import { T } from '../i18n';
import { previewUri } from '../render/preview';
import { percentOf, useCatalog } from '../state/catalog';
import { logError } from '../state/crashlog';
import { patternByKey } from '../state/library';
import { isMineKey } from '../state/mine';
import { useSettings } from '../state/settings';
import { deleteWork, type WorkEntry, workStitched } from '../state/works';
import { Button, Screen, Segmented, Txt } from '../ui/components';

type Tab = 'started' | 'finished';

function WorkRow({ work, onOpen, onRemoved }: { work: WorkEntry; onOpen: (pic: PackPicture, workId?: string) => void; onRemoved: () => void }) {
  const { theme } = useSettings();
  // узор картинки — один на строку: иначе каждый рендер давал бы новый объект и новую загрузку
  const found = useMemo(() => patternByKey(work.pattern), [work.pattern]);
  const [shown, setShown] = useState<{ uri: string | null; broken: boolean } | null>(null);
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!found) return;
    let alive = true;
    void (async () => {
      const stitched = await workStitched(found.pattern, work.id);
      const uri = stitched ? previewUri(found.pattern, work.finished ? 'done' : 'scheme', 240, work.finished ? undefined : stitched) : null;
      if (alive) setShown({ uri, broken: !stitched });
    })();
    return () => {
      alive = false;
    };
  }, [found, work]);

  const remove = async () => {
    setSure(false);
    await deleteWork(work.id);
    onRemoved();
  };
  // картинки работы нет в библиотеке — такого быть не должно (ADR 0010): в журнал
  useEffect(() => {
    if (!found) logError('work', new Error(`no picture for ${work.pattern}`), work.id);
  }, [found, work]);

  const title = found ? found.pic.title : T.works.gone;
  const state = shown?.broken ? T.works.broken
    : work.finished ? T.works.finishedOn(new Date(work.finished)) : T.common.percent(percentOf(work));
  return (
    <Pressable onPress={() => found && !shown?.broken && onOpen(found.pic, work.finished ? undefined : work.id)}
      onLongPress={() => setSure(true)} delayLongPress={450} testID={`work-${work.id}`}
      style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={[styles.img, { backgroundColor: theme.surfaceAlt }]}>
        {shown?.uri ? <Image source={{ uri: shown.uri }} style={styles.fill} resizeMode="contain" /> : null}
      </View>
      <View style={styles.text}>
        <Txt bold numberOfLines={2}>{title}</Txt>
        <Txt dim style={[styles.small, shown?.broken || !found ? { color: theme.danger } : null]}>{state}</Txt>
        {sure || shown?.broken || !found ? (
          <View style={styles.sure}>
            {sure ? <Txt style={styles.small}>{`${T.works.removeSure} ${T.works.removeNote}`}</Txt> : null}
            <View style={styles.buttons}>
              <Button small kind="secondary" label={T.works.remove} onPress={() => void remove()} testID={`work-remove-${work.id}`} />
              {sure ? <Button small kind="ghost" label={T.works.cancel} onPress={() => setSure(false)} /> : null}
            </View>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export function WorksScreen({ onBack, onOpen }: { onBack: () => void; onOpen: (pic: PackPicture, workId?: string) => void }) {
  const { theme } = useSettings();
  const cat = useCatalog();
  const [tab, setTab] = useState<Tab>('started');
  const list = (cat?.works ?? []).filter((w) => !isMineKey(w.pattern) && (tab === 'started' ? !w.finished : !!w.finished));
  // начатые — по последнему открытию (так лежит указатель), готовые — по дате окончания
  if (tab === 'finished') list.sort((a, b) => (b.finished ?? 0) - (a.finished ?? 0));

  return (
    <Screen title={T.works.title} onBack={onBack}>
      {!cat ? <ActivityIndicator style={styles.wait} color={theme.accent} /> : (
        <FlatList data={list} keyExtractor={(w) => w.id} contentContainerStyle={styles.list} testID="works"
          ListHeaderComponent={
            <View style={styles.head}>
              <Segmented<Tab> value={tab} onChange={setTab} testID="works-tab"
                options={[{ id: 'started', label: T.works.started }, { id: 'finished', label: T.works.finished }]} />
              {list.length ? <Txt dim style={styles.small}>{T.works.hold}</Txt> : null}
            </View>
          }
          ListEmptyComponent={<Txt dim>{tab === 'started' ? T.works.emptyStarted : T.works.emptyFinished}</Txt>}
          renderItem={({ item }) => <WorkRow work={item} onOpen={onOpen} onRemoved={cat.reload} />} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  wait: { margin: 24 },
  list: { padding: 16, gap: 10 },
  head: { gap: 8, marginBottom: 4 },
  row: { flexDirection: 'row', gap: 12, padding: 10, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth },
  img: { width: 96, height: 96, borderRadius: 4, overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  text: { flex: 1, gap: 4 },
  small: { fontSize: 13, lineHeight: 18 },
  sure: { gap: 6, marginTop: 4 },
  buttons: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});

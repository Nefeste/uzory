// Главная (docs/08-game-design.md, «Экраны»; docs/specs/2026-09-library.md, «Главная»): картинка
// дня — при первом запуске на её месте первая картинка; «Продолжить» — последняя начатая работа;
// «Библиотека», «Мои работы», «Календарь»; настройки в углу. В сборках 0.x внизу — проверки
// для владельца: «Лист узоров», «Свой узор» (в вебе), «Замер», «Файл работы».
import { useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import type { PackPicture } from '../engine/pack';
import { estimateMinutes } from '../engine/pattern';
import { T } from '../i18n';
import { previewUri } from '../render/preview';
import { dailyCalendar, FIRST_PICTURE, patternByKey, patternOf, pictureById } from '../state/library';
import { PHOTO_PICK } from '../state/photo';
import { usePlayer } from '../state/player';
import { useSettings } from '../state/settings';
import { loadIndex, type WorkEntry, workStitched } from '../state/works';
import { Button, Card, Screen, Txt } from '../ui/components';
import { APP_BUILD, APP_VERSION } from '../version';

/** Проверки для владельца — только во внутренних сборках 0.x (docs/05-process.md, «Версии»). */
export const CHECKS = APP_VERSION.startsWith('0.');

const keyOf = (p: PackPicture) => `${p.id}@${p.v}`;
const percentOf = (w: WorkEntry) => Math.floor((w.done * 100) / Math.max(1, w.total));

export function HomeScreen({ onStitch, onSettings, onSoon, onSheet, onBench, onFile, onMine }: {
  onStitch: (pic: PackPicture, workId?: string) => void;
  onSettings: () => void;
  /** «Библиотека», «Мои работы», «Календарь» — до этапа библиотеки заглушка «Скоро» */
  onSoon: (title: string) => void;
  onSheet: () => void;
  onBench: () => void;
  onFile: () => void;
  /** «Свой узор» — пока только в веб-версии (docs/specs/2026-09-custom.md) */
  onMine: () => void;
}) {
  const { theme } = useSettings();
  const { player, today, loaded, update } = usePlayer();
  const [works, setWorks] = useState<WorkEntry[] | null>(null);
  useEffect(() => {
    void loadIndex().then(setWorks);
  }, []);

  const first = pictureById(FIRST_PICTURE);
  const firstWork = first && works ? works.find((w) => w.pattern === keyOf(first)) : undefined;
  // первая картинка, вышитая до 0.2, тоже считается: главная сразу с картинкой дня
  const firstDone = player.firstDone || !!firstWork?.finished;
  useEffect(() => {
    if (loaded && !player.firstDone && firstWork?.finished) update({ firstDone: true });
  }, [loaded, player.firstDone, firstWork, update]);

  // картинка дня; показанная по запасному правилу закрепляется — завтрашний набор её не сменит
  const calendar = useMemo(() => dailyCalendar(player.pinned), [player.pinned]);
  const dailyId = calendar.on(today);
  const fallback = dailyId !== undefined && calendar.isFallback(today);
  useEffect(() => {
    if (loaded && fallback && dailyId) update((p) => ({ pinned: { ...p.pinned, [today]: dailyId } }));
  }, [loaded, fallback, dailyId, today, update]);

  const pic = !firstDone || !dailyId ? first : pictureById(dailyId) ?? first;
  const isFirst = pic?.id === FIRST_PICTURE;
  const pattern = pic ? patternOf(pic) : null;
  const work = pic && works ? works.find((w) => w.pattern === keyOf(pic)) : undefined;
  // последняя открытая работа, кроме той, что уже на карточке
  const last = works?.find((w) => !w.finished && (!pic || w.pattern !== keyOf(pic)) && patternByKey(w.pattern));
  const lastPic = last ? patternByKey(last.pattern)?.pic : undefined;

  // превью — схемой, пока не начата; начатая — цветом там, где вышито; готовая — целиком
  const previewKey = pic ? `${keyOf(pic)} ${work?.id ?? ''} ${work?.done ?? 0} ${work?.finished ? 1 : 0}` : '';
  const [preview, setPreview] = useState<{ key: string; uri: string | null } | null>(null);
  useEffect(() => {
    if (!pattern || !previewKey) return;
    let alive = true;
    void (async () => {
      const stitched = work && !work.finished && work.done > 0 ? await workStitched(pattern, work.id) : null;
      const uri = previewUri(pattern, work?.finished ? 'done' : 'scheme', 480, stitched ?? undefined);
      if (alive) setPreview({ key: previewKey, uri });
    })();
    return () => {
      alive = false;
    };
  }, [pattern, work, previewKey]);

  const label = work?.finished ? T.home.doneMark : work ? T.home.continue(percentOf(work)) : T.home.stitch;
  // пока не прочитаны игрок и работы, карточки нет: иначе мелькнула бы первая картинка у того, кто её вышил
  const ready = loaded && works !== null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.top}>
          <Txt title style={styles.logo}>{T.common.appName}</Txt>
          <Button small kind="ghost" label={T.home.settings} onPress={onSettings} testID="home-settings" />
        </View>
        {ready && pic && pattern ? (
          <Card style={styles.daily} testID="home-daily">
            <View style={[styles.imgBox, { backgroundColor: theme.surfaceAlt }]}>
              {preview?.key === previewKey && preview.uri ? <Image source={{ uri: preview.uri }} style={styles.img} resizeMode="contain" /> : null}
            </View>
            <View style={styles.dailyText}>
              {/* у первой картинки название и так «Первая картинка» */}
              {isFirst ? null : <Txt dim bold style={styles.kicker}>{T.home.daily}</Txt>}
              <Txt title style={styles.h2}>{pic.title}</Txt>
              <Txt dim>{isFirst ? T.home.firstNote : T.common.picMeta(pic.size, pattern.threads.length, estimateMinutes(pattern))}</Txt>
              <Button label={label} disabled={!!work?.finished} style={styles.btn} testID={isFirst ? 'first-stitch' : 'daily-stitch'}
                onPress={() => onStitch(pic, work && !work.finished ? work.id : undefined)} />
              {work?.finished && !isFirst ? (
                <View style={styles.row}>
                  <Txt dim style={styles.grow}>{T.home.tomorrow}</Txt>
                  <Button small kind="ghost" label={T.home.calendar} onPress={() => onSoon(T.home.calendar)} />
                </View>
              ) : null}
            </View>
          </Card>
        ) : null}
        {last && lastPic ? (
          <Button kind="secondary" label={T.home.last(lastPic.title, percentOf(last))}
            onPress={() => onStitch(lastPic, last.id)} testID="continue" />
        ) : null}
        <View style={styles.nav}>
          <Button kind="secondary" label={T.home.library} onPress={() => onSoon(T.home.library)} testID="home-library" />
          <Button kind="secondary" label={T.home.works} onPress={() => onSoon(T.home.works)} testID="home-works" />
          <Button kind="secondary" label={T.home.calendar} onPress={() => onSoon(T.home.calendar)} testID="home-calendar" />
        </View>
        {CHECKS ? (
          <View style={styles.checks}>
            <Txt dim bold style={styles.kicker}>{T.home.check}</Txt>
            <Txt dim style={styles.note}>{T.home.checkNote}</Txt>
            {PHOTO_PICK ? (
              <Card onPress={onMine} testID="home-mine">
                <Txt bold style={styles.h3}>{T.home.mine}</Txt>
                <Txt dim>{T.home.mineNote}</Txt>
              </Card>
            ) : null}
            <Card onPress={onSheet} testID="home-sheet">
              <Txt bold style={styles.h3}>{T.home.sheet}</Txt>
              <Txt dim>{T.home.sheetNote}</Txt>
            </Card>
            <Card onPress={onBench} testID="home-bench">
              <Txt bold style={styles.h3}>{T.home.bench}</Txt>
              <Txt dim>{T.home.benchNote}</Txt>
            </Card>
            <Card onPress={onFile} testID="home-file">
              <Txt bold style={styles.h3}>{T.home.file}</Txt>
              <Txt dim>{T.home.fileNote}</Txt>
            </Card>
          </View>
        ) : null}
        <Txt dim style={styles.version}>{T.common.version(APP_VERSION, APP_BUILD)}</Txt>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logo: { fontSize: 36 },
  daily: { padding: 0, overflow: 'hidden' },
  imgBox: { width: '100%', aspectRatio: 1.5 },
  img: { width: '100%', height: '100%' },
  dailyText: { padding: 14, gap: 4 },
  kicker: { fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6 },
  h2: { fontSize: 22 },
  h3: { fontSize: 17 },
  btn: { marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  grow: { flex: 1 },
  nav: { gap: 10 },
  checks: { gap: 10, marginTop: 14 },
  note: { fontSize: 13, lineHeight: 18 },
  version: { fontSize: 13, textAlign: 'center', marginTop: 8 },
});

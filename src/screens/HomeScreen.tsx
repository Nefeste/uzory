// Главная сборки для проверки (0.x, docs/07-roadmap.md): первая картинка, «Свой узор» (в вебе)
// и три проверки — «Лист», «Замер», «Файл работы». Экраны игры — к концу 0.1.
import { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { PHOTO_PICK } from '../state/photo';
import type { PackPicture } from '../engine/pack';
import { T } from '../i18n';
import { estimateMinutes } from '../engine/pattern';
import { FIRST_PICTURE, patternOf, pictureById, pictures } from '../state/library';
import { loadIndex, type WorkEntry } from '../state/works';
import { previewUri } from '../render/preview';
import { APP_BUILD, APP_VERSION } from '../version';
import { Button, Card, Screen, Txt } from '../ui/components';
import { useSettings } from '../state/settings';

export function HomeScreen({ onStitch, onSheet, onBench, onFile, onMine, onReport }: {
  onStitch: (pic: PackPicture, workId?: string) => void;
  onSheet: () => void;
  onBench: () => void;
  onFile: () => void;
  /** «Свой узор» — пока только в веб-версии (docs/specs/2026-09-custom.md) */
  onMine: () => void;
  onReport: () => void;
}) {
  const { theme } = useSettings();
  const [works, setWorks] = useState<WorkEntry[] | null>(null);
  const first = pictureById(FIRST_PICTURE) ?? pictures()[0];
  const [uri] = useState(() => (first ? previewUri(patternOf(first), 'scheme', 240) : null));

  useEffect(() => {
    void loadIndex().then(setWorks);
  }, []);

  const keyOf = (p: PackPicture) => `${p.id}@${p.v}`;
  const firstWork = first && works ? works.find((w) => w.pattern === keyOf(first)) : undefined;
  const last = works?.find((w) => !w.finished && pictures().some((p) => keyOf(p) === w.pattern));
  const lastPic = last ? pictures().find((p) => keyOf(p) === last.pattern) : undefined;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <Txt title style={styles.logo}>{T.common.appName}</Txt>
        <Txt dim style={styles.sub}>{T.home.subtitle}</Txt>
        {first ? (
          <Card style={styles.first}>
            {uri ? <Image source={{ uri }} style={styles.img} resizeMode="contain" /> : null}
            <View style={styles.firstText}>
              <Txt title style={styles.h2}>{T.home.first}</Txt>
              <Txt dim>{(() => {
                const p = patternOf(first);
                return T.home.firstNote(p.w, p.h, p.threads.length, estimateMinutes(p));
              })()}</Txt>
              <Button
                label={firstWork?.finished ? T.home.again : firstWork ? T.home.continue(Math.floor((firstWork.done * 100) / Math.max(1, firstWork.total))) : T.home.stitch}
                onPress={() => onStitch(first, firstWork && !firstWork.finished ? firstWork.id : undefined)}
                testID="first-stitch" style={styles.btn} />
            </View>
          </Card>
        ) : null}
        {last && lastPic && lastPic.id !== first?.id ? (
          <Button kind="secondary" label={`${lastPic.title} · ${T.home.continue(Math.floor((last.done * 100) / Math.max(1, last.total)))}`}
            onPress={() => onStitch(lastPic, last.id)} testID="continue" />
        ) : null}
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
        <Button kind="ghost" label={T.home.report} onPress={onReport} testID="home-report" />
        <Txt dim style={styles.note}>{T.home.prototype}</Txt>
        <Txt dim style={[styles.note, { color: theme.textDim }]}>{T.common.version(APP_VERSION, APP_BUILD)}</Txt>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  logo: { fontSize: 40, marginTop: 8 },
  sub: { fontSize: 15, marginBottom: 4 },
  first: { padding: 0, overflow: 'hidden' },
  img: { width: '100%', aspectRatio: 2, backgroundColor: '#e2e3da' },
  firstText: { padding: 14, gap: 4 },
  h2: { fontSize: 22 },
  h3: { fontSize: 17 },
  btn: { marginTop: 8 },
  note: { fontSize: 13, textAlign: 'center' },
});

// Карточка картинки (docs/specs/2026-09-library.md, «Карточка картинки»): превью, название,
// автор и год, «Средняя · 12 нитей · ≈ 25 мин», «О картине» раскрывается на месте, кнопка по
// состоянию: «Вышивать», «Продолжить (38 %)», «Вышить ещё раз».
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { PackPicture } from '../engine/pack';
import { estimateMinutes } from '../engine/pattern';
import { T } from '../i18n';
import { previewUri } from '../render/preview';
import { percentOf, useCatalog } from '../state/catalog';
import { patternOf } from '../state/library';
import { useSettings } from '../state/settings';
import { workStitched } from '../state/works';
import { Button, Screen, Txt } from '../ui/components';

export function PictureScreen({ pic, onBack, onStitch }: { pic: PackPicture; onBack: () => void; onStitch: (pic: PackPicture, workId?: string) => void }) {
  const { theme } = useSettings();
  const cat = useCatalog();
  const pattern = patternOf(pic);
  const [about, setAbout] = useState(false);
  const work = cat?.workOf(pic);
  const started = work && !work.finished ? work : undefined;
  const done = !!cat?.done(pic);

  // превью: начатая — цветом там, где вышито; вышитая — целиком; иначе схемой
  const key = `${pic.id}@${pic.v} ${started?.id ?? ''} ${started?.done ?? 0} ${done ? 1 : 0}`;
  const [shown, setShown] = useState<{ key: string; uri: string | null } | null>(null);
  useEffect(() => {
    if (!cat) return;
    let alive = true;
    void (async () => {
      const stitched = started && started.done > 0 ? await workStitched(pattern, started.id) : null;
      const uri = previewUri(pattern, done && !started ? 'done' : 'scheme', 600, stitched ?? undefined);
      if (alive) setShown({ key, uri });
    })();
    return () => {
      alive = false;
    };
  }, [cat, pattern, started, done, key]);

  const who = [pic.author?.name, pic.made].filter(Boolean).join(', ');
  const label = started ? T.picture.continue(percentOf(started)) : done ? T.picture.again : T.picture.stitch;

  return (
    <Screen title={pic.title} onBack={onBack}>
      <ScrollView contentContainerStyle={styles.body} testID="picture">
        <View style={[styles.imgBox, { backgroundColor: theme.surfaceAlt, aspectRatio: Math.max(0.6, Math.min(1.8, pattern.w / pattern.h)) }]}>
          {shown?.key === key && shown.uri ? <Image source={{ uri: shown.uri }} style={styles.img} resizeMode="contain" /> : null}
        </View>
        <Txt title style={styles.h}>{pic.title}</Txt>
        {who ? <Txt dim>{who}</Txt> : null}
        <Txt testID="picture-meta">{T.common.picMeta(pic.size, pattern.threads.length, estimateMinutes(pattern))}</Txt>
        {done && !started ? <Txt dim>{T.picture.done}</Txt> : null}
        {cat?.plusOnly(pic) ? (
          <View style={[styles.plus, { borderColor: theme.border }]}>
            <Txt bold>{T.library.plusMark}</Txt>
            <Txt dim style={styles.small}>{T.picture.plusNote}</Txt>
          </View>
        ) : null}
        {!cat ? <ActivityIndicator color={theme.accent} /> : (
          <Button label={label} onPress={() => onStitch(pic, started?.id)} style={styles.go} testID="picture-stitch" />
        )}
        {pic.about || pic.place ? (
          <>
            <Button kind="ghost" small label={about ? T.picture.hide : T.picture.about} onPress={() => setAbout(!about)} testID="picture-about" />
            {about ? (
              <View style={styles.aboutBox}>
                {pic.place ? <Txt dim>{pic.place}</Txt> : null}
                {pic.about ? <Txt style={styles.aboutText}>{pic.about}</Txt> : null}
                <Txt dim style={styles.small}>{pic.source.basis}</Txt>
                {pic.source.url ? (
                  <Pressable onPress={() => void Linking.openURL(pic.source.url).catch(() => undefined)} accessibilityRole="link">
                    <Txt style={[styles.small, { color: theme.accent }]} numberOfLines={1}>{`${T.picture.source}: ${pic.source.url.replace(/^https?:\/\//, '')}`}</Txt>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 6 },
  imgBox: { width: '100%', borderRadius: 6, overflow: 'hidden', marginBottom: 8 },
  img: { width: '100%', height: '100%' },
  h: { fontSize: 24 },
  small: { fontSize: 13, lineHeight: 18 },
  plus: { borderWidth: 1, borderRadius: 6, padding: 10, gap: 2, marginTop: 4 },
  go: { marginTop: 10 },
  aboutBox: { gap: 6 },
  aboutText: { fontSize: 16, lineHeight: 23 },
});

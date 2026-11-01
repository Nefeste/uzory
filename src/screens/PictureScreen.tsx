// Карточка картинки (docs/specs/2026-09-library.md, «Карточка картинки»): превью, название,
// автор и год, «Средняя · 12 нитей · ≈ 25 мин», «О картине» раскрывается на месте, кнопка по
// состоянию: «Вышивать», «Продолжить (38 %)», «Вышить ещё раз». С 0.20.0 — канва работы: у начатой —
// её, у новой — подходящая узору (src/engine/looks.ts); превью — на этой канве.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, View } from 'react-native';
import { type CanvasId, canvasLook, clothRgb, isCanvasId, suitedCanvas } from '../engine/looks';
import type { PackPicture } from '../engine/pack';
import { CANVAS, estimateMinutes } from '../engine/pattern';
import { T } from '../i18n';
import { previewUri } from '../render/preview';
import { billing } from '../state/billing';
import { percentOf, useCatalog } from '../state/catalog';
import { patternOf } from '../state/library';
import { useSettings } from '../state/settings';
import { setWorkCanvas, workStitched } from '../state/works';
import { CanvasPicker } from '../ui/CanvasPicker';
import { Button, Screen, Txt } from '../ui/components';
import { hasAbout, PicAbout, whoMade } from '../ui/PicAbout';
import { INTERNAL } from '../version';

export function PictureScreen({ pic, onBack, onStitch, onPlus }: {
  pic: PackPicture;
  onBack: () => void;
  /** `canvas` — канва новой работы; у начатой она уже записана */
  onStitch: (pic: PackPicture, workId?: string, canvas?: CanvasId) => void;
  /** «Подробнее» у запертой картинки — экран «Узоры+» */
  onPlus: () => void;
}) {
  const { theme } = useSettings();
  const cat = useCatalog();
  const pattern = patternOf(pic);
  const [about, setAbout] = useState(false);
  const work = cat?.workOf(pic);
  const started = work && !work.finished ? work : undefined;
  const done = !!cat?.done(pic);
  // канва: у начатой работы — записанная (у работы до 0.20.0 — подходящая узору), у новой — выбранная здесь
  const suited = useMemo(() => suitedCanvas(pattern), [pattern]);
  const paper = useMemo(() => pattern.cells.includes(CANVAS), [pattern]);
  const [picked, setPicked] = useState<{ work: string; id: CanvasId } | null>(null);
  const ownCanvas = started && isCanvasId(started.canvas) ? started.canvas : undefined;
  const canvasId: CanvasId = picked && picked.work === (started?.id ?? '') ? picked.id : ownCanvas ?? suited;
  const cloth = clothRgb(canvasLook(canvasId));
  const pickCanvas = (id: CanvasId) => {
    setPicked({ work: started?.id ?? '', id });
    if (started) void setWorkCanvas(started.id, id).then(() => cat?.reload());
  };

  // превью: начатая — полным цветом там, где вышито; вышитая — целиком; иначе приглушённым цветом
  const key = `${pic.id}@${pic.v} ${started?.id ?? ''} ${started?.done ?? 0} ${done ? 1 : 0} ${cloth}`;
  const [shown, setShown] = useState<{ key: string; uri: string | null } | null>(null);
  useEffect(() => {
    if (!cat) return;
    let alive = true;
    void (async () => {
      const stitched = started && started.done > 0 ? await workStitched(pattern, started.id) : null;
      const uri = previewUri(pattern, done && !started ? 'done' : 'muted', 600, stitched ?? undefined, false, cloth);
      if (alive) setShown({ key, uri });
    })();
    return () => {
      alive = false;
    };
  }, [cat, pattern, started, done, key, cloth]);

  // заперта — вместо «Вышивать» «Эта картинка — в „Узоры+“» и «Подробнее»; где подписки нет
  // (APK 1.0 из Releases) — где её взять (docs/specs/2026-09-plus.md, «Неудачные случаи»)
  const locked = !!cat?.locked(pic);
  const canBuy = billing.available || INTERNAL;
  const who = whoMade(pic);
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
        {locked ? (
          <View style={[styles.plus, { borderColor: theme.border }]} testID="picture-locked">
            <Txt bold>{T.plus.locked}</Txt>
            {canBuy ? <Button label={T.plus.more} onPress={onPlus} style={styles.go} testID="picture-more" />
              : <Txt dim style={styles.small}>{T.plus.onlyRustore}</Txt>}
          </View>
        ) : cat?.plusOnly(pic) ? (
          <View style={[styles.plus, { borderColor: theme.border }]}>
            <Txt bold>{T.library.plusMark}</Txt>
            <Txt dim style={styles.small}>{T.picture.plusNote}</Txt>
          </View>
        ) : null}
        {!cat ? <ActivityIndicator color={theme.accent} /> : locked ? null : (
          <>
            <CanvasPicker value={canvasId} onChange={pickCanvas} note={paper ? T.looks.canvasNote : undefined} testID="picture-canvas" />
            <Button label={label} onPress={() => onStitch(pic, started?.id, started ? undefined : canvasId)} style={styles.go} testID="picture-stitch" />
          </>
        )}
        {hasAbout(pic) ? (
          <>
            <Button kind="ghost" small label={about ? T.picture.hide : T.picture.about} onPress={() => setAbout(!about)} testID="picture-about" />
            {about ? <PicAbout pic={pic} head={false} /> : null}
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
});

// «Свой узор» (docs/specs/2026-09-custom.md): снимок → кадр → размер и нити → узор той же
// сборкой, что у библиотеки, с приговором «подходит» или «не подходит» и советом.
// В 0.1 — только в веб-версии: выбор файла на телефоне — в 1.1.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { buildMine, type Crop, defaultThreads, libraryCard, MINE_SIDE, MINE_SIZES, type MineBuild } from '../engine/build/mine';
import type { Simplify } from '../engine/build/simplify';
import { estimateMinutes, type Pattern } from '../engine/pattern';
import { T } from '../i18n';
import { previewUri } from '../render/preview';
import { logError } from '../state/crashlog';
import { deleteMine, listMine, loadMine, type MineEntry, mineKey, saveMine } from '../state/mine';
import { downloadFiles, type Photo, PhotoError, pickPhoto, textBlob } from '../state/photo';
import { useSettings } from '../state/settings';
import { loadIndex, type WorkEntry } from '../state/works';
import { Button, Card, FONT_MAX, Screen, SectionTitle, Segmented, Txt } from '../ui/components';
import { CropBox } from '../ui/CropBox';
import { FONTS } from '../ui/theme';

type SizeKey = keyof typeof MINE_SIZES;
const SIMPLIFY: Simplify[] = [0, 1, 2];

/**
 * Черновик на время открытой вкладки: после «Вышивать» и возврата с канвы кадр на месте.
 * Снимок — только в памяти, на диск не пишется (docs/specs/2026-09-custom.md, «Данные»).
 */
interface Draft { photo: Photo; crop: Crop; side: number; threads: number; simplify: Simplify; title: string }
let draft: Draft | null = null;
/** Сборка — через столько после последней правки: рамку тянут, а узор не пересобирается на каждый сдвиг. */
const DEBOUNCE_MS = 250;

export function MineScreen({ onBack, onStitch, owner }: {
  onBack: () => void;
  /** открыть канву: узор, название, работа (нет — новая) */
  onStitch: (pattern: Pattern, title: string, workId?: string) => void;
  /** закрытая веб-версия: карточка для библиотеки */
  owner: boolean;
}) {
  const { theme } = useSettings();
  const { width, height } = useWindowDimensions();
  const wide = width >= 960;
  const [photo, setPhoto] = useState<Photo | null>(() => draft?.photo ?? null);
  const [error, setError] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>(() => draft?.crop ?? [0, 0, 1, 1]);
  const [side, setSide] = useState<number>(() => draft?.side ?? MINE_SIZES.M);
  const [threads, setThreads] = useState(() => draft?.threads ?? defaultThreads(MINE_SIZES.M));
  // упрощение: снимок — не картина, «немного» почти всегда спокойнее (docs/specs/2026-09-custom.md)
  const [simplify, setSimplify] = useState<Simplify>(() => draft?.simplify ?? 1);
  const [title, setTitle] = useState(() => draft?.title ?? T.mine.defaultName(new Date()));
  useEffect(() => {
    draft = photo ? { photo, crop, side, threads, simplify, title } : null;
  }, [photo, crop, side, threads, simplify, title]);
  const [result, setResult] = useState<{ key: string; build: MineBuild } | null>(null);
  const [saving, setSaving] = useState(false);
  const [mine, setMine] = useState<{ entry: MineEntry; uri: string | null; pattern: Pattern | null; work?: WorkEntry }[]>([]);
  const [sure, setSure] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  const refresh = async () => {
    const [list, works] = await Promise.all([listMine(), loadIndex()]);
    const rows = [];
    for (const entry of list) {
      const pattern = await loadMine(entry.id);
      // указатель работ — от свежих к старым: первая с этим узором и есть последняя
      rows.push({ entry, pattern, uri: pattern ? previewUri(pattern, 'done', 240) : null, work: works.find((w) => w.pattern === mineKey(entry.id)) });
    }
    if (alive.current) setMine(rows);
  };
  useEffect(() => {
    void refresh();
  }, []);

  // сборка узора — после паузы в правках; пока узор не для этих правок, идёт «Собираю…»
  const inputKey = photo ? `${photo.uri} ${crop.join(',')} ${side} ${threads} ${simplify}` : '';
  const building = !!photo && result?.key !== inputKey;
  useEffect(() => {
    if (!photo) return;
    const t = setTimeout(() => {
      try {
        const build = buildMine(photo.raster, { crop, side, threads, simplify });
        if (alive.current) setResult({ key: inputKey, build });
      } catch (e) {
        logError('mine', e, 'build');
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [photo, crop, side, threads, simplify, inputKey]);

  const built = result?.build ?? null;
  const preview = useMemo(() => (built ? previewUri(built.pattern, 'done', 520) : null), [built]);

  const pick = async () => {
    setError(null);
    try {
      const p = await pickPhoto();
      if (!p) return;
      setPhoto(p);
      setCrop([0, 0, 1, 1]);
      setResult(null);
      setTitle(T.mine.defaultName(new Date()));
    } catch (e) {
      if (!(e instanceof PhotoError)) logError('mine', e, 'pick');
      setError(T.mine.badFile);
    }
  };

  const setSize = (k: SizeKey) => {
    setSide(MINE_SIZES[k]);
    setThreads(defaultThreads(MINE_SIZES[k]));
  };
  const sizeKey = (Object.keys(MINE_SIZES) as SizeKey[]).find((k) => MINE_SIZES[k] === side);

  const stitch = async () => {
    if (!built || building || built.verdict.level === 'bad') return;
    setSaving(true);
    setError(null);
    try {
      const name = title.trim() || T.mine.defaultName(new Date());
      // сохранённый узор получает свой ключ и больше не меняется: следующее «Вышивать» — другой узор
      const { pattern } = await saveMine(built.pattern, name, Date.now());
      void refresh();
      onStitch(pattern, name);
    } catch (e) {
      logError('mine', e, 'save');
      setError(T.mine.saveError);
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  const exportCard = () => {
    if (!photo || !built) return;
    const card = libraryCard({ title: title.trim() || photo.name, crop, side, threads, simplify, now: new Date() });
    downloadFiles([{ name: `${card.id}.yaml`, data: textBlob(card.yaml) }, { name: `${card.id}.jpg`, data: photo.jpeg }]);
  };

  const remove = async (entryId: string) => {
    if (sure !== entryId) {
      setSure(entryId);
      return;
    }
    setSure(null);
    await deleteMine(entryId);
    void refresh();
  };

  const photoW = wide ? Math.min(640, width * 0.5 - 48) : Math.min(width - 32, 608);
  const photoH = wide ? Math.min(560, height - 220) : 360;
  const v = built?.verdict;
  const verdictColor = !v ? theme.textDim : v.level === 'ok' ? theme.spruce : v.level === 'warn' ? theme.flax : theme.danger;

  return (
    <Screen title={T.mine.title} onBack={onBack} wide={wide}>
      <ScrollView contentContainerStyle={styles.body}>
        {!photo ? (
          <Card style={styles.intro}>
            <Txt>{T.mine.intro}</Txt>
            <Button label={T.mine.pick} onPress={() => void pick()} testID="mine-pick" />
            {error ? <Txt style={{ color: theme.danger }} testID="mine-error">{error}</Txt> : null}
          </Card>
        ) : (
          <View style={[styles.editor, wide && styles.editorWide]}>
            <View style={[styles.col, wide && styles.colWide]}>
              <CropBox uri={photo.uri} width={photo.raster.width} height={photo.raster.height} maxW={photoW} maxH={photoH} crop={crop} onChange={setCrop} />
              <View style={styles.row}>
                <Button small kind="secondary" label={T.mine.whole} onPress={() => setCrop([0, 0, 1, 1])} testID="mine-whole" />
                <Button small kind="secondary" label={T.mine.other} onPress={() => void pick()} testID="mine-other" />
              </View>
              <Txt dim style={styles.small}>{T.mine.hint}</Txt>
              {error ? <Txt style={{ color: theme.danger }} testID="mine-error">{error}</Txt> : null}
            </View>
            <View style={[styles.col, wide && styles.colWide, wide && styles.colRight]}>
              <View style={[styles.preview, { backgroundColor: theme.surfaceAlt }]}>
                {preview ? <Image source={{ uri: preview }} style={styles.previewImg} resizeMode="contain" testID="mine-preview" /> : null}
                {building ? (
                  <View style={styles.building} testID="mine-building">
                    <ActivityIndicator color={theme.accent} />
                    <Txt dim>{T.mine.building}</Txt>
                  </View>
                ) : null}
              </View>
              {built ? (
                <>
                  <Txt bold testID="mine-meta">{T.mine.meta(built.pattern.w, built.pattern.h, built.pattern.threads.length, estimateMinutes(built.pattern))}</Txt>
                  <View style={[styles.verdict, { borderColor: verdictColor }]} testID="mine-verdict">
                    <Txt bold style={{ color: verdictColor }}>{T.mine.verdict[built.verdict.level]}</Txt>
                    {built.verdict.issues.map((i) => <Txt key={i} style={styles.small}>{T.mine.issues[i]}</Txt>)}
                  </View>
                </>
              ) : null}
              <SectionTitle>{T.mine.size}</SectionTitle>
              <Segmented value={sizeKey ?? 'M'} onChange={setSize} testID="mine-size"
                options={(Object.keys(MINE_SIZES) as SizeKey[]).map((k) => ({ id: k, label: wide ? `${T.common.sizes[k]} · ${MINE_SIZES[k]}` : T.common.sizes[k] }))} />
              <View style={styles.row}>
                <Button small kind="secondary" label="−10" onPress={() => setSide((s) => Math.max(MINE_SIDE[0], s - 10))} testID="mine-side-minus" />
                <Txt style={styles.grow}>{T.mine.side(side)}</Txt>
                <Button small kind="secondary" label="+10" onPress={() => setSide((s) => Math.min(MINE_SIDE[1], s + 10))} testID="mine-side-plus" />
              </View>
              <SectionTitle>{T.mine.threads}</SectionTitle>
              <View style={styles.row}>
                <Button small kind="secondary" label={T.mine.fewer} onPress={() => setThreads((n) => Math.max(3, n - 2))} testID="mine-threads-minus" />
                <Txt style={styles.grow}>{T.mine.asked(threads)}</Txt>
                <Button small kind="secondary" label={T.mine.more} onPress={() => setThreads((n) => Math.min(45, n + 2))} testID="mine-threads-plus" />
              </View>
              <SectionTitle>{T.mine.simplify}</SectionTitle>
              <Segmented value={String(simplify)} onChange={(id) => setSimplify(Number(id) as Simplify)} testID="mine-simplify"
                options={SIMPLIFY.map((l) => ({ id: String(l), label: T.mine.simplifyLevels[l] }))} />
              <Txt dim style={styles.small}>{T.mine.simplifyNote}</Txt>
              <SectionTitle>{T.mine.name}</SectionTitle>
              <TextInput value={title} onChangeText={setTitle} maxLength={60} maxFontSizeMultiplier={FONT_MAX} testID="mine-name"
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface, fontFamily: FONTS.body }]} />
              <Button label={T.mine.stitch} onPress={() => void stitch()} disabled={!built || building || saving || built.verdict.level === 'bad'}
                style={styles.go} testID="mine-stitch" />
              {owner ? (
                <>
                  <Button kind="ghost" small label={T.mine.card} onPress={exportCard} disabled={!built} testID="mine-card" />
                  <Txt dim style={styles.small}>{T.mine.cardNote}</Txt>
                </>
              ) : null}
            </View>
          </View>
        )}
        <SectionTitle>{T.mine.list}</SectionTitle>
        {mine.length === 0 ? <Txt dim>{T.mine.empty}</Txt> : null}
        <View style={styles.list}>
          {mine.map(({ entry, uri, pattern, work }) => (
            <Card key={entry.id} style={styles.item} testID={`mine-item-${entry.id}`}>
              {uri ? <Image source={{ uri }} style={styles.itemImg} resizeMode="contain" /> : null}
              <View style={styles.itemText}>
                <Txt bold>{entry.title}</Txt>
                <Txt dim style={styles.small}>{T.common.meta(entry.w, entry.h, entry.threads, pattern ? estimateMinutes(pattern) : 0)}</Txt>
                <View style={styles.row}>
                  {pattern ? (
                    <Button small label={work && !work.finished ? T.mine.continue(Math.floor((work.done * 100) / Math.max(1, work.total))) : work ? T.mine.again : T.mine.stitch}
                      onPress={() => onStitch(pattern, entry.title, work && !work.finished ? work.id : undefined)} testID={`mine-open-${entry.id}`} />
                  ) : null}
                  <Button small kind="ghost" label={sure === entry.id ? T.mine.removeSure : T.mine.remove} onPress={() => void remove(entry.id)} testID={`mine-remove-${entry.id}`} />
                </View>
              </View>
            </Card>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10 },
  intro: { gap: 12 },
  editor: { gap: 16 },
  editorWide: { flexDirection: 'row', alignItems: 'flex-start' },
  // в колонку на узком экране — без flex: иначе в прокрутке высота колонки нулевая
  col: { gap: 8 },
  colWide: { flex: 1 },
  colRight: { maxWidth: 560 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  grow: { flex: 1, textAlign: 'center' },
  small: { fontSize: 13 },
  preview: { width: '100%', aspectRatio: 1.3, borderRadius: 6, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  previewImg: { width: '100%', height: '100%' },
  building: { position: 'absolute', alignItems: 'center', gap: 6, padding: 10, borderRadius: 6, backgroundColor: 'rgba(247, 247, 242, 0.85)' },
  verdict: { borderLeftWidth: 4, paddingLeft: 10, paddingVertical: 4, gap: 2 },
  input: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  go: { marginTop: 8 },
  list: { gap: 10 },
  item: { flexDirection: 'row', gap: 12, padding: 10 },
  itemImg: { width: 110, height: 88, backgroundColor: '#e2e3da', borderRadius: 4 },
  itemText: { flex: 1, gap: 4 },
});

// «Свой узор» (docs/specs/2026-09-custom.md): снимок → кадр → размер и нити → узор той же
// сборкой, что у библиотеки, с приговором «подходит» или «не подходит» и советом. На телефоне —
// снимок из галереи (src/state/photo.ts), в вебе — файл. Первый свой узор — бесплатно, дальше новые —
// по «Узорам+» (решение владельца 31.10.2026, issue 118, вариант В; `mineAccess`); начатые дошиваются.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import type { Background } from '../engine/build/main';
import { buildMine, type Crop, defaultThreads, libraryCard, MINE_SIDE, MINE_SIZES, MINE_THREADS, type MineBuild } from '../engine/build/mine';
import { GiftError, type GiftNote } from '../engine/gift';
import type { Simplify } from '../engine/build/simplify';
import { estimateMinutes, type Pattern } from '../engine/pattern';
import { mineAccess } from '../engine/plus';
import { T } from '../i18n';
import { previewUri } from '../render/preview';
import { billing } from '../state/billing';
import { logError } from '../state/crashlog';
import { openGift } from '../state/gift';
import { findFaces, findSalient } from '../state/faces';
import { deleteMine, listMine, loadMine, type MineEntry, mineKey, saveMine } from '../state/mine';
import { downloadFiles, type Photo, PhotoError, pickPhoto, textBlob } from '../state/photo';
import { pickFile } from '../state/pick';
import { usePlayer } from '../state/player';
import { useGate, usePlus } from '../state/plus';
import { useSettings } from '../state/settings';
import { loadIndex, type WorkEntry } from '../state/works';
import { INTERNAL } from '../version';
import { Button, Card, FONT_MAX, Screen, SectionTitle, Segmented, Txt } from '../ui/components';
import { FrameEditor } from '../ui/FrameEditor';
import { FrameView } from '../ui/FrameView';
import { GiftForm } from '../ui/GiftForm';
import { PatternCloser } from '../ui/PatternCloser';
import { FONTS } from '../ui/theme';

type SizeKey = keyof typeof MINE_SIZES;
const SIMPLIFY: Simplify[] = [0, 1, 2];
/** Фон вне главного: как есть, одной нитью, не вышивать (src/engine/build/main.ts). */
type BackgroundChoice = 'keep' | Background;
const BACKGROUNDS: BackgroundChoice[] = ['keep', 'one', 'none'];
/**
 * Размер сразу — «большая», 120 клеток (решение владельца 01.11.2026): лицу и мелким подробностям
 * снимка 70 клеток мало (разбор статей 31.10.2026: меньше 80 крестиков выходит «кубиками»).
 */
const FIRST_SIDE = MINE_SIZES.L;

/**
 * Черновик на время открытой вкладки: после «Вышивать» и возврата с канвы кадр на месте.
 * Снимок — только в памяти, на диск не пишется (docs/specs/2026-09-custom.md, «Данные»).
 */
interface Draft { photo: Photo; crop: Crop; side: number; threads: number; simplify: Simplify; title: string; mains: Crop[]; background: BackgroundChoice }
let draft: Draft | null = null;

/** Главное и фон — для сборки и карточки: один овал — рамкой, как до 0.24.0, несколько — списком. */
const mainOf = (mains: Crop[], bg: Background | undefined) =>
  mains.length ? { main: mains.length === 1 ? mains[0] : mains, ...(bg ? { background: bg } : {}) } : {};
/** Сборка — через столько после последней правки: рамку тянут, а узор не пересобирается на каждый сдвиг. */
const DEBOUNCE_MS = 250;

export function MineScreen({ onBack, onStitch, onDone, onPlus, owner }: {
  onBack: () => void;
  /**
   * открыть канву: узор, название, работа (нет — новая); тайна от друга — с подписью и запиской, а пока
   * не вышита — новая работа «Тайной» (0.23.0)
   */
  onStitch: (pattern: Pattern, title: string, workId?: string, gift?: GiftNote, mystery?: boolean) => void;
  /** «Готовая работа»: экран «Готово» с последней законченной работой узора */
  onDone: (pattern: Pattern, title: string, workId: string, gift?: GiftNote) => void;
  /** «Подробнее» о «Узорах+»: первый свой узор уже был */
  onPlus: () => void;
  /** закрытая веб-версия: карточка для библиотеки */
  owner: boolean;
}) {
  const { theme } = useSettings();
  const gate = useGate();
  const { open: plus } = usePlus();
  const { player, today, update } = usePlayer();
  const access = mineAccess({ gate, plus, freeUsed: !!player.mineFreeUsed });
  const canBuy = billing.available || INTERNAL;
  const { width, height } = useWindowDimensions();
  const wide = width >= 960;
  const [photo, setPhoto] = useState<Photo | null>(() => draft?.photo ?? null);
  const [error, setError] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>(() => draft?.crop ?? [0, 0, 1, 1]);
  const [side, setSide] = useState<number>(() => draft?.side ?? FIRST_SIDE);
  const [threads, setThreads] = useState(() => draft?.threads ?? defaultThreads(FIRST_SIDE));
  // упрощение: снимок — не картина, «немного» почти всегда спокойнее (docs/specs/2026-09-custom.md)
  const [simplify, setSimplify] = useState<Simplify>(() => draft?.simplify ?? 1);
  const [title, setTitle] = useState(() => draft?.title ?? T.mine.defaultName(new Date()));
  // главное — овалы в рамке (доли снимка) и фон вне них (src/engine/build/main.ts, с 0.19.0); овалов с 0.24.0
  // несколько — «Найти лица» ставит овал на каждое лицо (issue 146)
  const [mains, setMains] = useState<Crop[]>(() => draft?.mains ?? []);
  const [background, setBackground] = useState<BackgroundChoice>(() => draft?.background ?? 'keep');
  useEffect(() => {
    draft = photo ? { photo, crop, side, threads, simplify, title, mains, background } : null;
  }, [photo, crop, side, threads, simplify, title, mains, background]);
  const bg = mains.length && background !== 'keep' ? background : undefined;
  const [result, setResult] = useState<{ key: string; build: MineBuild } | null>(null);
  // какой по счёту снимок открыт: ключ сборки и рамки — номер, а не data: URI в мегабайт
  const [shot, setShot] = useState(0);
  // снимок выбран и читается — секунды у снимка в 50 Мп: экран говорит, что занят
  const [opening, setOpening] = useState(false);
  // экран кадра (src/ui/FrameEditor.tsx): сразу после выбора снимка и по «Изменить кадр»; пока он открыт,
  // узор не собирается (владелец 01.11.2026: на каждую правку рамки пересчёт — на телефоне медленно)
  const [framing, setFraming] = useState(false);
  // собранный узор вблизи (src/ui/PatternCloser.tsx)
  const [closer, setCloser] = useState(false);
  // «Подарить тайной» (src/ui/GiftForm.tsx, 0.23.0): какой свой узор дарят
  const [giftFor, setGiftFor] = useState<{ pattern: Pattern; title: string } | null>(null);
  // «Открыть тайну от друга»: файл читается; не открылся — строка, почему
  const [giftOpening, setGiftOpening] = useState(false);
  const [giftError, setGiftError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mine, setMine] = useState<{ entry: MineEntry; uri: string | null; pattern: Pattern | null; work?: WorkEntry; done?: WorkEntry }[]>([]);
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
      const own = works.filter((w) => w.pattern === mineKey(entry.id));
      const done = own.find((w) => w.finished);
      // тайна от друга до последнего стежка — без превью: оно выдало бы картинку
      const secret = !!entry.gift && !done;
      rows.push({ entry, pattern, uri: pattern && !secret ? previewUri(pattern, 'done', 240) : null, work: own[0], done });
    }
    if (alive.current) setMine(rows);
  };
  useEffect(() => {
    void refresh();
  }, []);

  // сборка узора — когда экран кадра закрыт («Собрать узор»), и после паузы в правках: сборка занимает поток
  // JS, и палец на рамке ждал бы её; пока узор не для этих правок, идёт «Собираю…»
  const inputKey = photo ? `${shot} ${crop.join(',')} ${side} ${threads} ${simplify} ${mains.map((m) => m.join(',')).join(';') || '-'} ${bg ?? '-'}` : '';
  const building = !!photo && result?.key !== inputKey;
  useEffect(() => {
    if (!photo || framing) return;
    const t = setTimeout(() => {
      try {
        const build = buildMine(photo.raster, { crop, side, threads, simplify, ...mainOf(mains, bg) });
        if (alive.current) setResult({ key: inputKey, build });
      } catch (e) {
        logError('mine', e, 'build');
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [photo, crop, side, threads, simplify, mains, bg, inputKey, framing]);

  const built = result?.build ?? null;
  // превью — заново на каждую сборку: у несохранённого узора ключ один (`mine@1`), и из памяти превью было бы прежним
  const preview = useMemo(() => (built ? previewUri(built.pattern, 'done', 520, undefined, true) : null), [built]);

  // другой снимок: пока он читается, прежнего не видно; не открылся — прежний на месте и строка, почему
  const pick = async () => {
    if (opening) return;
    setError(null);
    try {
      const p = await pickPhoto(() => setOpening(true));
      if (!p || !alive.current) return;
      setPhoto(p);
      setShot((n) => n + 1);
      setCrop([0, 0, 1, 1]);
      // главное прежнего снимка новому ни к чему
      setMains([]);
      setBackground('keep');
      setResult(null);
      setTitle(T.mine.defaultName(new Date()));
      // сразу — экран кадра: снимок на весь экран, рамку двигают пальцем (владелец 01.11.2026)
      setFraming(true);
    } catch (e) {
      if (!(e instanceof PhotoError)) logError('mine', e, 'pick');
      if (alive.current) setError(Platform.OS === 'web' ? T.mine.badFile : T.mine.badPhoto);
    } finally {
      if (alive.current) setOpening(false);
    }
  };

  // овал — посередине кадра: по меньшей стороне кадра — половина в ширину и 0,6 в высоту (лицо, фигура,
  // цветок); дальше его двигают и тянут, как рамку. «Ещё овал» — вдвое меньше и чуть ниже и правее
  // прежних: новый не ложится на тот, что уже посередине
  const addMain = () => {
    if (!photo) return;
    const [l, t, r, b] = crop;
    const { width: pw, height: ph } = photo.raster;
    const n = mains.length;
    const least = Math.min((r - l) * pw, (b - t) * ph) * (n ? 0.5 : 1);
    const ow = (0.5 * least) / pw;
    const oh = (0.6 * least) / ph;
    const cx = Math.min(1 - ow / 2, (l + r) / 2 + (n * 0.12 * (r - l)) % (0.5 * (r - l)));
    const cy = Math.min(1 - oh / 2, (t + b) / 2 + (n * 0.12 * (b - t)) % (0.5 * (b - t)));
    setMains([...mains, [cx - ow / 2, cy - oh / 2, cx + ow / 2, cy + oh / 2]]);
  };
  // «Найти лица» и «Найти главное»: овалы — на найденное в кадре; не нашлось ничего — прежние овалы на месте
  const find = async (how: typeof findFaces, what: string) => {
    if (!photo) return 0;
    try {
      const found = await how(photo.raster, crop);
      if (found.length && alive.current) setMains(found);
      return found.length;
    } catch (e) {
      logError('mine', e, what);
      throw e;
    }
  };

  // свой размер и нити — числом, собираются по «Применить» (владелец 01.11.2026: на каждое «+10» узор
  // собирался заново, а до 500 клеток — «невозможно долго»); заготовки размера применяются сразу
  const [sideText, setSideText] = useState(() => String(side));
  const [threadsText, setThreadsText] = useState(() => String(threads));
  const setSize = (k: SizeKey) => {
    setSide(MINE_SIZES[k]);
    setThreads(defaultThreads(MINE_SIZES[k]));
    setSideText(String(MINE_SIZES[k]));
    setThreadsText(String(defaultThreads(MINE_SIZES[k])));
  };
  const sizeKey = (Object.keys(MINE_SIZES) as SizeKey[]).find((k) => MINE_SIZES[k] === side) ?? null;
  const typed = sideText !== String(side) || threadsText !== String(threads);
  const apply = () => {
    const s = Math.min(MINE_SIDE[1], Math.max(MINE_SIDE[0], Number(sideText) || side));
    const n = Math.min(MINE_THREADS[1], Math.max(MINE_THREADS[0], Number(threadsText) || threads));
    setSide(s);
    setThreads(n);
    setSideText(String(s));
    setThreadsText(String(n));
  };

  // «Вышивать» и «Подарить тайной»: узор сохраняется в «Мои узоры» и открывается канва или подарок
  const save = async (then: (pattern: Pattern, name: string) => void) => {
    if (!built || building || opening || built.verdict.level === 'bad' || access === 'locked') return;
    setSaving(true);
    setError(null);
    try {
      const name = title.trim() || T.mine.defaultName(new Date());
      // сохранённый узор получает свой ключ и больше не меняется: следующее «Вышивать» — другой узор
      const { pattern } = await saveMine(built.pattern, name, Date.now());
      // первый свой узор там, где «Узоры+» запирают, — бесплатный; следующий новый — по подписке
      if (gate && !player.mineFreeUsed) update({ mineFreeUsed: today });
      void refresh();
      then(pattern, name);
    } catch (e) {
      logError('mine', e, 'save');
      setError(T.mine.saveError);
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  const stitch = () => save((pattern, name) => onStitch(pattern, name));
  const giveNew = () => save((pattern, name) => setGiftFor({ pattern, title: name }));

  // «Открыть тайну от друга» (0.23.0): файл → «Мои узоры» и сразу канва «Тайной»; тот же файл — та же тайна
  const openGiftFile = async () => {
    if (giftOpening) return;
    setGiftError(null);
    try {
      const bytes = await pickFile();
      if (!bytes) return;
      setGiftOpening(true);
      const g = await openGift(bytes, Date.now());
      void refresh();
      onStitch(g.pattern, g.title, g.workId, g.gift, g.secret);
    } catch (e) {
      if (!(e instanceof GiftError)) logError('gift', e, 'open');
      if (alive.current) setGiftError(T.gift.problem[e instanceof GiftError ? e.problem : 'broken']);
    } finally {
      if (alive.current) setGiftOpening(false);
    }
  };

  const exportCard = () => {
    if (!photo?.jpeg || !built) return;
    const card = libraryCard({ title: title.trim() || photo.name, crop, side, threads, simplify, ...mainOf(mains, bg), now: new Date() });
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
  const photoH = wide ? Math.min(560, height - 220) : 300;
  const v = built?.verdict;
  const verdictColor = !v ? theme.textDim : v.level === 'ok' ? theme.spruce : v.level === 'warn' ? theme.flax : theme.danger;

  if (photo && framing && !opening) {
    return (
      <FrameEditor key={shot} uri={photo.uri} width={photo.raster.width} height={photo.raster.height}
        crop={crop} onCrop={setCrop} mains={mains} onMains={setMains} onAddMain={addMain} onWhole={() => setCrop([0, 0, 1, 1])}
        onFaces={() => find(findFaces, 'faces')} onSalient={() => find(findSalient, 'salient')} onDone={() => setFraming(false)} />
    );
  }
  if (closer && built && !building) return <PatternCloser pattern={built.pattern} onBack={() => setCloser(false)} />;
  if (giftFor) return <GiftForm pattern={giftFor.pattern} title={giftFor.title} onBack={() => setGiftFor(null)} />;
  const k = photo ? Math.min(photoW / photo.raster.width, photoH / photo.raster.height) : 1;

  return (
    <Screen title={T.mine.title} onBack={onBack} wide={wide}>
      {/* при открытой клавиатуре кнопки нажимаются с первого раза («Применить», «Вышивать»), а не прячут её */}
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!photo ? (
          <Card style={styles.intro}>
            <Txt>{T.mine.intro}</Txt>
            <Txt dim testID="mine-tips">{T.mine.tips}</Txt>
            {opening ? <Opening /> : <Button label={T.mine.pick} onPress={() => void pick()} testID="mine-pick" />}
            {error ? <Txt style={{ color: theme.danger }} testID="mine-error">{error}</Txt> : null}
          </Card>
        ) : (
          <View style={[styles.editor, wide && styles.editorWide]}>
            <View style={[styles.col, wide && styles.colWide]}>
              {opening ? (
                <View style={[styles.opening, { height: photoH, backgroundColor: theme.surfaceAlt }]}><Opening /></View>
              ) : (
                // кадр — картинкой; касание открывает экран кадра
                <Pressable onPress={() => setFraming(true)} accessibilityRole="button" accessibilityLabel={T.mine.frameEdit} testID="mine-frame-open">
                  <FrameView uri={photo.uri} dw={Math.max(1, Math.round(photo.raster.width * k))} dh={Math.max(1, Math.round(photo.raster.height * k))}
                    crop={crop} mains={mains} />
                </Pressable>
              )}
              <View style={styles.row}>
                <Button small kind="secondary" label={T.mine.frameEdit} onPress={() => setFraming(true)} disabled={opening} testID="mine-frame-edit" />
                <Button small kind="secondary" label={T.mine.other} onPress={() => void pick()} disabled={opening} testID="mine-other" />
              </View>
              {mains.length ? <Txt dim style={styles.small}>{mains.length > 1 ? T.mine.mainsNote : T.mine.mainNote}</Txt> : null}
              {error ? <Txt style={{ color: theme.danger }} testID="mine-error">{error}</Txt> : null}
            </View>
            <View style={[styles.col, wide && styles.colWide, wide && styles.colRight]}>
              <View style={[styles.preview, { backgroundColor: theme.surfaceAlt }]}>
                {preview && !opening ? (
                  // касание превью — узор ближе
                  <Pressable onPress={() => setCloser(true)} disabled={building} accessibilityRole="button" accessibilityLabel={T.mine.closer} style={styles.previewTap}>
                    <Image source={{ uri: preview }} style={styles.previewImg} resizeMode="contain" testID="mine-preview" />
                  </Pressable>
                ) : null}
                {building && !opening ? (
                  <View style={styles.building} testID="mine-building">
                    <ActivityIndicator color={theme.accent} />
                    <Txt dim>{T.mine.building}</Txt>
                  </View>
                ) : null}
              </View>
              {built && !opening ? (
                <>
                  <Txt bold testID="mine-meta">{T.mine.meta(built.pattern.w, built.pattern.h, built.pattern.threads.length, estimateMinutes(built.pattern))}</Txt>
                  <View style={[styles.verdict, { borderColor: verdictColor }]} testID="mine-verdict">
                    <Txt bold style={{ color: verdictColor }}>{T.mine.verdict[built.verdict.level]}</Txt>
                    {built.verdict.issues.map((i) => <Txt key={i} style={styles.small}>{T.mine.issues[i]}</Txt>)}
                  </View>
                  <Button small kind="secondary" label={T.mine.closer} onPress={() => setCloser(true)} disabled={building} testID="mine-closer-open" />
                </>
              ) : null}
              <SectionTitle>{T.mine.size}</SectionTitle>
              <Segmented value={sizeKey} onChange={setSize} testID="mine-size"
                options={(Object.keys(MINE_SIZES) as SizeKey[]).map((k) => ({ id: k, label: wide ? `${T.common.sizes[k]} · ${MINE_SIZES[k]}` : T.common.sizes[k] }))} />
              <View style={styles.row}>
                <Txt>{T.mine.cellsLabel}</Txt>
                <TextInput value={sideText} onChangeText={(t) => setSideText(t.replace(/\D/g, ''))} onSubmitEditing={apply} keyboardType="number-pad" maxLength={3}
                  maxFontSizeMultiplier={FONT_MAX} testID="mine-side"
                  style={[styles.input, styles.num, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface, fontFamily: FONTS.body }]} />
                <Txt>{T.mine.threadsLabel}</Txt>
                <TextInput value={threadsText} onChangeText={(t) => setThreadsText(t.replace(/\D/g, ''))} onSubmitEditing={apply} keyboardType="number-pad" maxLength={2}
                  maxFontSizeMultiplier={FONT_MAX} testID="mine-threads"
                  style={[styles.input, styles.num, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface, fontFamily: FONTS.body }]} />
                <Button small label={T.mine.apply} onPress={apply} disabled={!typed} testID="mine-apply" />
              </View>
              <Txt dim style={styles.small}>{T.mine.sizeNote(MINE_SIDE[0], MINE_SIDE[1], MINE_THREADS[0], MINE_THREADS[1])}</Txt>
              <SectionTitle>{T.mine.simplify}</SectionTitle>
              <Segmented value={String(simplify)} onChange={(id) => setSimplify(Number(id) as Simplify)} testID="mine-simplify"
                options={SIMPLIFY.map((l) => ({ id: String(l), label: T.mine.simplifyLevels[l] }))} />
              <Txt dim style={styles.small}>{T.mine.simplifyNote}</Txt>
              {mains.length ? (
                <>
                  <SectionTitle>{T.mine.background}</SectionTitle>
                  <Segmented value={background} onChange={setBackground} testID="mine-background"
                    options={BACKGROUNDS.map((b) => ({ id: b, label: T.mine.backgroundLevels[b] }))} />
                  <Txt dim style={styles.small}>{T.mine.backgroundNote}</Txt>
                </>
              ) : null}
              <SectionTitle>{T.mine.name}</SectionTitle>
              <TextInput value={title} onChangeText={setTitle} maxLength={60} maxFontSizeMultiplier={FONT_MAX} testID="mine-name"
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface, fontFamily: FONTS.body }]} />
              {access === 'locked' ? (
                // первый свой узор уже был: новый — в «Узорах+»; «Мои узоры» ниже дошиваются и без неё
                <View style={[styles.locked, { borderColor: theme.border }]} testID="mine-locked">
                  <Txt bold>{T.mine.locked}</Txt>
                  <Txt dim style={styles.small}>{T.mine.lockedNote}</Txt>
                  {canBuy ? <Button label={T.plus.more} onPress={onPlus} style={styles.go} testID="mine-more" />
                    : <Txt dim style={styles.small}>{T.plus.onlyRustore}</Txt>}
                </View>
              ) : (
                <>
                  <Button label={T.mine.stitch} onPress={() => void stitch()} disabled={!built || building || saving || opening || built.verdict.level === 'bad'}
                    style={styles.go} testID="mine-stitch" />
                  <Button kind="secondary" label={T.gift.give} onPress={() => void giveNew()} disabled={!built || building || saving || opening || built.verdict.level === 'bad'}
                    testID="mine-gift-new" />
                  {access === 'free' ? <Txt dim style={styles.small} testID="mine-free">{T.mine.free}</Txt> : null}
                </>
              )}
              {owner && photo.jpeg ? (
                <>
                  <Button kind="ghost" small label={T.mine.card} onPress={exportCard} disabled={!built} testID="mine-card" />
                  <Txt dim style={styles.small}>{T.mine.cardNote}</Txt>
                </>
              ) : null}
            </View>
          </View>
        )}
        <SectionTitle>{T.mine.list}</SectionTitle>
        <Button small kind="secondary" label={giftOpening ? T.gift.opening : T.gift.open} onPress={() => void openGiftFile()} disabled={giftOpening} testID="mine-gift-open" />
        {giftError ? <Txt style={{ color: theme.danger }} testID="mine-gift-error">{giftError}</Txt> : null}
        {mine.length === 0 ? <Txt dim>{T.mine.empty}</Txt> : null}
        <View style={styles.list}>
          {mine.map(({ entry, uri, pattern, work, done }) => {
            // тайна от друга до последнего стежка — знак вопроса и подпись, без названия и превью
            const secret = !!entry.gift && !done;
            return (
              <Card key={entry.id} style={styles.item} testID={`mine-item-${entry.id}`}>
                {uri ? <Image source={{ uri }} style={styles.itemImg} resizeMode="contain" /> : null}
                {secret ? <View style={[styles.itemImg, styles.secret, { backgroundColor: theme.surfaceAlt }]}><Txt title style={styles.secretMark}>?</Txt></View> : null}
                <View style={styles.itemText}>
                  <Txt bold>{secret ? T.gift.secretTitle(entry.gift?.from) : entry.title}</Txt>
                  {!secret && entry.gift?.from ? <Txt dim style={styles.small}>{T.gift.fromLine(entry.gift.from)}</Txt> : null}
                  <Txt dim style={styles.small}>{T.common.meta(entry.w, entry.h, entry.threads, pattern ? estimateMinutes(pattern) : 0)}</Txt>
                  <View style={styles.row}>
                    {pattern ? (
                      <Button small label={work && !work.finished ? T.mine.continue(Math.floor((work.done * 100) / Math.max(1, work.total))) : secret ? T.gift.start : work ? T.mine.again : T.mine.stitch}
                        onPress={() => onStitch(pattern, entry.title, work && !work.finished ? work.id : undefined, entry.gift, secret)} testID={`mine-open-${entry.id}`} />
                    ) : null}
                    {pattern && done ? (
                      <Button small kind="secondary" label={T.mine.done} onPress={() => onDone(pattern, entry.title, done.id, entry.gift)} testID={`mine-done-${entry.id}`} />
                    ) : null}
                    {pattern && !entry.gift ? (
                      <Button small kind="secondary" label={T.gift.give} onPress={() => setGiftFor({ pattern, title: entry.title })} testID={`mine-gift-${entry.id}`} />
                    ) : null}
                    <Button small kind="ghost" label={sure === entry.id ? T.mine.removeSure : T.mine.remove} onPress={() => void remove(entry.id)} testID={`mine-remove-${entry.id}`} />
                  </View>
                </View>
              </Card>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}

/** Снимок читается: круг и строка — на месте кнопки или рамки. */
function Opening() {
  const { theme } = useSettings();
  return (
    <View style={styles.openingRow} testID="mine-opening">
      <ActivityIndicator color={theme.accent} />
      <Txt dim>{T.mine.opening}</Txt>
    </View>
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
  previewTap: { width: '100%', height: '100%' },
  secret: { alignItems: 'center', justifyContent: 'center' },
  secretMark: { fontSize: 40 },
  opening: { alignSelf: 'stretch', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  openingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  building: { position: 'absolute', alignItems: 'center', gap: 6, padding: 10, borderRadius: 6, backgroundColor: 'rgba(247, 247, 242, 0.85)' },
  verdict: { borderLeftWidth: 4, paddingLeft: 10, paddingVertical: 4, gap: 2 },
  input: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  num: { width: 64, textAlign: 'center', paddingHorizontal: 6 },
  go: { marginTop: 8 },
  locked: { marginTop: 8, borderWidth: 1, borderRadius: 8, padding: 12, gap: 6 },
  list: { gap: 10 },
  item: { flexDirection: 'row', gap: 12, padding: 10 },
  itemImg: { width: 110, height: 88, backgroundColor: '#e2e3da', borderRadius: 4 },
  itemText: { flex: 1, gap: 4 },
});

// «Лист» (docs/specs/2026-09-spikes.md, П3): узоры встроенного набора на телефоне —
// как их увидит игрок, с числами проверок. Владелец отмечает у каждой «Да», «Нет» или «Позже»,
// пишет, если нужно, что поправить (docs/09-content.md, §8), и отдаёт решения ассистенту
// текстом — тот ставит `approved` и правит картинки по комментариям.
// Начатая картинка открывается там, где её оставили: большие вышиваются не за один раз.
// Превью и числа карточки считаются, когда карточка показывается (0.10.1): разом двести узоров
// телефон разбирал бы десятки секунд.
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { COLLECTIONS, type CollectionId } from '../engine/library';
import type { PackPicture } from '../engine/pack';
import { estimateMinutes } from '../engine/pattern';
import { patternStats } from '../engine/stats';
import { T } from '../i18n';
import { copyText } from '../state/clip';
import { decisionGroups, NOTE_MAX, PICKS, pickKey, TUNE_SIDE, TUNE_THREADS, type Tune, tuneText } from '../state/decisions';
import { patternOf, pictures, rebuiltIds } from '../state/library';
import { type Pick, usePicks } from '../state/picks';
import { usePlayer } from '../state/player';
import { useSettings } from '../state/settings';
import { loadIndex, type WorkEntry } from '../state/works';
import { Button, Card, FONT_MAX, Screen, Segmented, Txt } from '../ui/components';
import { previewUri } from '../render/preview';
import { FONTS } from '../ui/theme';
import { APP_VERSION } from '../version';

type Filter = 'all' | 'unmarked' | 'review' | 'trial';

interface Info {
  uri: string | null;
  meta: string;
  stats: string;
  /** клеток по длинной стороне и нитей у узора сейчас — от них «Настроить узор» */
  side: number;
  threads: number;
}

/** Посчитанные карточки — на всё время работы: лист открывают снова и снова. */
const infos = new Map<string, Info>();

function infoOf(pic: PackPicture): Info {
  const key = `${pic.id}@${pic.v}`;
  let info = infos.get(key);
  if (!info) {
    const p = patternOf(pic);
    const st = patternStats(p);
    info = {
      uri: previewUri(p, 'done', 480),
      meta: `${T.common.sizes[pic.size]} · ${T.common.meta(p.w, p.h, p.threads.length, estimateMinutes(p))}`,
      stats: T.sheet.stats(st.singles.toFixed(1), st.small.toFixed(1), Number.isFinite(st.minDelta) ? st.minDelta.toFixed(3) : '—'),
      side: Math.max(p.w, p.h),
      threads: p.threads.length,
    };
    infos.set(key, info);
  }
  return info;
}

/**
 * Комментарий к картинке — что поправить (просьба владельца 16.10.2026: по одному «Нет» не понять,
 * что править). Записывается, когда поле теряет фокус или уходит с экрана вместе с карточкой.
 */
function NoteField({ id, store, title, value, onCommit }: { id: string; store: string; title: string; value: string; onCommit: (key: string, text: string) => void }) {
  const { theme } = useSettings();
  // набранное и ещё не записанное; null — в поле записанный комментарий
  const [draft, setDraft] = useState<string | null>(null);
  const pending = useRef<{ text: string | null }>({ text: null });
  const change = (text: string) => {
    pending.current.text = text;
    setDraft(text);
  };
  const commit = () => {
    const text = pending.current.text;
    pending.current.text = null;
    if (text !== null) onCommit(store, text);
    setDraft(null);
  };
  // список выгружает карточки, ушедшие далеко с экрана, — набранное не пропадает
  useEffect(() => {
    const box = pending.current;
    return () => {
      if (box.text !== null) onCommit(store, box.text);
    };
  }, [store, onCommit]);
  return (
    <TextInput value={draft ?? value} onChangeText={change} onBlur={commit} onSubmitEditing={commit}
      maxLength={NOTE_MAX} placeholder={T.sheet.note} placeholderTextColor={theme.textDim} accessibilityLabel={T.sheet.noteLabel(title)}
      maxFontSizeMultiplier={FONT_MAX} returnKeyType="done" testID={`note-${id}`}
      style={[styles.note, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceAlt, fontFamily: FONTS.body }]} />
  );
}

type Level = 'same' | 0 | 1 | 2;
const LEVELS: Level[] = ['same', 0, 1, 2];
/**
 * Коллекции, чьи узоры собираются из картинки, — им «Настроить узор». Орнаменты и «Детям» нарисованы
 * (`drawn`), у старинных схем клетки — свои, упрощения нет: у них только нити (tools/content/decisions.ts).
 */
const TUNABLE: ReadonlySet<CollectionId> = new Set<CollectionId>(['painting', 'tales', 'russia', 'flowers', 'nature', 'cities', 'schemes']);

/**
 * «Настроить узор» (0.24.1; владелец 01.11.2026: «выбрать и сказать, что вот столько клеток если сделать, то
 * рисунок принимается»): клеток, нитей и упрощение. Сразу — как у узора сейчас; изменённое запоминается у
 * версии картинки и уходит в текст решений. Узор здесь не пересобирается: пересоберёт ассистент.
 */
function TuneBox({ id, store, info, chart, tune, onTune }: {
  id: string; store: string; info: Info;
  /** старинная схема: только нити */
  chart: boolean;
  tune: Tune | undefined; onTune: (key: string, t: Tune | null) => void;
}) {
  const { theme } = useSettings();
  const [open, setOpen] = useState(false);
  const [cells, setCells] = useState<string | null>(null);
  const [threads, setThreads] = useState<string | null>(null);
  // число из поля: пусто или вне пределов — как сейчас
  const read = (text: string | null, now: number, [lo, hi]: readonly [number, number], set: number | undefined) => {
    if (text === null) return set;
    const n = Number(text);
    return Number.isInteger(n) && n >= lo && n <= hi && n !== now ? n : undefined;
  };
  const save = (patch: { cells?: string | null; threads?: string | null; simplify?: Level }) => {
    const size = read(patch.cells !== undefined ? patch.cells : cells, info.side, TUNE_SIDE, tune?.size);
    const th = read(patch.threads !== undefined ? patch.threads : threads, info.threads, TUNE_THREADS, tune?.threads);
    const lv = patch.simplify !== undefined ? patch.simplify : tune?.simplify ?? 'same';
    onTune(store, { ...(size !== undefined ? { size } : {}), ...(th !== undefined ? { threads: th } : {}), ...(lv !== 'same' ? { simplify: lv } : {}) });
    setCells(null);
    setThreads(null);
  };
  const input = [styles.num, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceAlt, fontFamily: FONTS.body }];
  const set = tune ? tuneText(tune, T.sheet.tuneWords) : '';
  return (
    <View style={styles.tune}>
      <View style={styles.tuneRow}>
        <Button small kind="ghost" label={open ? T.sheet.tuneHide : T.sheet.tune} onPress={() => setOpen((o) => !o)} testID={`tune-open-${id}`} />
        {set ? <Txt bold style={styles.small} testID={`tune-text-${id}`}>{T.sheet.tuneSet(set)}</Txt> : null}
      </View>
      {open ? (
        <>
          <View style={styles.tuneRow}>
            {!chart ? (
              <>
                <Txt>{T.sheet.tuneCells}</Txt>
                <TextInput value={cells ?? String(tune?.size ?? info.side)} onChangeText={(t) => setCells(t.replace(/\D/g, ''))} onBlur={() => save({ cells })}
                  onSubmitEditing={() => save({ cells })} keyboardType="number-pad" maxLength={3} maxFontSizeMultiplier={FONT_MAX} testID={`tune-cells-${id}`} style={input} />
              </>
            ) : null}
            <Txt>{T.sheet.tuneThreads}</Txt>
            <TextInput value={threads ?? String(tune?.threads ?? info.threads)} onChangeText={(t) => setThreads(t.replace(/\D/g, ''))} onBlur={() => save({ threads })}
              onSubmitEditing={() => save({ threads })} keyboardType="number-pad" maxLength={2} maxFontSizeMultiplier={FONT_MAX} testID={`tune-threads-${id}`} style={input} />
          </View>
          {!chart ? (
            <>
              <Txt dim style={styles.small}>{T.sheet.tuneSimplify}</Txt>
              <Segmented<string> value={String(tune?.simplify ?? 'same')} testID={`tune-simplify-${id}`}
                onChange={(v) => save({ simplify: v === 'same' ? 'same' : (Number(v) as 0 | 1 | 2) })}
                options={LEVELS.map((l) => ({ id: String(l), label: T.sheet.tuneLevels[l] }))} />
            </>
          ) : null}
          {set ? <Button small kind="ghost" label={T.sheet.tuneReset} onPress={() => onTune(store, null)} testID={`tune-reset-${id}`} /> : null}
          <Txt dim style={styles.small}>{T.sheet.tuneNote}</Txt>
        </>
      ) : null}
    </View>
  );
}

export function SheetScreen({ onBack, onOpen }: { onBack: () => void; onOpen: (pic: PackPicture, workId?: string) => void }) {
  const { theme } = useSettings();
  const { today } = usePlayer();
  const { picks, setPick, notes, setNote, tunes, setTune } = usePicks();
  const [filter, setFilter] = useState<Filter>('all');
  // коллекция — чтобы отбирать по частям: двести картинок за раз не отметить
  const [coll, setColl] = useState<CollectionId | 'all'>('all');
  // отмеченная в «Без отметки» картинка остаётся на экране, пока не сменят фильтр или коллекцию:
  // после «Нет» можно дописать, что поправить (0.15.6)
  const [stay, setStay] = useState<ReadonlySet<string>>(() => new Set());
  const choose = (f: Filter) => {
    setFilter(f);
    setStay(new Set());
  };
  const chooseColl = (c: CollectionId | 'all') => {
    setColl(c);
    setStay(new Set());
  };
  const mark = (pic: PackPicture, v: Pick | null) => {
    setPick(pickKey(pic), v);
    if (filter === 'unmarked') setStay((s) => new Set(s).add(pic.id));
  };
  const [copied, setCopied] = useState<{ ok: boolean; text: string } | null>(null);
  const [works, setWorks] = useState<WorkEntry[]>([]);
  // на широком окне (компьютер, docs/specs/2026-09-web.md) — несколько карточек в ряд;
  // карточка последнего неполного ряда — той же ширины
  const { width } = useWindowDimensions();
  const cols = Math.max(1, Math.min(4, Math.floor(width / 340)));
  const cellWidth = (Math.min(width, 1600) - 24 - 12 * (cols - 1)) / cols;
  useEffect(() => {
    void loadIndex().then(setWorks);
  }, []);
  // указатель работ — от свежих к старым: первая незаконченная и есть последняя
  const started = (pic: PackPicture) => works.find((w) => w.pattern === `${pic.id}@${pic.v}` && !w.finished);

  const rows = useMemo(() => pictures().filter((p) => !p.hidden), []);
  // «На отборе» — пересобранные без «да» (повторный отбор, docs/09-content.md, §8; владелец 01.11.2026): у
  // картинки в наборе есть прежняя версия узора. У запаса и музейных без лицензии прежних версий нет
  const older = useMemo(() => rebuiltIds(), []);

  // отметка и комментарий — у версии картинки (pickKey): новая версия узора — без прежней отметки
  const count = (v: Pick) => rows.filter((pic) => picks[pickKey(pic)] === v).length;
  const marked = rows.filter((pic) => picks[pickKey(pic)]).length;
  const noted = rows.filter((pic) => notes[pickKey(pic)]).length;
  const tuned = rows.filter((pic) => tunes[pickKey(pic)]).length;
  const inColl = coll === 'all' ? rows : rows.filter((pic) => pic.collection === coll);
  // «Без «да»» — картинки не для выпуска: без «да» владельца или музейные без лицензии (`trial`)
  const shown = filter === 'unmarked' ? inColl.filter((pic) => !picks[pickKey(pic)] || stay.has(pic.id))
    : filter === 'review' ? inColl.filter((pic) => pic.trial && older.has(pic.id))
      : filter === 'trial' ? inColl.filter((pic) => pic.trial) : inColl;
  // в APK — только картинки с «да»: отбор идёт в закрытой веб-версии, где набор для проверки
  const onlyReleased = rows.length > 0 && !rows.some((pic) => pic.trial);
  const colls = COLLECTIONS.map((c) => ({ id: c, n: rows.filter((pic) => pic.collection === c).length })).filter((c) => c.n > 0);
  // «Название (id@v) — «комментарий»»: владельцу — узнать картинку, ассистенту — найти карточку, версию и что поправить
  const copy = async () => {
    const text = T.sheet.picksText(APP_VERSION, today, decisionGroups(rows, picks, notes, T.sheet, tunes));
    setCopied({ ok: await copyText(text), text });
  };

  const header = (
    <View style={styles.head}>
      <Txt dim style={styles.small}>{T.sheet.picksNote}</Txt>
      <Txt bold testID="sheet-picked">{T.sheet.picked(marked, rows.length, count('yes'), count('no'), count('later'), noted, tuned)}</Txt>
      <Segmented<Filter> value={filter} onChange={choose} testID="sheet-filter"
        options={(['all', 'unmarked', 'review', 'trial'] as const).map((id) => ({ id, label: T.sheet.filter[id] }))} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colls} testID="sheet-colls">
        {[{ id: 'all' as const, label: `${T.sheet.filter.all} · ${rows.length}` },
          ...colls.map((c) => ({ id: c.id, label: `${T.library.collections[c.id]} · ${c.n}` }))].map((c) => (
          <Button key={c.id} small kind={coll === c.id ? 'primary' : 'secondary'} label={c.label}
            onPress={() => chooseColl(c.id)} testID={`sheet-coll-${c.id}`} />
        ))}
      </ScrollView>
      {filter !== 'all' || coll !== 'all' ? <Txt dim style={styles.small} testID="sheet-shown">{T.sheet.shown(shown.length, shown.filter((pic) => picks[pickKey(pic)]).length)}</Txt> : null}
      <Button kind="secondary" label={T.sheet.copy} disabled={!marked && !noted && !tuned} onPress={() => void copy()} testID="sheet-copy" />
      {copied ? (
        <>
          <Txt dim style={styles.small}>{copied.ok ? T.sheet.copied : T.sheet.notCopied}</Txt>
          <Card><Txt selectable style={styles.small} testID="sheet-picks-text">{copied.text}</Txt></Card>
        </>
      ) : null}
    </View>
  );

  return (
    <Screen title={T.sheet.title} onBack={onBack} wide={cols > 1}>
      <FlatList
        key={cols}
        numColumns={cols}
        columnWrapperStyle={cols > 1 ? styles.row : undefined}
        data={shown}
        keyExtractor={(pic) => pic.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={rows.length ? header : null}
        ListEmptyComponent={<Txt dim style={styles.empty} testID="sheet-none">
          {!rows.length ? T.sheet.empty : onlyReleased && (filter === 'review' || filter === 'trial') ? T.sheet.onlyReleased : T.sheet.none}
        </Txt>}
        extraData={[works, picks, notes, tunes, theme]}
        // карточка — крупное превью: на экране их две-три, вперёд — ещё на пару экранов
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={5}
        renderItem={({ item: pic }) => {
          const work = started(pic);
          const info = infoOf(pic);
          return (
            <Card style={[styles.card, cols > 1 && { flex: 1, maxWidth: cellWidth }]}>
              <Pressable onPress={() => onOpen(pic, work?.id)} accessibilityRole="button" testID={`sheet-${pic.id}`}
                style={({ pressed }) => pressed && styles.pressed}>
                {info.uri ? <Image source={{ uri: info.uri }} style={styles.img} resizeMode="contain" /> : null}
                <View style={styles.text}>
                  <Txt title style={styles.title}>{pic.title}</Txt>
                  {pic.author ? <Txt dim>{[pic.author.name, pic.made].filter(Boolean).join(', ')}</Txt> : null}
                  <Txt>{info.meta}</Txt>
                  <Txt dim style={styles.small}>{info.stats}</Txt>
                  {pic.trial ? <Txt dim style={styles.small}>{T.sheet.notForRelease}</Txt> : null}
                  {work ? <Txt bold testID={`sheet-work-${pic.id}`}>{T.sheet.progress(Math.floor((work.done * 100) / Math.max(1, work.total)))}</Txt> : null}
                </View>
              </Pressable>
              {/* отметка и комментарий — вне нажимаемой части: нажатие на них картинку не открывает */}
              <View style={styles.decide}>
                {/* та же отметка ещё раз — снять */}
                <Segmented<Pick | 'none'> value={picks[pickKey(pic)] ?? 'none'} testID={`pick-${pic.id}`}
                  onChange={(v) => mark(pic, v === 'none' || v === picks[pickKey(pic)] ? null : v)}
                  options={PICKS.map((v) => ({ id: v, label: T.sheet.picks[v] }))} />
                <NoteField id={pic.id} store={pickKey(pic)} title={pic.title} value={notes[pickKey(pic)] ?? ''} onCommit={setNote} />
                {TUNABLE.has(pic.collection) ? (
                  <TuneBox id={pic.id} store={pickKey(pic)} info={info} chart={pic.collection === 'schemes'} tune={tunes[pickKey(pic)]} onTune={setTune} />
                ) : null}
              </View>
            </Card>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: 12, gap: 12 },
  card: { padding: 0, overflow: 'hidden' },
  row: { gap: 12 },
  img: { width: '100%', aspectRatio: 1.25, backgroundColor: '#e2e3da' },
  text: { padding: 12, gap: 2 },
  title: { fontSize: 19 },
  small: { fontSize: 12, lineHeight: 17 },
  empty: { margin: 24 },
  head: { gap: 8, marginBottom: 4 },
  colls: { gap: 8, paddingVertical: 2 },
  pressed: { opacity: 0.85 },
  decide: { paddingHorizontal: 12, paddingBottom: 12, gap: 8 },
  note: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  tune: { gap: 6 },
  tuneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  num: { width: 64, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 8, fontSize: 16, textAlign: 'center' },
});

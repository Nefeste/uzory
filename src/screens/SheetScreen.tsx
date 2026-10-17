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
import { decisionGroups, NOTE_MAX, PICKS } from '../state/decisions';
import { patternOf, pictures } from '../state/library';
import { type Pick, usePicks } from '../state/picks';
import { usePlayer } from '../state/player';
import { useSettings } from '../state/settings';
import { loadIndex, type WorkEntry } from '../state/works';
import { Button, Card, FONT_MAX, Screen, Segmented, Txt } from '../ui/components';
import { previewUri } from '../render/preview';
import { FONTS } from '../ui/theme';
import { APP_VERSION } from '../version';

type Filter = 'all' | 'unmarked' | 'trial';

interface Info {
  uri: string | null;
  meta: string;
  stats: string;
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
    };
    infos.set(key, info);
  }
  return info;
}

/**
 * Комментарий к картинке — что поправить (просьба владельца 16.10.2026: по одному «Нет» не понять,
 * что править). Записывается, когда поле теряет фокус или уходит с экрана вместе с карточкой.
 */
function NoteField({ id, title, value, onCommit }: { id: string; title: string; value: string; onCommit: (id: string, text: string) => void }) {
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
    if (text !== null) onCommit(id, text);
    setDraft(null);
  };
  // список выгружает карточки, ушедшие далеко с экрана, — набранное не пропадает
  useEffect(() => {
    const box = pending.current;
    return () => {
      if (box.text !== null) onCommit(id, box.text);
    };
  }, [id, onCommit]);
  return (
    <TextInput value={draft ?? value} onChangeText={change} onBlur={commit} onSubmitEditing={commit}
      maxLength={NOTE_MAX} placeholder={T.sheet.note} placeholderTextColor={theme.textDim} accessibilityLabel={T.sheet.noteLabel(title)}
      maxFontSizeMultiplier={FONT_MAX} returnKeyType="done" testID={`note-${id}`}
      style={[styles.note, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceAlt, fontFamily: FONTS.body }]} />
  );
}

export function SheetScreen({ onBack, onOpen }: { onBack: () => void; onOpen: (pic: PackPicture, workId?: string) => void }) {
  const { theme } = useSettings();
  const { today } = usePlayer();
  const { picks, setPick, notes, setNote } = usePicks();
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
  const mark = (id: string, v: Pick | null) => {
    setPick(id, v);
    if (filter === 'unmarked') setStay((s) => new Set(s).add(id));
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

  const count = (v: Pick) => rows.filter((pic) => picks[pic.id] === v).length;
  const marked = rows.filter((pic) => picks[pic.id]).length;
  const noted = rows.filter((pic) => notes[pic.id]).length;
  const inColl = coll === 'all' ? rows : rows.filter((pic) => pic.collection === coll);
  // «Без «да»» — картинки не для выпуска: без «да» владельца или музейные без лицензии (`trial`)
  const shown = filter === 'unmarked' ? inColl.filter((pic) => !picks[pic.id] || stay.has(pic.id))
    : filter === 'trial' ? inColl.filter((pic) => pic.trial) : inColl;
  const colls = COLLECTIONS.map((c) => ({ id: c, n: rows.filter((pic) => pic.collection === c).length })).filter((c) => c.n > 0);
  // «Название (id) — «комментарий»»: владельцу — узнать картинку, ассистенту — найти карточку и что поправить
  const copy = async () => {
    const text = T.sheet.picksText(APP_VERSION, today, decisionGroups(rows, picks, notes, T.sheet));
    setCopied({ ok: await copyText(text), text });
  };

  const header = (
    <View style={styles.head}>
      <Txt dim style={styles.small}>{T.sheet.picksNote}</Txt>
      <Txt bold testID="sheet-picked">{T.sheet.picked(marked, rows.length, count('yes'), count('no'), count('later'), noted)}</Txt>
      <Segmented<Filter> value={filter} onChange={choose} testID="sheet-filter"
        options={(['all', 'unmarked', 'trial'] as const).map((id) => ({ id, label: T.sheet.filter[id] }))} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colls} testID="sheet-colls">
        {[{ id: 'all' as const, label: `${T.sheet.filter.all} · ${rows.length}` },
          ...colls.map((c) => ({ id: c.id, label: `${T.library.collections[c.id]} · ${c.n}` }))].map((c) => (
          <Button key={c.id} small kind={coll === c.id ? 'primary' : 'secondary'} label={c.label}
            onPress={() => chooseColl(c.id)} testID={`sheet-coll-${c.id}`} />
        ))}
      </ScrollView>
      <Button kind="secondary" label={T.sheet.copy} disabled={!marked && !noted} onPress={() => void copy()} testID="sheet-copy" />
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
        ListEmptyComponent={<Txt dim style={styles.empty}>{T.sheet.empty}</Txt>}
        extraData={[works, picks, notes, theme]}
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
                <Segmented<Pick | 'none'> value={picks[pic.id] ?? 'none'} testID={`pick-${pic.id}`}
                  onChange={(v) => mark(pic.id, v === 'none' || v === picks[pic.id] ? null : v)}
                  options={PICKS.map((v) => ({ id: v, label: T.sheet.picks[v] }))} />
                <NoteField id={pic.id} title={pic.title} value={notes[pic.id] ?? ''} onCommit={setNote} />
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
});

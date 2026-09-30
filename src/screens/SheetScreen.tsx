// «Лист» (docs/specs/2026-09-spikes.md, П3): узоры встроенного набора на телефоне —
// как их увидит игрок, с числами проверок. Владелец отмечает у каждой «Да», «Нет» или «Позже»
// (docs/09-content.md, §8) и отдаёт решения ассистенту текстом — тот ставит `approved`.
// Начатая картинка открывается там, где её оставили: большие вышиваются не за один раз.
// Превью и числа карточки считаются, когда карточка показывается (0.10.1): разом двести узоров
// телефон разбирал бы десятки секунд.
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Image, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { COLLECTIONS, type CollectionId } from '../engine/library';
import type { PackPicture } from '../engine/pack';
import { estimateMinutes } from '../engine/pattern';
import { patternStats } from '../engine/stats';
import { T } from '../i18n';
import { copyText } from '../state/clip';
import { patternOf, pictures } from '../state/library';
import { type Pick, usePicks } from '../state/picks';
import { usePlayer } from '../state/player';
import { useSettings } from '../state/settings';
import { loadIndex, type WorkEntry } from '../state/works';
import { Button, Card, Screen, Segmented, Txt } from '../ui/components';
import { previewUri } from '../render/preview';
import { APP_VERSION } from '../version';

type Filter = 'all' | 'unmarked';
const PICKS: Pick[] = ['yes', 'no', 'later'];

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

export function SheetScreen({ onBack, onOpen }: { onBack: () => void; onOpen: (pic: PackPicture, workId?: string) => void }) {
  const { theme } = useSettings();
  const { today } = usePlayer();
  const { picks, setPick } = usePicks();
  const [filter, setFilter] = useState<Filter>('all');
  // коллекция — чтобы отбирать по частям: двести картинок за раз не отметить
  const [coll, setColl] = useState<CollectionId | 'all'>('all');
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
  const inColl = coll === 'all' ? rows : rows.filter((pic) => pic.collection === coll);
  const shown = filter === 'unmarked' ? inColl.filter((pic) => !picks[pic.id]) : inColl;
  const colls = COLLECTIONS.map((c) => ({ id: c, n: rows.filter((pic) => pic.collection === c).length })).filter((c) => c.n > 0);
  // «Название (id)»: владельцу — узнать картинку, ассистенту — найти карточку
  const copy = async () => {
    const text = T.sheet.picksText(APP_VERSION, today, PICKS.map((v) => [
      T.sheet.picks[v], rows.filter((pic) => picks[pic.id] === v).map((pic) => `${pic.title} (${pic.id})`),
    ]));
    setCopied({ ok: await copyText(text), text });
  };

  const header = (
    <View style={styles.head}>
      <Txt dim style={styles.small}>{T.sheet.picksNote}</Txt>
      <Txt bold testID="sheet-picked">{T.sheet.picked(marked, rows.length, count('yes'), count('no'), count('later'))}</Txt>
      <Segmented<Filter> value={filter} onChange={setFilter} testID="sheet-filter"
        options={[{ id: 'all', label: T.sheet.filter.all }, { id: 'unmarked', label: T.sheet.filter.unmarked }]} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colls} testID="sheet-colls">
        {[{ id: 'all' as const, label: `${T.sheet.filter.all} · ${rows.length}` },
          ...colls.map((c) => ({ id: c.id, label: `${T.library.collections[c.id]} · ${c.n}` }))].map((c) => (
          <Button key={c.id} small kind={coll === c.id ? 'primary' : 'secondary'} label={c.label}
            onPress={() => setColl(c.id)} testID={`sheet-coll-${c.id}`} />
        ))}
      </ScrollView>
      <Button kind="secondary" label={T.sheet.copy} disabled={!marked} onPress={() => void copy()} testID="sheet-copy" />
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
        extraData={[works, picks, theme]}
        // карточка — крупное превью: на экране их две-три, вперёд — ещё на пару экранов
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={5}
        renderItem={({ item: pic }) => {
          const work = started(pic);
          const info = infoOf(pic);
          return (
            <Card onPress={() => onOpen(pic, work?.id)} style={[styles.card, cols > 1 && { flex: 1, maxWidth: cellWidth }]} testID={`sheet-${pic.id}`}>
              {info.uri ? <Image source={{ uri: info.uri }} style={styles.img} resizeMode="contain" /> : null}
              <View style={styles.text}>
                <Txt title style={styles.title}>{pic.title}</Txt>
                {pic.author ? <Txt dim>{[pic.author.name, pic.made].filter(Boolean).join(', ')}</Txt> : null}
                <Txt>{info.meta}</Txt>
                <Txt dim style={styles.small}>{info.stats}</Txt>
                {pic.trial ? <Txt dim style={styles.small}>{T.sheet.notForRelease}</Txt> : null}
                {work ? <Txt bold testID={`sheet-work-${pic.id}`}>{T.sheet.progress(Math.floor((work.done * 100) / Math.max(1, work.total)))}</Txt> : null}
                {/* та же отметка ещё раз — снять */}
                <View style={styles.pick}>
                  <Segmented<Pick | 'none'> value={picks[pic.id] ?? 'none'} testID={`pick-${pic.id}`}
                    onChange={(v) => setPick(pic.id, v === 'none' || v === picks[pic.id] ? null : v)}
                    options={PICKS.map((v) => ({ id: v, label: T.sheet.picks[v] }))} />
                </View>
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
  pick: { marginTop: 8 },
});

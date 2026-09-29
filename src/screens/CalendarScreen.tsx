// Календарь картинок дня (docs/specs/2026-09-library.md, «Календарь»): месяцы сверху вниз,
// начиная с текущего; в клетке дня — превью его картинки; сегодняшний выделен; будущих дней
// не видно. Первый месяц — месяц первого запуска: у нового игрока нет «долга» из сотни дней.
import { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { monthGrids } from '../engine/dates';
import type { PackPicture } from '../engine/pack';
import { T } from '../i18n';
import { percentOf, useCatalog } from '../state/catalog';
import { dailyCalendar, pictureById, useLibrary } from '../state/library';
import { usePlayer } from '../state/player';
import { useSettings } from '../state/settings';
import { Screen, Txt } from '../ui/components';
import { PicTile } from '../ui/PicTile';

export function CalendarScreen({ onBack, onOpen }: { onBack: () => void; onOpen: (pic: PackPicture) => void }) {
  const { theme } = useSettings();
  const { player, today } = usePlayer();
  const cat = useCatalog();
  const { width } = useWindowDimensions();
  const cell = Math.floor((Math.min(width, 640) - 32 - 6 * 4) / 7);
  const all = useLibrary();
  const calendar = useMemo(() => dailyCalendar(player.pinned, all), [player.pinned, all]);
  const days = useMemo(() => calendar.range(player.installed, today), [calendar, player.installed, today]);
  const list = useMemo(() => monthGrids(player.installed, today), [player.installed, today]);

  return (
    <Screen title={T.calendar.title} onBack={onBack}>
      {!cat ? <ActivityIndicator style={styles.wait} color={theme.accent} /> : (
        <ScrollView contentContainerStyle={styles.body} testID="calendar">
          <Txt dim style={styles.note}>{days.size ? T.calendar.note : T.calendar.empty}</Txt>
          {list.map((mo) => (
            <View key={`${mo.y}-${mo.m}`} style={styles.month}>
              <Txt title style={styles.h}>{T.calendar.month(mo.m, mo.y)}</Txt>
              <View style={styles.week}>
                {T.calendar.weekdays.map((d) => <Txt key={d} dim style={[styles.wd, { width: cell }]}>{d}</Txt>)}
              </View>
              <View style={styles.grid}>
                {mo.days.map((d, i) => {
                  const id = d && d >= player.installed && d <= today ? days.get(d) : undefined;
                  const pic = id ? pictureById(id) : undefined;
                  const w = pic ? cat.workOf(pic) : undefined;
                  const isToday = d === today;
                  return (
                    <View key={d ?? `x${i}`} style={[styles.day, { width: cell }, isToday && { borderColor: theme.accent }]} testID={d ? `day-${d}` : undefined}>
                      {d ? <Txt dim={!isToday} bold={isToday} style={styles.num}>{String(+d.slice(8))}</Txt> : null}
                      {pic ? (
                        <PicTile pic={pic} size={cell - 6} title={false} done={cat.done(pic)} percent={w && !w.finished ? percentOf(w) : undefined}
                          onPress={() => onOpen(pic)} testID={`day-pic-${d}`} />
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  wait: { margin: 24 },
  body: { padding: 16, gap: 18 },
  note: { fontSize: 13, lineHeight: 18 },
  month: { gap: 6 },
  h: { fontSize: 20 },
  week: { flexDirection: 'row', gap: 4 },
  wd: { fontSize: 12, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  day: { alignItems: 'center', gap: 2, borderWidth: 1, borderColor: 'transparent', borderRadius: 6, paddingVertical: 2 },
  num: { fontSize: 12 },
});

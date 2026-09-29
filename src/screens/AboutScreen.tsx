// О программе (docs/08-game-design.md, «Настройки»): версия, студия, шрифты с лицензиями, музыка —
// исполнитель и лицензия каждой записи — и источник каждой картинки встроенного набора — автор,
// основание, откуда взята.
import { FlatList, Linking, Pressable, StyleSheet, View } from 'react-native';
import type { PackPicture } from '../engine/pack';
import { T } from '../i18n';
import { useLibrary } from '../state/library';
import { musicTracks } from '../state/music';
import { useNet } from '../state/net';
import { useSettings } from '../state/settings';
import { Screen, SectionTitle, Txt } from '../ui/components';
import { APP_BUILD, APP_VERSION } from '../version';

export function AboutScreen({ onBack }: { onBack: () => void }) {
  const { theme } = useSettings();
  const list = useLibrary().filter((p) => !p.hidden);
  const got = useNet().packs.reduce<string | null>((a, p) => (a && a > p.got ? a : p.got), null);

  const header = (
    <View style={styles.head}>
      <Txt bold testID="about-version">{T.about.version(APP_VERSION, APP_BUILD)}</Txt>
      <Txt dim style={styles.text}>{T.about.studio}</Txt>
      <SectionTitle>{T.about.fonts}</SectionTitle>
      <Txt dim style={styles.text}>{T.about.fontsText}</Txt>
      {musicTracks.length ? (
        <>
          <SectionTitle>{T.about.music}</SectionTitle>
          <Txt dim style={styles.text}>{T.about.musicNote}</Txt>
          {musicTracks.map((t) => (
            <View key={t.id} style={[styles.item, { borderBottomColor: theme.border }]} testID={`about-music-${t.id}`}>
              <Txt bold>{`${t.composer}. ${t.title}`}</Txt>
              <Txt dim style={styles.small}>{`${t.performer} · ${T.about.musicLicense(t.license)}`}</Txt>
              <Pressable onPress={() => void Linking.openURL(t.page).catch(() => undefined)} accessibilityRole="link" hitSlop={6}>
                <Txt style={[styles.small, { color: theme.accent }]} numberOfLines={1}>{`${T.about.source}: ${t.page.replace(/^https?:\/\//, '')}`}</Txt>
              </Pressable>
            </View>
          ))}
        </>
      ) : null}
      <SectionTitle>{T.about.pictures}</SectionTitle>
      <Txt dim style={styles.text}>{T.about.picturesNote(list.length)}</Txt>
      {got ? <Txt dim style={styles.text} testID="about-updated">{T.about.updated(got)}</Txt> : null}
    </View>
  );

  const item = ({ item: p }: { item: PackPicture }) => {
    const who = [p.author?.name, p.made].filter(Boolean).join(', ');
    return (
      <View style={[styles.item, { borderBottomColor: theme.border }]}>
        <Txt bold>{p.title}</Txt>
        {who ? <Txt dim style={styles.small}>{who}</Txt> : null}
        <Txt dim style={styles.small}>{p.source.basis}</Txt>
        {p.source.url ? (
          <Pressable onPress={() => void Linking.openURL(p.source.url).catch(() => undefined)} accessibilityRole="link" hitSlop={6}>
            <Txt style={[styles.small, { color: theme.accent }]} numberOfLines={1}>{`${T.about.source}: ${p.source.url.replace(/^https?:\/\//, '')}`}</Txt>
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <Screen title={T.about.title} onBack={onBack}>
      <FlatList data={list} keyExtractor={(p) => p.id} renderItem={item} ListHeaderComponent={header}
        contentContainerStyle={styles.wrap} initialNumToRender={12} testID="about" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, paddingBottom: 40 },
  head: { gap: 6, marginBottom: 6 },
  text: { fontSize: 14, lineHeight: 20 },
  item: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
  small: { fontSize: 13, lineHeight: 18 },
});

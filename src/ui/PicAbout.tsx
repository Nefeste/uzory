// «О картине» (docs/08-game-design.md, «Готово»; docs/09-content.md, «Рассказ о картине»): кто
// и когда, где хранится или где снято, рассказ, основание и источник. Одно и то же на карточке
// картинки, в меню канвы и на «Готово».
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import type { PackPicture } from '../engine/pack';
import { T } from '../i18n';
import { useSettings } from '../state/settings';
import { Txt } from './components';

/** Есть что рассказать сверх названия: у своих орнаментов студии — нечего. */
export const hasAbout = (p: PackPicture) => !!(p.author || p.place || p.about);

/** «Сергей Прокудин-Горский, 1909»; с `life` — «Сергей Прокудин-Горский (1863–1944), 1909». */
export function whoMade(p: PackPicture, life = false): string {
  const name = p.author && (life && p.author.life ? `${p.author.name} (${p.author.life})` : p.author.name);
  return [name, p.made].filter(Boolean).join(', ');
}

/**
 * Подпись (docs/09-content.md, §2 и §7): «Иван Шишкин. Рожь, 1878. Схема для вышивки по мотивам
 * картины». У картинки без автора — своей работы студии — её нет.
 */
export function signature(p: PackPicture): string | null {
  if (!p.author) return null;
  const name = p.author.name.charAt(0).toUpperCase() + p.author.name.slice(1);
  return T.picture.signature(name, p.title, p.made, T.picture.basedOn[p.collection]);
}

/** `head` — с названием и автором: на карточке они уже есть над кнопкой. */
export function PicAbout({ pic, head = true }: { pic: PackPicture; head?: boolean }) {
  const { theme } = useSettings();
  const who = whoMade(pic, true);
  const sign = signature(pic);
  return (
    <View style={styles.box}>
      {head ? <Txt title style={styles.title}>{pic.title}</Txt> : null}
      {head && who ? <Txt dim>{who}</Txt> : null}
      {pic.place ? <Txt dim>{pic.place}</Txt> : null}
      {pic.about ? <Txt style={styles.text}>{pic.about}</Txt> : null}
      {sign ? <Txt style={styles.sign}>{sign}</Txt> : null}
      <Txt dim style={styles.small}>{pic.source.basis}</Txt>
      {pic.source.url ? (
        <Pressable onPress={() => void Linking.openURL(pic.source.url).catch(() => undefined)} accessibilityRole="link">
          <Txt style={[styles.small, { color: theme.accent }]} numberOfLines={1}>{`${T.picture.source}: ${pic.source.url.replace(/^https?:\/\//, '')}`}</Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 6 },
  title: { fontSize: 22 },
  text: { fontSize: 16, lineHeight: 23 },
  small: { fontSize: 13, lineHeight: 18 },
  sign: { fontSize: 14, lineHeight: 20, fontStyle: 'italic' },
});

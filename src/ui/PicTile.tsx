// Превью картинки в библиотеке, коллекции и календаре (docs/08-game-design.md, «Превью»): не
// начатая — схемой, бледно; вышитая — целиком, с ✓; начатая — процент. Метки «Новое» и «Узоры+»
// (без замка и затемнения: смотреть можно всё). Превью считается после первой отрисовки, а
// до того — бледная заглушка тех же размеров: сетка не прыгает (docs/specs/2026-09-library.md).
// Превью считаются по очереди, по одному за раз (0.10.3): большая картина — сотни тысяч клеток,
// и десятки превью подряд держали бы экран секунды; между ними телефон отвечает на касания.
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { PackPicture } from '../engine/pack';
import { T } from '../i18n';
import { previewUri } from '../render/preview';
import { patternOf } from '../state/library';
import { useSettings } from '../state/settings';
import { Txt } from './components';

/** Очередь превью: первыми — те, что показались раньше (верхние ряды). */
const queue: (() => void)[] = [];
let pumping = false;

function pump() {
  const job = queue.shift();
  if (!job) {
    pumping = false;
    return;
  }
  pumping = true;
  setTimeout(() => {
    job();
    pump();
  }, 0);
}

function later(job: () => void) {
  queue.push(job);
  if (!pumping) pump();
}

export function PicTile({ pic, size, done, percent, isNew, plus, title = true, onPress, testID }: {
  pic: PackPicture;
  /** сторона превью, dp */
  size: number;
  done?: boolean;
  /** начатая работа — процент */
  percent?: number;
  isNew?: boolean;
  plus?: boolean;
  /** подпись под превью */
  title?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { theme } = useSettings();
  const mode = done ? 'done' : 'scheme';
  const key = `${pic.id}@${pic.v}|${mode}`;
  const [shown, setShown] = useState<{ key: string; uri: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    // ушедшая с экрана плитка своё превью не считает
    later(() => {
      if (alive) setShown({ key, uri: previewUri(patternOf(pic), mode, 240) });
    });
    return () => {
      alive = false;
    };
  }, [pic, mode, key]);

  return (
    <Pressable onPress={onPress} style={[styles.tile, { width: size }]} accessibilityRole="button" accessibilityLabel={pic.title} testID={testID}>
      <View style={[styles.box, { width: size, height: size, backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
        {shown?.key === key && shown.uri ? <Image source={{ uri: shown.uri }} style={styles.img} resizeMode="contain" /> : null}
        {isNew ? <Txt bold style={[styles.badge, styles.left, { backgroundColor: theme.accent, color: theme.accentText }]}>{T.library.newMark}</Txt> : null}
        {plus ? <Txt bold style={[styles.badge, styles.right, { backgroundColor: theme.surface, color: theme.text }]}>{T.library.plusMark}</Txt> : null}
        {done ? <Txt bold style={[styles.badge, styles.corner, { backgroundColor: theme.spruce, color: '#ffffff' }]}>✓</Txt>
          : percent !== undefined ? <Txt bold style={[styles.badge, styles.corner, { backgroundColor: theme.surface, color: theme.text }]}>{`${percent} %`}</Txt> : null}
      </View>
      {title ? <Txt numberOfLines={2} style={styles.title}>{pic.title}</Txt> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { gap: 4 },
  box: { borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  img: { width: '100%', height: '100%' },
  badge: { position: 'absolute', fontSize: 11, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
  left: { left: 4, top: 4 },
  right: { right: 4, top: 4 },
  corner: { right: 4, bottom: 4 },
  title: { fontSize: 13, lineHeight: 17 },
});

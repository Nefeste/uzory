// Полоса нитей (docs/specs/2026-09-canvas.md, «Полоса нитей»): кружок цвета с номером,
// под ним — сколько клеток осталось; выбранная — с кольцом; законченная — ✓ и в конец.
import { useEffect, useRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { digitOn } from '../engine/color';
import { hex, type Thread } from '../engine/pattern';
import { FONT_MAX } from '../ui/components';
import { FONTS } from '../ui/theme';
import { useSettings } from '../state/settings';

const ITEM = 58;

export function ThreadBar({ threads, left, selected, onSelect, onLong }: {
  threads: Thread[];
  left: ArrayLike<number>;
  selected: number;
  onSelect: (t: number) => void;
  onLong: (t: number) => void;
}) {
  const { theme } = useSettings();
  const scroll = useRef<ScrollView>(null);
  const order = threads.map((_, i) => i).sort((a, b) => Number(left[a] === 0) - Number(left[b] === 0) || a - b);
  const pos = order.indexOf(selected);

  useEffect(() => {
    if (pos >= 0) scroll.current?.scrollTo({ x: Math.max(0, pos * ITEM - ITEM * 2), animated: true });
  }, [pos]);

  // в браузере колёсико мыши листает полосу вбок; тачпад листает её сам
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = (scroll.current as unknown as { getScrollableNode?: () => HTMLElement } | null)?.getScrollableNode?.();
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} testID="threads">
      {order.map((t) => {
        const th = threads[t];
        const done = left[t] === 0;
        const on = t === selected;
        return (
          <Pressable key={t} onPress={() => onSelect(t)} onLongPress={() => onLong(t)} style={styles.item}
            accessibilityRole="button" accessibilityLabel={`${t + 1} ${th.name}`} testID={`thread-${t + 1}`}>
            <View style={[styles.ring, { borderColor: on ? theme.accent : 'transparent' }]}>
              <View style={[styles.dot, { backgroundColor: hex(th.rgb), borderColor: theme.border }]}>
                <Text maxFontSizeMultiplier={FONT_MAX} style={[styles.num, { color: hex(digitOn(th.rgb)) }]}>{done ? '✓' : t + 1}</Text>
              </View>
            </View>
            <Text maxFontSizeMultiplier={FONT_MAX} style={[styles.left, { color: theme.textDim }]}>{done ? ' ' : left[t]}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 8, gap: 0 },
  item: { width: ITEM, alignItems: 'center', paddingVertical: 4 },
  ring: { borderWidth: 3, borderRadius: 27, padding: 2 },
  dot: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  num: { fontSize: 17, fontFamily: FONTS.bold },
  left: { fontSize: 12, marginTop: 2, fontFamily: FONTS.body },
});

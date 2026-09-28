// из votchina: src/ui/components.tsx @ 1242776
// Общие элементы интерфейса (перенос из «Вотчины», вид — по сайту студии).
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '../i18n';
import { useSettings } from '../state/settings';
import { FONTS } from './theme';

/**
 * Предел крупного системного шрифта (docs/08-game-design.md, «Для старшей аудитории»):
 * дальше кнопки на экране 360 dp обрезаются. Ставится каждому `Text` — `defaultProps`
 * в React 19 нет; tools/test/ui.test.ts не даёт забыть.
 */
export const FONT_MAX = 1.3;

/** `wide` — канва на весь экран компьютера; остальное — колонкой шириной с телефон-планшет. */
export function Screen({ children, title, onBack, right, wide }: { children: ReactNode; title?: string; onBack?: () => void; right?: ReactNode; wide?: boolean }) {
  const { theme } = useSettings();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      {title ? (
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={12} style={styles.back} accessibilityRole="button" accessibilityLabel={T.common.back} testID="back">
              <Text maxFontSizeMultiplier={FONT_MAX} style={[styles.backText, { color: theme.text }]}>‹</Text>
            </Pressable>
          ) : <View style={styles.back} />}
          <Txt title style={styles.title} numberOfLines={1}>{title}</Txt>
          <View style={styles.right}>{right}</View>
        </View>
      ) : null}
      <View style={[styles.column, wide && styles.wide]}>{children}</View>
    </View>
  );
}

export function Txt({ children, style, dim, title, bold, numberOfLines, selectable, testID }: {
  children: ReactNode; style?: StyleProp<TextStyle>; dim?: boolean; title?: boolean; bold?: boolean;
  numberOfLines?: number; selectable?: boolean; testID?: string;
}) {
  const { theme } = useSettings();
  const fontFamily = title ? FONTS.title : bold ? FONTS.bold : FONTS.body;
  return (
    <Text maxFontSizeMultiplier={FONT_MAX} testID={testID} numberOfLines={numberOfLines} selectable={selectable}
      style={[{ color: dim ? theme.textDim : theme.text, fontFamily }, style]}>
      {children}
    </Text>
  );
}

export function Button({ label, onPress, kind = 'primary', disabled, style, small, testID }: {
  label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'ghost'; disabled?: boolean;
  style?: StyleProp<ViewStyle>; small?: boolean; testID?: string;
}) {
  const { theme } = useSettings();
  const bg = kind === 'primary' ? theme.accent : kind === 'secondary' ? theme.surface : 'transparent';
  const fg = kind === 'primary' ? theme.accentText : theme.text;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" testID={testID}
      style={({ pressed }) => [styles.btn, small && styles.btnSmall,
        { backgroundColor: bg, borderColor: kind === 'secondary' ? theme.border : 'transparent', opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }, style]}>
      <Text maxFontSizeMultiplier={FONT_MAX} numberOfLines={1}
        style={[styles.btnText, small && styles.btnTextSmall, { color: fg, fontFamily: FONTS.bold }]}>{label}</Text>
    </Pressable>
  );
}

/** Переключатель на несколько вариантов; ширина варианта растёт с длиной подписи. */
export function Segmented<K extends string>({ value, options, onChange, testID }: {
  value: K; options: { id: K; label: string }[]; onChange: (v: K) => void; testID?: string;
}) {
  const { theme } = useSettings();
  return (
    <View style={[styles.seg, { borderColor: theme.border, backgroundColor: theme.surfaceAlt }]} testID={testID}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable key={o.id} onPress={() => onChange(o.id)} accessibilityRole="button" accessibilityState={{ selected: on }} testID={testID ? `${testID}-${o.id}` : undefined}
            style={[styles.segItem, { flex: o.label.length + 10 }, on && { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text maxFontSizeMultiplier={FONT_MAX} numberOfLines={1}
              style={[styles.segText, { color: on ? theme.text : theme.textDim, fontFamily: on ? FONTS.bold : FONTS.body }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const { theme } = useSettings();
  return (
    <Pressable onPress={() => onChange(!value)} style={[styles.toggle, { borderBottomColor: theme.border }]}>
      <Txt style={styles.toggleLabel}>{label}</Txt>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: theme.accent, false: theme.border }} thumbColor={theme.surface} />
    </Pressable>
  );
}

export function Card({ children, style, onPress, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; testID?: string }) {
  const { theme } = useSettings();
  const box = [styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, style];
  if (!onPress) return <View style={box} testID={testID}>{children}</View>;
  return (
    <Pressable onPress={onPress} testID={testID} accessibilityRole="button" style={({ pressed }) => [box, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Txt dim bold style={styles.section}>{children}</Txt>;
}

const styles = StyleSheet.create({
  column: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
  wide: { maxWidth: 1600 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 34, lineHeight: 36, marginTop: -4 },
  title: { flex: 1, fontSize: 20, textAlign: 'center' },
  right: { width: 44, alignItems: 'flex-end' },
  btn: { minHeight: 50, borderRadius: 6, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  btnSmall: { minHeight: 42, paddingHorizontal: 14 },
  btnText: { fontSize: 17 },
  btnTextSmall: { fontSize: 15 },
  seg: { flexDirection: 'row', borderWidth: 1, borderRadius: 6, padding: 3 },
  segItem: { paddingVertical: 9, paddingHorizontal: 4, borderRadius: 4, alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
  segText: { fontSize: 14 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  toggleLabel: { fontSize: 16, flex: 1, paddingRight: 12 },
  card: { borderWidth: 1, borderRadius: 6, padding: 14 },
  section: { fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 18, marginBottom: 8 },
});

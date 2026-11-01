// Выбор канвы работы (с 0.20.0; владелец 01.11.2026: «делай канву фоном узора»): пять образцов ткани в ряд —
// тем же шейдером, что канва (src/render/swatch.ts), — и строка «Канва: Кремовая». Канва бесплатно и у каждой
// работы своя: на карточке картинки, в меню канвы и на «Готово». Невышитый фон узора — её ткань.
import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { CANVASES, type CanvasId, type CanvasLook } from '../engine/looks';
import { T } from '../i18n';
import { canvasSwatch } from '../render/swatch';
import { useSettings } from '../state/settings';
import { Txt } from './components';

/** Цвет ткани канвы — для образца, если Skia не нарисовала его, и для превью. */
export const clothHex = (c: CanvasLook) => `#${c.cloth.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;

export function CanvasPicker({ value, onChange, note, testID }: {
  value: CanvasId;
  onChange: (id: CanvasId) => void;
  /** строка под образцами; нет — без неё */
  note?: string;
  /** образцы — `${testID}-${id}` */
  testID: string;
}) {
  const { theme } = useSettings();
  const swatches = useMemo(() => new Map(CANVASES.map((c) => [c.id, canvasSwatch(c)])), []);
  return (
    <View style={styles.box} testID={testID}>
      <Txt dim style={styles.label}>{T.looks.canvasNow(T.looks.canvases[value])}</Txt>
      <View style={styles.row}>
        {CANVASES.map((c) => {
          const on = c.id === value;
          const uri = swatches.get(c.id);
          return (
            <Pressable key={c.id} onPress={() => onChange(c.id)} hitSlop={4} accessibilityRole="button"
              accessibilityLabel={T.looks.canvasNow(T.looks.canvases[c.id])} accessibilityState={{ selected: on }}
              testID={`${testID}-${c.id}`}
              style={[styles.tile, { borderColor: on ? theme.accent : theme.border }, on && styles.on]}>
              {uri ? <Image source={{ uri }} style={styles.img} resizeMode="cover" />
                : <View style={[styles.img, { backgroundColor: clothHex(c) }]} />}
            </Pressable>
          );
        })}
      </View>
      {note ? <Txt dim style={styles.label}>{note}</Txt> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 6 },
  label: { fontSize: 13 },
  row: { flexDirection: 'row', gap: 6 },
  tile: { width: 40, height: 28, borderWidth: 1, borderRadius: 5, overflow: 'hidden' },
  on: { borderWidth: 2 },
  img: { width: '100%', height: '100%' },
});

// «Оформление» (решение владельца 31.10.2026, issue 116, вариант Б; docs/08-game-design.md, «Оформления»): цвет
// канвы — на всех работах, рамка — на «Готово» и на картинке «Поделиться». Образец канвы — тем же шейдером
// (src/render/swatch.ts), рамка — макетом. Своё оформление выбирается касанием; чужое — с ценой, покупка
// навсегда — со следующей версии (0.18.1). Кремовая канва и тёмное дерево — у всех.
import { type ReactNode, useMemo } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { CANVASES, type CanvasLook, FRAMES, type FrameLook, isFree, type LookId, lookOwned } from '../engine/looks';
import { T } from '../i18n';
import { canvasSwatch } from '../render/swatch';
import { useLooks } from '../state/looks';
import { useSettings } from '../state/settings';
import { Screen, SectionTitle, Txt } from '../ui/components';

/** Макет рамки на экране, dp. */
const MOCK_W = 96;
const MOCK_H = 72;

function FrameMock({ frame, cloth }: { frame: FrameLook; cloth: string }) {
  if (frame.kind === 'hoop') {
    return (
      <View style={[styles.mockHoop, { backgroundColor: frame.light }]}>
        <View style={[styles.mockHoopCloth, { backgroundColor: cloth }]} />
        <View style={[styles.mockClasp, { borderColor: frame.dark }]} />
      </View>
    );
  }
  return (
    <View style={[styles.mockFrame, { borderTopColor: frame.light, borderLeftColor: frame.light, borderBottomColor: frame.dark, borderRightColor: frame.dark }]}>
      <View style={[styles.mockCloth, { backgroundColor: cloth }, frame.inner ? { borderWidth: 1, borderColor: frame.inner } : null]} />
    </View>
  );
}

export function LooksScreen({ onBack }: { onBack: () => void }) {
  const { update, theme } = useSettings();
  const looks = useLooks();
  const own = (id: LookId) => lookOwned(id, looks.owned, looks.open);
  const swatches = useMemo(() => new Map(CANVASES.map((c) => [c.id, canvasSwatch(c)])), []);
  const clothHex = (c: CanvasLook) => `#${c.cloth.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
  const locked = CANVASES.some((c) => !own(c.id)) || FRAMES.some((f) => !own(f.id));

  // подпись под образцом: сейчас, есть, бесплатно или цена
  const state = (id: LookId, chosen: boolean) => {
    if (chosen) return T.looks.chosen;
    if (isFree(id)) return T.looks.free;
    return own(id) ? T.looks.owned : T.looks.locked;
  };

  const tile = (id: LookId, name: string, chosen: boolean, body: ReactNode, onPick: () => void) => (
    <Pressable key={id} onPress={() => own(id) && onPick()} accessibilityRole="button" accessibilityState={{ selected: chosen, disabled: !own(id) }}
      testID={`look-${id}`}
      style={[styles.tile, { backgroundColor: theme.surface, borderColor: chosen ? theme.accent : theme.border }, chosen && styles.chosen]}>
      {body}
      <Txt bold style={styles.name}>{name}</Txt>
      <Txt dim style={styles.small}>{state(id, chosen)}</Txt>
    </Pressable>
  );

  return (
    <Screen title={T.looks.title} onBack={onBack}>
      <ScrollView contentContainerStyle={styles.body} testID="looks">
        <Txt dim>{T.looks.note}</Txt>
        <SectionTitle>{T.looks.canvas}</SectionTitle>
        <View style={styles.grid}>
          {CANVASES.map((c) => tile(c.id, T.looks.canvases[c.id], looks.canvas.id === c.id,
            swatches.get(c.id)
              ? <Image source={{ uri: swatches.get(c.id)! }} style={styles.swatch} resizeMode="cover" />
              : <View style={[styles.swatch, { backgroundColor: clothHex(c) }]} />,
            () => update({ canvas: c.id })))}
        </View>
        <SectionTitle>{T.looks.frame}</SectionTitle>
        <View style={styles.grid}>
          {FRAMES.map((f) => tile(f.id, T.looks.frames[f.id], looks.frame.id === f.id,
            <View style={styles.mockBox}><FrameMock frame={f} cloth={clothHex(looks.canvas)} /></View>,
            () => update({ frame: f.id })))}
        </View>
        {locked ? <Txt dim style={styles.small} testID="looks-soon">{T.looks.soon}</Txt> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: 150, borderWidth: 1, borderRadius: 8, padding: 8, gap: 4 },
  chosen: { borderWidth: 2, padding: 7 },
  name: { fontSize: 15 },
  small: { fontSize: 13 },
  swatch: { width: '100%', aspectRatio: 7 / 4, borderRadius: 4 },
  mockBox: { height: 84, alignItems: 'center', justifyContent: 'center' },
  mockFrame: { width: MOCK_W, height: MOCK_H, borderWidth: 7, borderRadius: 1 },
  mockCloth: { flex: 1 },
  mockHoop: { width: 80, height: 80, borderRadius: 40, padding: 7, alignItems: 'center', justifyContent: 'center' },
  mockHoopCloth: { width: 66, height: 66, borderRadius: 33 },
  mockClasp: { position: 'absolute', top: -5, left: 32, width: 16, height: 10, borderRadius: 3, borderWidth: 1, backgroundColor: '#c9b98f' },
});

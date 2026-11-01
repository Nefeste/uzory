// «Посмотреть ближе» в «Своём узоре» (0.22.0; владелец 01.11.2026: «после выбора размера и количества нитей
// нужно дать возможность увеличить, чтобы посмотреть мелкие детали поближе, помимо надписи «подходит»»).
// Собранный узор целиком вышитым — той же канвой, что работа (src/canvas/StitchCanvas.tsx, без кисти): два
// пальца — ближе и дальше, один — двигать; в вебе — колёсико и мышь. Вблизи — крестики, как будут на работе,
// на канве, которую работа получит сразу (`workCanvas`).
import { useFont } from '@shopify/react-native-skia';
import { useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { fieldOf } from '../canvas/shader';
import { type CanvasApi, StitchCanvas } from '../canvas/StitchCanvas';
import { DIGIT_FONT_SIZE } from '../canvas/textures';
import { workCanvas } from '../engine/looks';
import type { Pattern } from '../engine/pattern';
import { T } from '../i18n';
import { useSettings } from '../state/settings';
import { Screen, Txt } from './components';
import { DIGIT_FONT } from './fonts';

export function PatternCloser({ pattern, onBack }: { pattern: Pattern; onBack: () => void }) {
  const { settings, theme } = useSettings();
  const font = useFont(DIGIT_FONT, DIGIT_FONT_SIZE);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const api = useRef<CanvasApi | null>(null);
  // всё вышито: номеров нет, видны стежки
  const stitched = useMemo(() => new Uint8Array(pattern.cells.length).fill(1), [pattern]);
  const look = useMemo(() => workCanvas(undefined, pattern), [pattern]);
  const field = fieldOf(look);
  return (
    <Screen title={T.mine.closerTitle} onBack={onBack}>
      <View style={[styles.canvas, { backgroundColor: theme.dark ? field.dark : field.light }]} testID="mine-closer"
        onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {size && font ? (
          <StitchCanvas pattern={pattern} stitched={stitched} selected={-1} mosaic={settings.style === 'mosaic'} hatch={false}
            bigNumbers={false} fill={false} font={font} width={size.w} height={size.h} apiRef={api} dark={theme.dark}
            viewOnly canvas={look} initial="fit" />
        ) : null}
      </View>
      <Txt dim style={styles.hint}>{Platform.OS === 'web' ? T.mine.closerHintWeb : T.mine.closerHint}</Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, overflow: 'hidden' },
  hint: { fontSize: 13, padding: 16 },
});

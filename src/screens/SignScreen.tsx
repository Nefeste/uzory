// Подпись мастерицы (0.21.0; владелец 01.11.2026: «делай … Д»): инициалы и год, затем подпись вышивается на
// маленькой канве той же нитью узора — кистью и касанием, как работа. Вышитая подпись встаёт под работой на
// «Готово» и на картинке «Поделиться» (src/engine/signature.ts). Стежки подписи — в записи работы
// (`WorkSession.setSign`), стежки работы не меняются.
import { useFont } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { fieldOf } from '../canvas/shader';
import { type CanvasApi, StitchCanvas } from '../canvas/StitchCanvas';
import { DIGIT_FONT_SIZE } from '../canvas/textures';
import { clothRgb, workCanvas } from '../engine/looks';
import type { Pattern } from '../engine/pattern';
import { cleanInitials, type Sign, signLines, signPattern, signThread } from '../engine/signature';
import { T } from '../i18n';
import { previewUri } from '../render/preview';
import { useSettings } from '../state/settings';
import { play } from '../state/sound';
import { openWork, type WorkSession } from '../state/works';
import { Button, FONT_MAX, Screen, Txt } from '../ui/components';
import { DIGIT_FONT } from '../ui/fonts';
import { FONTS } from '../ui/theme';

export function SignScreen({ pattern, workId, onBack, onDone }: {
  pattern: Pattern;
  workId: string;
  onBack: () => void;
  /** подпись вышита — назад на «Готово» */
  onDone: () => void;
}) {
  const { settings, theme } = useSettings();
  const font = useFont(DIGIT_FONT, DIGIT_FONT_SIZE);
  const [session, setSession] = useState<WorkSession | null>(null);
  const [broken, setBroken] = useState(false);
  const [initials, setInitials] = useState('');
  const [yearText, setYearText] = useState(String(new Date().getFullYear()));
  const [sign, setSign] = useState<Sign | null>(null);
  /** стежки подписи, когда открылась её канва */
  const [opened, setOpened] = useState<number[]>([]);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const api = useRef<CanvasApi | null>(null);

  useEffect(() => {
    let alive = true;
    void openWork(pattern, workId).then((s) => {
      if (!alive) return;
      if (!s) {
        setBroken(true);
        return;
      }
      setSession(s);
      if (s.sign) {
        setSign(s.sign);
        setOpened(s.sign.done);
        setInitials(s.sign.initials);
        setYearText(String(s.sign.year));
      }
    });
    return () => {
      alive = false;
    };
  }, [pattern, workId]);

  const look = workCanvas(session?.canvas, pattern);
  const letters = cleanInitials(initials);
  const year = Number(yearText) || new Date().getFullYear();
  const lines = letters ? signLines(letters, year, pattern.w) : null;
  // нить подписи — лучше всех видная на канве работы
  const thread = sign?.thread ?? signThread(pattern, clothRgb(look));
  // узор подписи на канве — один на инициалы, год и нить: стежки его не пересоздают (канва помнит их сама)
  const signKey = sign ? `${sign.initials}|${sign.year}|${sign.thread}` : '';
  const mini = useMemo(() => (sign ? signPattern(pattern, sign) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pattern, signKey]);
  const draft = useMemo(() => (letters && lines ? signPattern(pattern, { initials: letters, year, thread }) : null), [pattern, letters, lines, year, thread]);
  const preview = useMemo(() => (draft ? previewUri(draft, 'done', 240, undefined, true, clothRgb(look)) : null), [draft, look]);
  const total = mini ? mini.cells.reduce((n, c) => n + (c === 0 ? 1 : 0), 0) : 0;
  // вышитое на момент открытия канвы подписи: дальше канва помнит стежки сама
  const stitched = useMemo(() => {
    const st = new Uint8Array(mini ? mini.cells.length : 0);
    for (const i of opened) if (i < st.length) st[i] = 1;
    return st;
  }, [mini, opened]);
  const done = sign ? sign.done.length : 0;
  const finished = !!sign && total > 0 && done >= total;

  const start = () => {
    if (!session || !letters || !lines) return;
    const next: Sign = { initials: letters, year, thread, done: [] };
    setOpened([]);
    setSign(next);
    void session.setSign(next);
  };

  // штрих кисти: принимаются только клетки подписи; вышитые копит сессия (`stitchSign`) — у экрана подпись
  // может быть из прошлого кадра, а штрихи кисти приходят чаще
  const onStroke = (_t: number, cells: number[]) => {
    if (!session || !mini) return;
    const ours = cells.filter((c) => c >= 0 && c < mini.cells.length && mini.cells[c] === 0);
    if (!ours.length) return;
    const next = session.stitchSign(ours);
    if (next) setSign(next);
  };
  const tick = () => {
    if (settings.sound) play('stitch');
    if (settings.haptics && Platform.OS !== 'web') void Haptics.selectionAsync();
  };

  const field = fieldOf(look);
  return (
    <Screen title={T.sign.title} onBack={onBack}>
      {broken ? <Txt style={styles.pad}>{T.stitch.broken}</Txt> : !session ? <ActivityIndicator style={styles.pad} color={theme.accent} /> : !sign ? (
        // прокрутка: при открытой клавиатуре превью и «Вышивать подпись» — ниже, до них можно докрутить
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled" testID="sign-form">
          <Txt>{T.sign.note}</Txt>
          <View style={styles.row}>
            <Txt>{T.sign.initials}</Txt>
            <TextInput value={initials} onChangeText={setInitials} autoCapitalize="characters" maxLength={6} maxFontSizeMultiplier={FONT_MAX}
              testID="sign-initials" placeholder={T.sign.initialsHint} placeholderTextColor={theme.textDim}
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface, fontFamily: FONTS.body }]} />
            <Txt>{T.sign.year}</Txt>
            <TextInput value={yearText} onChangeText={(t) => setYearText(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={4} maxFontSizeMultiplier={FONT_MAX}
              testID="sign-year"
              style={[styles.input, styles.num, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface, fontFamily: FONTS.body }]} />
          </View>
          {initials && !letters ? <Txt dim style={styles.small}>{T.sign.lettersOnly}</Txt> : null}
          {letters && !lines ? <Txt dim style={styles.small} testID="sign-narrow">{T.sign.tooNarrow}</Txt> : null}
          {preview && draft ? (
            <View style={[styles.preview, { backgroundColor: theme.surfaceAlt }]}>
              <Image source={{ uri: preview }} style={{ width: Math.min(280, draft.w * 8), height: Math.min(280, draft.w * 8) * (draft.h / draft.w) }} resizeMode="contain" testID="sign-preview" />
            </View>
          ) : null}
          <Button label={T.sign.stitch} onPress={start} disabled={!lines} testID="sign-start" />
        </ScrollView>
      ) : (
        <View style={styles.body}>
          <View style={[styles.canvas, { backgroundColor: theme.dark ? field.dark : field.light }]} testID="sign-canvas"
            onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
            {size && font && mini ? (
              <StitchCanvas pattern={mini} stitched={stitched} selected={0} mosaic={settings.style === 'mosaic'} hatch={settings.highlight === 'hatch'}
                bigNumbers={settings.bigNumbers} fill={false} font={font} width={size.w} height={size.h} apiRef={api} dark={theme.dark}
                canvas={look} initial="open" onStroke={onStroke} onTick={tick} />
            ) : null}
          </View>
          <View style={styles.below}>
            <Txt testID="sign-progress">{finished ? T.sign.finished : T.sign.progress(done, total)}</Txt>
            {finished ? <Button label={T.sign.done} onPress={onDone} testID="sign-done" /> : null}
          </View>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { margin: 24 },
  form: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  input: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, minWidth: 72 },
  num: { width: 72, textAlign: 'center', paddingHorizontal: 6 },
  small: { fontSize: 13 },
  preview: { alignSelf: 'flex-start', padding: 12, borderRadius: 6 },
  body: { flex: 1 },
  canvas: { flex: 1, overflow: 'hidden' },
  below: { padding: 16, gap: 10 },
});

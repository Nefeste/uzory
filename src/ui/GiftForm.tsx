// «Подарить тайной» (0.23.0; владелец 01.11.2026, issue 145): подпись и записка — и файл тайны уходит в
// «Поделиться» (в вебе — скачивается). В файле — только узор, название, подпись и записка
// (src/engine/gift.ts), снимка нет. Подпись запоминается (src/state/gift.ts); текст приглашения для друга —
// своим «Поделиться» (в вебе — в буфер обмена).
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput } from 'react-native';
import { GIFT_FROM_MAX, GIFT_MIME, GIFT_NOTE_MAX, giftNote, makeGift } from '../engine/gift';
import type { Pattern } from '../engine/pattern';
import { T } from '../i18n';
import { copyText } from '../state/clip';
import { logError } from '../state/crashlog';
import { lastFrom, rememberFrom } from '../state/gift';
import { usePlayer } from '../state/player';
import { useSettings } from '../state/settings';
import { shareFile } from '../state/share';
import { Button, FONT_MAX, Screen, SectionTitle, Txt } from './components';
import { FONTS } from './theme';

/** Имя файла — без знаков, которых не любят файловые системы. */
const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

export function GiftForm({ pattern, title, onBack }: { pattern: Pattern; title: string; onBack: () => void }) {
  const { theme } = useSettings();
  const { today } = usePlayer();
  const [from, setFrom] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'noShare' | 'error'>('idle');
  const [invited, setInvited] = useState<boolean | null>(null);
  useEffect(() => {
    void lastFrom().then((f) => setFrom((cur) => cur || f));
  }, []);

  const send = async () => {
    setState('sending');
    try {
      const clean = giftNote(from, note);
      const bytes = makeGift(pattern, title, clean, today);
      if (clean.from) void rememberFrom(clean.from);
      const ok = await shareFile(bytes, fileSafe(T.gift.fileName(clean.from)), GIFT_MIME, T.gift.shareTitle);
      setState(ok ? 'sent' : 'noShare');
    } catch (e) {
      logError('gift', e, 'send');
      setState('error');
    }
  };
  const invite = async () => setInvited(await copyText(T.gift.invite(giftNote(from, undefined).from)));

  const input = [styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface, fontFamily: FONTS.body }];
  return (
    <Screen title={T.gift.title} onBack={onBack}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" testID="gift-form">
        <Txt>{T.gift.intro}</Txt>
        <Txt bold>{title}</Txt>
        <SectionTitle>{T.gift.from}</SectionTitle>
        <TextInput value={from} onChangeText={setFrom} maxLength={GIFT_FROM_MAX} maxFontSizeMultiplier={FONT_MAX} testID="gift-from"
          placeholder={T.gift.fromHint} placeholderTextColor={theme.textDim} style={input} />
        <SectionTitle>{T.gift.note}</SectionTitle>
        <TextInput value={note} onChangeText={setNote} maxLength={GIFT_NOTE_MAX} maxFontSizeMultiplier={FONT_MAX} testID="gift-note" multiline
          placeholder={T.gift.noteHint} placeholderTextColor={theme.textDim} style={[input, styles.note]} />
        <Button label={state === 'sending' ? T.gift.sending : T.gift.send} onPress={() => void send()} disabled={state === 'sending'} testID="gift-send" />
        {state === 'sent' ? <Txt testID="gift-sent">{T.gift.sent}</Txt> : null}
        {state === 'noShare' || state === 'error' ? <Txt style={{ color: theme.danger }}>{state === 'noShare' ? T.gift.noShare : T.gift.error}</Txt> : null}
        <Button kind="secondary" label={T.gift.inviteSend} onPress={() => void invite()} testID="gift-invite" />
        {invited !== null ? <Txt dim style={styles.small}>{invited ? T.gift.invited : T.gift.notInvited}</Txt> : null}
        <Txt dim style={styles.small}>{T.gift.privacy}</Txt>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 10 },
  input: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  note: { minHeight: 96, textAlignVertical: 'top' },
  small: { fontSize: 13 },
});

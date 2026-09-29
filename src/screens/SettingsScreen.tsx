// Настройки (docs/08-game-design.md, «Настройки»; docs/specs/2026-09-first-picture.md, «Основа
// приложения»): всё, что уже есть в игре. Чего ещё нет — музыки, «Узоры+», — здесь не видно:
// скрыто, а не выключено. «Перенос» — docs/specs/2026-09-plus.md, «Перенос».
import { useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import { BackupError, exportWorks, importWorks } from '../state/backup';
import { logError } from '../state/crashlog';
import { pickFile, PickTooBig } from '../state/pick';
import { usePlayer } from '../state/player';
import { type StitchStyle, useSettings } from '../state/settings';
import { shareFile } from '../state/share';
import { Button, Screen, SectionTitle, Segmented, ToggleRow, Txt } from '../ui/components';

/** Раздел «Узоры» политики студии (store/forms.md). */
export const PRIVACY_URL = 'https://gornitsa.games/privacy.html#uzory';

export function SettingsScreen({ onBack, onReport, onAbout }: { onBack: () => void; onReport: () => void; onAbout: () => void }) {
  const { settings, update, theme } = useSettings();
  const player = usePlayer();
  const [busy, setBusy] = useState<'save' | 'load' | null>(null);
  const [said, setSaid] = useState<{ text: string; bad?: boolean } | null>(null);

  const save = async () => {
    setBusy('save');
    setSaid(null);
    try {
      const f = await exportWorks(player.today);
      if (!f.works) setSaid({ text: T.settings.nothingToSave });
      else if (await shareFile(f.bytes, f.name, 'application/octet-stream', T.settings.save)) setSaid({ text: T.settings.saved(f.works) });
      else setSaid({ text: T.settings.transferFailed, bad: true });
    } catch (e) {
      logError('work', e, 'transfer save');
      setSaid({ text: T.settings.transferFailed, bad: true });
    } finally {
      setBusy(null);
    }
  };

  const load = async () => {
    setBusy('load');
    setSaid(null);
    try {
      const bytes = await pickFile();
      if (bytes) {
        const r = await importWorks(bytes);
        setSaid({ text: T.settings.loaded(r.added, r.mine, r.same, r.bad), bad: r.bad > 0 && !r.added });
      }
    } catch (e) {
      if (e instanceof BackupError || e instanceof PickTooBig) setSaid({ text: T.settings.notOurs, bad: true });
      else {
        logError('work', e, 'transfer load');
        setSaid({ text: T.settings.transferFailed, bad: true });
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen title={T.settings.title} onBack={onBack}>
      <ScrollView contentContainerStyle={styles.wrap} testID="settings">
        <SectionTitle>{T.settings.stitching}</SectionTitle>
        <View style={styles.block}>
          <Txt style={styles.label}>{T.settings.style}</Txt>
          <Segmented<StitchStyle> value={settings.style} onChange={(v) => update({ style: v })} testID="set-style"
            options={[{ id: 'cross', label: T.stitch.styles.cross }, { id: 'mosaic', label: T.stitch.styles.mosaic }]} />
          <Txt dim style={styles.note}>{T.settings.styleNote}</Txt>
        </View>
        <ToggleRow label={T.settings.bigNumbers} note={T.settings.bigNumbersNote} value={settings.bigNumbers}
          onChange={(v) => update({ bigNumbers: v })} testID="set-big" />
        <View style={styles.block}>
          <Txt style={styles.label}>{T.settings.highlight}</Txt>
          <Segmented value={settings.highlight} onChange={(v) => update({ highlight: v })} testID="set-highlight"
            options={[{ id: 'tint', label: T.settings.highlights.tint }, { id: 'hatch', label: T.settings.highlights.hatch }]} />
          <Txt dim style={styles.note}>{T.settings.highlightNote}</Txt>
        </View>
        <ToggleRow label={T.settings.fill} note={T.settings.fillNote} value={settings.fill}
          onChange={(v) => update({ fill: v })} testID="set-fill" />
        <ToggleRow label={T.settings.autoNext} note={T.settings.autoNextNote} value={settings.autoNext}
          onChange={(v) => update({ autoNext: v })} testID="set-next" />
        {/* включили снова — подсказки начинаются сначала: кто их включил, тот хочет их увидеть */}
        <ToggleRow label={T.settings.hints} note={T.settings.hintsNote} value={settings.hints} testID="set-hints"
          onChange={(v) => {
            update({ hints: v });
            if (v) player.update({ hints: [] });
          }} />
        <SectionTitle>{T.settings.feel}</SectionTitle>
        <ToggleRow label={T.settings.sound} note={T.settings.soundNote} value={settings.sound}
          onChange={(v) => update({ sound: v })} testID="set-sound" />
        {/* вибрации в браузере нет */}
        {Platform.OS !== 'web' ? (
          <ToggleRow label={T.settings.haptics} note={T.settings.hapticsNote} value={settings.haptics}
            onChange={(v) => update({ haptics: v })} testID="set-haptics" />
        ) : null}
        <SectionTitle>{T.settings.transfer}</SectionTitle>
        <Txt dim style={[styles.note, styles.lead]}>{T.settings.transferNote}</Txt>
        <View style={styles.buttons}>
          <Button kind="secondary" label={busy === 'save' ? T.settings.saving : T.settings.save} onPress={() => void save()}
            disabled={busy !== null} testID="set-save" />
          <Button kind="secondary" label={busy === 'load' ? T.settings.loading : T.settings.load} onPress={() => void load()}
            disabled={busy !== null} testID="set-load" />
          {said ? <Txt style={said.bad ? { color: theme.danger } : undefined} testID="set-transfer-said">{said.text}</Txt> : null}
        </View>
        <SectionTitle>{T.settings.help}</SectionTitle>
        <View style={styles.buttons}>
          <Button kind="secondary" label={T.report.button} onPress={onReport} testID="set-report" />
          <Button kind="secondary" label={T.settings.privacy} onPress={() => void Linking.openURL(PRIVACY_URL).catch(() => undefined)} testID="set-privacy" />
          <Button kind="secondary" label={T.settings.about} onPress={onAbout} testID="set-about" />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, paddingBottom: 40 },
  block: { paddingVertical: 10, gap: 8 },
  label: { fontSize: 16 },
  note: { fontSize: 13, lineHeight: 18 },
  lead: { marginBottom: 10 },
  buttons: { gap: 10 },
});

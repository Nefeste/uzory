// из votchina: src/ui/dialog.tsx @ f35a9a5 — изменено: только сообщение с одной кнопкой «Хорошо» (больше «Узорам» пока
// не нужно), цвета и кнопки — из своего src/ui/components.tsx.
// Окно сообщения в виде игры. Системный Alert из React Native устав запрещает: в веб-сборке он не работает
// (docs/05-rules.md устава, «Код»).
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '../i18n';
import { useSettings } from '../state/settings';
import { Button, Txt } from './components';

export interface Notice {
  title: string;
  text?: string;
}

export function Dialog({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  const { theme } = useSettings();
  const insets = useSafeAreaInsets();
  if (!notice) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.center} pointerEvents="box-none">
        <View style={[styles.box, { backgroundColor: theme.surface, borderColor: theme.border, marginBottom: insets.bottom }]} testID="dialog">
          <Txt title style={styles.title}>{notice.title}</Txt>
          {notice.text ? <Txt dim style={styles.text}>{notice.text}</Txt> : null}
          <View style={styles.actions}>
            <Button label={T.common.ok} onPress={onClose} testID="dialog-ok" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.4)' },
  center: { flex: 1, justifyContent: 'center', padding: 22 },
  box: { width: '100%', maxWidth: 480, alignSelf: 'center', borderRadius: 18, borderWidth: 1, padding: 18, gap: 8, elevation: 6 },
  title: { fontSize: 19 },
  text: { fontSize: 14, lineHeight: 20 },
  actions: { gap: 8, marginTop: 8 },
});

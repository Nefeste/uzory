// Заглушка «Скоро» (docs/specs/2026-09-first-picture.md, «Основа приложения»): «Библиотека»,
// «Мои работы» и «Календарь» есть на главной с 0.2, а экраны приходят со следующим этапом
// (docs/specs/2026-09-library.md).
import { StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import { Button, Screen, Txt } from '../ui/components';

export function SoonScreen({ title, onBack, onSheet }: { title: string; onBack: () => void; onSheet: () => void }) {
  return (
    <Screen title={title} onBack={onBack}>
      <View style={styles.wrap} testID="soon">
        <Txt style={styles.text}>{T.soon.text}</Txt>
        <Button kind="secondary" label={T.home.sheet} onPress={onSheet} testID="soon-sheet" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 20, gap: 16 },
  text: { fontSize: 16, lineHeight: 23 },
});

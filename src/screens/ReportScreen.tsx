// «Сообщить об ошибке» (docs/specs/2026-09-first-picture.md, «Основа приложения»): игрок
// видит отчёт целиком и отправляет сам — через «Поделиться».
import { useEffect, useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet } from 'react-native';
import { T } from '../i18n';
import { readCrashlog } from '../state/crashlog';
import { buildReport } from '../state/report';
import { APP_BUILD, APP_VERSION } from '../version';
import { Button, Card, Screen, Txt } from '../ui/components';

export function ReportScreen({ from, onBack }: { from: string; onBack: () => void }) {
  const [text, setText] = useState('');

  useEffect(() => {
    void readCrashlog().then((log) => setText(buildReport({
      what: '',
      version: APP_VERSION,
      build: APP_BUILD,
      device: `${Platform.OS} ${String(Platform.Version)}`,
      screen: from,
      log,
      labels: T.report.labels,
    })));
  }, [from]);

  return (
    <Screen title={T.report.button} onBack={onBack}>
      <ScrollView contentContainerStyle={styles.body}>
        <Txt dim>{T.report.intro}</Txt>
        <Card><Txt selectable style={styles.text} testID="report-text">{text}</Txt></Card>
        <Button label={T.report.share} onPress={() => void Share.share({ message: text, title: T.report.subject(APP_VERSION) })} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12 },
  text: { fontSize: 13, lineHeight: 19 },
});

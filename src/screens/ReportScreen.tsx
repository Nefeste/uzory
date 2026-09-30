// «Сообщить об ошибке» (docs/specs/2026-09-first-picture.md, «Основа приложения»): игрок
// видит отчёт целиком и отправляет сам — через «Поделиться».
import { useEffect, useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet } from 'react-native';
import { sessionTotals } from '../engine/sessions';
import { T } from '../i18n';
import { readCrashlog } from '../state/crashlog';
import { buildReport } from '../state/report';
import { readSessions } from '../state/sessions';
import { loadIndex } from '../state/works';
import { APP_BUILD, APP_VERSION } from '../version';
import { Button, Card, Screen, Txt } from '../ui/components';

export function ReportScreen({ from, onBack }: { from: string; onBack: () => void }) {
  const [text, setText] = useState('');

  useEffect(() => {
    let alive = true;
    void Promise.all([readCrashlog(), readSessions(), loadIndex()]).then(([log, s, works]) => {
      if (!alive) return;
      setText(buildReport({
        what: '',
        version: APP_VERSION,
        build: APP_BUILD,
        device: `${Platform.OS} ${String(Platform.Version)}`,
        screen: from,
        sessions: s ? { since: s.since, ...sessionTotals(s) } : null,
        finished: works.filter((w) => w.finished).length,
        log,
        labels: T.report.labels,
      }));
    });
    return () => {
      alive = false;
    };
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

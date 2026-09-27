// из votchina: src/ui/ErrorBoundary.tsx @ 1242776
// Граница ошибок (перенос из «Вотчины»): упавший экран заменяется честным «Что-то пошло
// не так» с «Сообщить об ошибке», а не белым экраном.
import { Component, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { T } from '../i18n';
import { logError } from '../state/crashlog';
import { Button, Screen, Txt } from './components';

interface Props { children: ReactNode; onHome: () => void; onReport: () => void }

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  private home = () => {
    this.setState({ failed: false });
    this.props.onHome();
  };

  private report = () => {
    this.setState({ failed: false });
    this.props.onReport();
  };

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    const where = (info.componentStack ?? '').split('\n').filter(Boolean).slice(0, 4).map((s) => s.trim()).join(' < ');
    logError('render', error, where);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Screen title={T.report.crashTitle}>
        <View style={styles.wrap} testID="crash-screen">
          <Txt style={styles.text}>{T.report.crashText}</Txt>
          <Button label={T.report.button} onPress={this.report} style={styles.btn} />
          <Button kind="secondary" label={T.report.crashHome} onPress={this.home} style={styles.btn} />
        </View>
      </Screen>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { padding: 20 },
  text: { fontSize: 16, lineHeight: 23 },
  btn: { marginTop: 12 },
});

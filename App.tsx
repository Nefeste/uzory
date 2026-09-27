// «Узоры» — корень: шрифты, настройки и экраны, переключаемые состоянием, без роутера
// (ADR 0003). Кнопку «назад» Android обрабатывает сам корень.
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { PackPicture } from './src/engine/pack';
import type { Pattern } from './src/engine/pattern';
import { installCrashHandlers } from './src/state/crashlog';
import { patternOf } from './src/state/library';
import { SettingsProvider, useSettings } from './src/state/settings';
import { BenchScreen } from './src/screens/BenchScreen';
import { DoneScreen } from './src/screens/DoneScreen';
import { FileScreen } from './src/screens/FileScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ReportScreen } from './src/screens/ReportScreen';
import { SheetScreen } from './src/screens/SheetScreen';
import { StitchScreen } from './src/screens/StitchScreen';
import { ErrorBoundary } from './src/ui/ErrorBoundary';
import { FONT_FILES } from './src/ui/fonts';

installCrashHandlers();

type Route =
  | { name: 'home' }
  | { name: 'stitch'; pic: PackPicture; workId?: string }
  | { name: 'done'; pattern: Pattern; title: string; caption?: string; workId: string }
  | { name: 'sheet' }
  | { name: 'bench' }
  | { name: 'file' }
  | { name: 'report'; from: string };

const caption = (pic: PackPicture) => [pic.author?.name, pic.made].filter(Boolean).join(', ') || undefined;

function Root() {
  const { theme } = useSettings();
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const route = stack[stack.length - 1];
  const go = (r: Route) => setStack((s) => [...s, r]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const home = () => setStack([{ name: 'home' }]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length <= 1) return false;
      back();
      return true;
    });
    return () => sub.remove();
  }, [stack.length]);

  let screen: React.ReactNode;
  switch (route.name) {
    case 'home':
      screen = (
        <HomeScreen
          onStitch={(pic, workId) => go({ name: 'stitch', pic, workId })}
          onSheet={() => go({ name: 'sheet' })}
          onBench={() => go({ name: 'bench' })}
          onFile={() => go({ name: 'file' })}
          onReport={() => go({ name: 'report', from: 'home' })}
        />
      );
      break;
    case 'stitch': {
      const pattern = patternOf(route.pic);
      screen = (
        <StitchScreen
          key={`${route.pic.id}-${route.workId ?? 'new'}`}
          pattern={pattern} title={route.pic.title} workId={route.workId} onBack={back}
          onDone={(workId) => setStack((s) => [...s.slice(0, -1), { name: 'done', pattern, title: route.pic.title, caption: caption(route.pic), workId }])}
        />
      );
      break;
    }
    case 'done':
      screen = <DoneScreen pattern={route.pattern} title={route.title} caption={route.caption} workId={route.workId} onNext={home} />;
      break;
    case 'sheet':
      screen = <SheetScreen onBack={back} onOpen={(pic) => go({ name: 'stitch', pic })} />;
      break;
    case 'bench':
      screen = <BenchScreen onBack={back} />;
      break;
    case 'file':
      screen = <FileScreen onBack={back} onReplay={(pattern, workId) => go({ name: 'done', pattern, title: pattern.key, workId })} />;
      break;
    case 'report':
      screen = <ReportScreen from={route.from} onBack={back} />;
      break;
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <ErrorBoundary onHome={home} onReport={() => go({ name: 'report', from: `crash:${route.name}` })}>
        {screen}
      </ErrorBoundary>
    </View>
  );
}

export default function App() {
  const [fonts] = useFonts(FONT_FILES);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SettingsProvider>
          {fonts ? <Root /> : <View style={{ flex: 1, backgroundColor: '#ECEDE6', justifyContent: 'center' }}><ActivityIndicator color="#B3162F" /></View>}
        </SettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// «Узоры» — корень: шрифты, настройки, игрок и экраны, переключаемые состоянием, без роутера
// (ADR 0003). Кнопку «назад» Android обрабатывает сам корень.
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { CollectionId } from './src/engine/library';
import type { PackPicture } from './src/engine/pack';
import type { Pattern } from './src/engine/pattern';
import { installCrashHandlers } from './src/state/crashlog';
import { FIRST_PICTURE, patternOf } from './src/state/library';
import { useNetReady } from './src/state/net';
import { PlayerProvider, usePlayer } from './src/state/player';
import { billing } from './src/state/billing';
import { PlusProvider } from './src/state/plus';
import { DEFAULT_SETTINGS, SettingsProvider, useSettings } from './src/state/settings';
import { AboutScreen } from './src/screens/AboutScreen';
import { BenchScreen } from './src/screens/BenchScreen';
import { CalendarScreen } from './src/screens/CalendarScreen';
import { CollectionScreen } from './src/screens/CollectionScreen';
import { DoneScreen } from './src/screens/DoneScreen';
import { FileScreen } from './src/screens/FileScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { MineScreen } from './src/screens/MineScreen';
import { PictureScreen } from './src/screens/PictureScreen';
import { PlusScreen } from './src/screens/PlusScreen';
import { ReportScreen } from './src/screens/ReportScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SheetScreen } from './src/screens/SheetScreen';
import { StitchScreen } from './src/screens/StitchScreen';
import { WorksScreen } from './src/screens/WorksScreen';
import { ErrorBoundary } from './src/ui/ErrorBoundary';
import { FONT_FILES } from './src/ui/fonts';
import { whoMade } from './src/ui/PicAbout';

installCrashHandlers();

type Route =
  | { name: 'home' }
  | { name: 'stitch'; pic: PackPicture; workId?: string }
  | { name: 'stitchMine'; pattern: Pattern; title: string; workId?: string }
  | { name: 'mine' }
  | { name: 'done'; pattern: Pattern; title: string; caption?: string; workId: string; pic?: PackPicture }
  | { name: 'sheet' }
  | { name: 'bench' }
  | { name: 'file' }
  | { name: 'settings' }
  | { name: 'about' }
  | { name: 'library' }
  | { name: 'collection'; id: CollectionId }
  | { name: 'picture'; pic: PackPicture }
  | { name: 'works' }
  | { name: 'calendar' }
  | { name: 'plus'; sample: boolean }
  | { name: 'report'; from: string };

/** Экран в стеке: `k` — свой ключ, чтобы два одинаковых экрана подряд не делили состояние. */
type Entry = Route & { k: number };

let nextKey = 1;
const entry = (r: Route): Entry => ({ ...r, k: nextKey++ });

const caption = (pic: PackPicture) => whoMade(pic) || undefined;

function Root() {
  const { theme, update } = useSettings();
  const player = usePlayer();
  const [stack, setStack] = useState<Entry[]>(() => [entry({ name: 'home' })]);
  const route = stack[stack.length - 1];
  const go = (r: Route) => setStack((s) => [...s, entry(r)]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const home = () => setStack([entry({ name: 'home' })]);
  /** «Узоры+»: с магазином — настоящий экран, без него (сборка 0.x для проверки) — образец. */
  const plus = () => go({ name: 'plus', sample: !billing.available });
  /** Поменять данные экрана на вершине, не пересоздавая его. */
  const patch = (k: number, p: Partial<Route>) => setStack((s) => s.map((e) => (e.k === k ? ({ ...e, ...p } as Entry) : e)));

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
          onSettings={() => go({ name: 'settings' })}
          onLibrary={() => go({ name: 'library' })}
          onWorks={() => go({ name: 'works' })}
          onCalendar={() => go({ name: 'calendar' })}
          onSheet={() => go({ name: 'sheet' })}
          onBench={() => go({ name: 'bench' })}
          onFile={() => go({ name: 'file' })}
          onMine={() => go({ name: 'mine' })}
          onPlusSample={() => go({ name: 'plus', sample: true })}
        />
      );
      break;
    case 'mine':
      screen = <MineScreen onBack={back} owner onStitch={(pattern, title, workId) => go({ name: 'stitchMine', pattern, title, workId })} />;
      break;
    case 'stitchMine':
      screen = (
        <StitchScreen
          pattern={route.pattern} title={route.title} workId={route.workId} onBack={back}
          onStarted={(workId) => patch(route.k, { workId })}
          onSettings={() => go({ name: 'settings' })}
          onDone={(workId) => setStack((s) => [...s.slice(0, -1), entry({ name: 'done', pattern: route.pattern, title: route.title, workId })])}
        />
      );
      break;
    case 'stitch': {
      const { pic } = route;
      const pattern = patternOf(pic);
      screen = (
        <StitchScreen
          pattern={pattern} title={pic.title} workId={route.workId} onBack={back}
          pic={pic}
          onStarted={(workId) => patch(route.k, { workId })}
          onSettings={() => go({ name: 'settings' })}
          onDone={(workId) => {
            // первая картинка вышита — на главной с этих пор картинка дня
            if (pic.id === FIRST_PICTURE) player.update({ firstDone: true });
            setStack((s) => [...s.slice(0, -1), entry({ name: 'done', pattern, title: pic.title, caption: caption(pic), workId, pic })]);
          }}
        />
      );
      break;
    }
    case 'done': {
      const { pic } = route;
      screen = (
        <DoneScreen pattern={route.pattern} title={route.title} caption={route.caption} workId={route.workId} pic={pic}
          onNext={(next) => (next ? setStack([entry({ name: 'home' }), entry({ name: 'picture', pic: next })]) : home())}
          onPlus={plus} />
      );
      break;
    }
    case 'sheet':
      screen = <SheetScreen onBack={back} onOpen={(pic, workId) => go({ name: 'stitch', pic, workId })} />;
      break;
    case 'bench':
      screen = <BenchScreen onBack={back} />;
      break;
    case 'file':
      screen = <FileScreen onBack={back} onReplay={(pattern, workId) => go({ name: 'done', pattern, title: pattern.key, workId })} />;
      break;
    case 'settings':
      screen = <SettingsScreen onBack={back} onReport={() => go({ name: 'report', from: 'settings' })} onAbout={() => go({ name: 'about' })} onPlus={plus} />;
      break;
    case 'about':
      screen = <AboutScreen onBack={back} />;
      break;
    case 'library':
      screen = <LibraryScreen onBack={back} onOpen={(pic) => go({ name: 'picture', pic })} onCollection={(id) => go({ name: 'collection', id })} />;
      break;
    case 'collection':
      screen = <CollectionScreen id={route.id} onBack={back} onOpen={(pic) => go({ name: 'picture', pic })} />;
      break;
    case 'picture':
      screen = <PictureScreen pic={route.pic} onBack={back} onStitch={(pic, workId) => go({ name: 'stitch', pic, workId })} onPlus={plus} />;
      break;
    case 'works':
      screen = <WorksScreen onBack={back} onOpen={(pic, workId) => go(workId ? { name: 'stitch', pic, workId } : { name: 'picture', pic })} />;
      break;
    case 'calendar':
      screen = <CalendarScreen onBack={back} onOpen={(pic) => go({ name: 'picture', pic })} />;
      break;
    case 'plus':
      screen = <PlusScreen sample={route.sample} onBack={back} />;
      break;
    case 'report':
      screen = <ReportScreen from={route.from} onBack={back} />;
      break;
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <ErrorBoundary onHome={home} onReport={() => go({ name: 'report', from: `crash:${route.name}` })}
        onRestart={() => {
          // «Начать заново» (docs/specs/2026-09-first-picture.md, «Неудачные случаи»): настройки
          // и подсказки — как при первом запуске; работы, день установки и картинки дня не трогаются
          update(DEFAULT_SETTINGS);
          player.update({ hints: [] });
          home();
        }}>
        <View key={route.k} style={{ flex: 1 }}>{screen}</View>
      </ErrorBoundary>
    </View>
  );
}

/** Скачанные наборы — в библиотеке до первого экрана (src/state/net.ts). */
function Gate() {
  return useNetReady() ? <Root /> : <Splash />;
}

function Splash() {
  return <View style={{ flex: 1, backgroundColor: '#ECEDE6', justifyContent: 'center' }}><ActivityIndicator color="#B3162F" /></View>;
}

export default function App() {
  const [fonts] = useFonts(FONT_FILES);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SettingsProvider>
          <PlayerProvider>
            <PlusProvider>
              {fonts ? <Gate /> : <Splash />}
            </PlusProvider>
          </PlayerProvider>
        </SettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

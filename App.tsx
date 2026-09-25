import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './global.css';
import { runDbSmoke, type SmokeResult } from './src/dev/smokeDb';
import { database } from './src/data';
import { makeDbActions } from './src/data/actions';
import { Navigator, type Route } from './src/ui/navigation';
import { HomeScreen } from './src/ui/screens/HomeScreen';
import { ExerciseListScreen } from './src/ui/screens/ExerciseListScreen';
import { ExerciseEditorScreen } from './src/ui/screens/ExerciseEditorScreen';
import { RoutineListScreen } from './src/ui/screens/RoutineListScreen';
import { RoutineEditorScreen } from './src/ui/screens/RoutineEditorScreen';
import { WorkoutScreen } from './src/ui/screens/WorkoutScreen';
import { HistoryListScreen } from './src/ui/screens/HistoryListScreen';
import { HistoryDetailScreen } from './src/ui/screens/HistoryDetailScreen';
import { CompareScreen } from './src/ui/screens/CompareScreen';
import { PortabilityScreen } from './src/ui/screens/PortabilityScreen';
import { LoadScreen } from './src/ui/screens/LoadScreen';
import { MuscleScreen } from './src/ui/screens/MuscleScreen';
import { RecordsScreen } from './src/ui/screens/RecordsScreen';
import { InventoryScreen } from './src/ui/screens/InventoryScreen';
import { ReadinessScreen } from './src/ui/screens/ReadinessScreen';
import { TrustScreen } from './src/ui/screens/TrustScreen';
import { parseImportDeepLink } from './src/portability/encoding';
import { setPendingDeepLink } from './src/portability/pendingDeepLink';

function renderRoute(route: Route) {
  switch (route.name) {
    case 'home':
      return <HomeScreen />;
    case 'exercises':
      return <ExerciseListScreen />;
    case 'exerciseEditor':
      return <ExerciseEditorScreen exerciseId={route.exerciseId} />;
    case 'routines':
      return <RoutineListScreen />;
    case 'routineEditor':
      return <RoutineEditorScreen routineId={route.routineId} />;
    case 'workout':
      return <WorkoutScreen />;
    case 'history':
      return <HistoryListScreen />;
    case 'historyDetail':
      return <HistoryDetailScreen sessionId={route.sessionId} />;
    case 'compare':
      return <CompareScreen sessionId={route.sessionId} />;
    case 'portability':
      return <PortabilityScreen />;
    case 'importPreview':
      return <PortabilityScreen />;
    case 'load':
      return <LoadScreen />;
    case 'muscles':
      return <MuscleScreen />;
    case 'records':
      return <RecordsScreen />;
    case 'inventory':
      return <InventoryScreen />;
    case 'readiness':
      return <ReadinessScreen />;
    case 'trust':
      return <TrustScreen />;
    default:
      return <HomeScreen />;
  }
}

export default function App() {
  const [smoke, setSmoke] = useState<SmokeResult | null>(null);

  useEffect(() => {
    // Starter exercises are intentionally seeded once on first launch (Day 1 design).
    makeDbActions(database)
      .seedExercisesIfEmpty()
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Deep links: data transport only — never auto-import. Payload is stashed
    // for PortabilityScreen preview; user must confirm before any DB write.
    const onUrl = (url: string | null | undefined) => {
      if (!url) return;
      const parsed = parseImportDeepLink(url);
      if (parsed.ok) setPendingDeepLink(parsed.encoded);
    };
    Linking.getInitialURL().then(onUrl).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => onUrl(e.url));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // On-device DB smoke is a development tool only. Production releases must NOT
    // run it automatically — it is gated behind __DEV__ (see docs/DECISIONS.md).
    if (!__DEV__) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    timer = setTimeout(() => {
      runDbSmoke().then((r) => {
        if (!cancelled) setSmoke(r);
      });
    }, 300);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <SafeAreaProvider>
      <View className={`flex-1 ${__DEV__ && smoke && !smoke.ok ? 'bg-danger/10' : 'bg-bg'}`}>
        <Navigator>{renderRoute}</Navigator>
      </View>
    </SafeAreaProvider>
  );
}

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './global.css';
import { runDbSmoke, type SmokeResult } from './src/dev/smokeDb';
import { database } from './src/data';
import { makeDbActions } from './src/data/actions';
import { Navigator, type Route } from './src/ui/navigation';
import { HomeScreen } from './src/ui/screens/HomeScreen';
import { ExerciseListScreen } from './src/ui/screens/ExerciseListScreen';
import { ExerciseEditorScreen } from './src/ui/screens/ExerciseEditorScreen';

function renderRoute(route: Route) {
  switch (route.name) {
    case 'home':
      return <HomeScreen />;
    case 'exercises':
      return <ExerciseListScreen />;
    case 'exerciseEditor':
      return <ExerciseEditorScreen exerciseId={route.exerciseId} />;
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

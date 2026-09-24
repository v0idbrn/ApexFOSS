import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import './global.css';
import { strings } from './src/constants/strings';
import { runDbSmoke, type SmokeResult } from './src/dev/smokeDb';

export default function App() {
  const [result, setResult] = useState<SmokeResult | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      runDbSmoke().then(setResult);
    }, 300);
    return () => clearTimeout(t);
  }, []);

  return (
    <View className={`flex-1 ${result && !result.ok ? 'bg-danger/10' : 'bg-bg'}`}>
      <ScrollView contentContainerClassName="flex-grow items-center justify-center px-4">
        <Text className="text-2xl font-bold text-fg">{strings.common.appName}</Text>
        <Text className={`mt-2 ${result ? (result.ok ? 'text-success' : 'text-danger') : 'text-dim'}`}>
          {!result ? 'DB smoke: running…' : result.ok ? 'DB smoke: ALL PASS ✅ (JSI + SQLite real)' : 'DB smoke: FAILED ❌'}
        </Text>
        {result && !result.ok && (
          <View className="mt-4 w-full rounded-lg border border-line bg-surface p-3">
            {result.lines.map((line, i) => (
              <Text key={i} className="font-mono text-xs text-dim">
                {line}
              </Text>
            ))}
            <Text className="mt-2 text-xs text-dim">Full details in logcat: [SMOKE]</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

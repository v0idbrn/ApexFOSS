import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { makeDbActions } from '../../data/actions';
import { strings } from '../../constants/strings';
import {
  TAP_TEST_DURATION_MS,
  computeBaseline,
  scoreReadiness,
  validateTapSession,
  type ReadinessBaseline,
  type ReadinessScore,
} from '../../analytics/readiness';
import { useNav } from '../navigation';
import { AppHeader, Button, Card, ErrorState, LoadingState, Screen, SectionHeader } from '../components';

interface TestRow {
  id: string;
  testedAt: number;
  durationMs: number;
  tapCount: number;
}

function formatWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return String(ts);
  }
}

export function ReadinessScreen() {
  const { pop } = useNav();
  const [tests, setTests] = useState<TestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastScore, setLastScore] = useState<ReadinessScore | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const startedAtRef = useRef(0);
  const tapCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await makeDbActions(database).listReadinessTests(50);
      setTests(
        rows.map((r) => ({
          id: r.id,
          testedAt: r.testedAt,
          durationMs: r.durationMs,
          tapCount: r.tapCount,
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const baseline: ReadinessBaseline | null = computeBaseline(tests);

  const finish = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRunning(false);
    const now = Date.now();
    const durationMs = now - startedAtRef.current;
    const count = tapCountRef.current;
    const invalid = validateTapSession(durationMs, count, now);
    if (invalid) {
      setStatus(strings.readiness.failed);
      return;
    }
    try {
      await makeDbActions(database).createReadinessTest({
        testedAt: now,
        durationMs: TAP_TEST_DURATION_MS,
        tapCount: count,
      });
      setStatus(strings.readiness.completed);
      const prior = await makeDbActions(database).listReadinessTests(50);
      const rows: TestRow[] = prior.map((r) => ({
        id: r.id,
        testedAt: r.testedAt,
        durationMs: r.durationMs,
        tapCount: r.tapCount,
      }));
      setTests(rows);
      // Score against baseline that EXCLUDED this test.
      const base = computeBaseline(rows.filter((r) => r.testedAt < now));
      setLastScore(scoreReadiness(count, base));
    } catch {
      setStatus(strings.readiness.failed);
    }
  }, []);

  const start = () => {
    tapCountRef.current = 0;
    startedAtRef.current = Date.now();
    setTapCount(0);
    setElapsedMs(0);
    setLastScore(null);
    setStatus(null);
    setRunning(true);
    timerRef.current = setInterval(() => {
      const e = Date.now() - startedAtRef.current;
      if (e >= TAP_TEST_DURATION_MS) {
        setElapsedMs(TAP_TEST_DURATION_MS);
        void finish();
      } else {
        setElapsedMs(e);
      }
    }, 50);
  };

  const onTap = () => {
    if (!running) return;
    tapCountRef.current += 1;
    setTapCount(tapCountRef.current);
  };

  if (loading) {
    return (
      <Screen>
        <AppHeader title={strings.readiness.title} onBack={pop} />
        <LoadingState />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <AppHeader title={strings.readiness.title} onBack={pop} />
        <ErrorState message={error} onRetry={reload} />
      </Screen>
    );
  }

  const remaining = Math.max(0, TAP_TEST_DURATION_MS - elapsedMs);
  const remainingS = Math.ceil(remaining / 1000);

  return (
    <Screen>
      <AppHeader title={strings.readiness.title} onBack={pop} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="px-4 pt-4">
          <Card>
            <Text className="text-sm text-dim">{strings.readiness.instructions}</Text>
            <View className="mt-3 flex-row gap-4">
              <View className="flex-1">
                <Text className="text-xs uppercase tracking-wider text-dim">{strings.readiness.taps}</Text>
                <Text className="text-3xl font-bold text-fg">{tapCount}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-xs uppercase tracking-wider text-dim">{strings.readiness.elapsed}</Text>
                <Text className="text-3xl font-bold text-fg">{running ? `${remainingS}s` : '—'}</Text>
              </View>
            </View>
            {running ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={strings.readiness.tapping}
                onPress={onTap}
                className="mt-4 h-32 min-h-32 items-center justify-center rounded-xl border-2 border-accent bg-accent/15"
              >
                <Text className="text-3xl font-black text-accent">{strings.readiness.tapping}</Text>
              </Pressable>
            ) : (
              <Button label={strings.readiness.start} onPress={start} className="mt-4" />
            )}
            {status ? <Text className="mt-2 text-sm text-dim">{status}</Text> : null}
          </Card>
        </View>

        <View className="px-4 pt-4">
          <SectionHeader title={strings.readiness.score} />
          <Card>
            {lastScore ? (
              <>
                <Text className="text-4xl font-bold text-fg">
                  {lastScore.score}
                  <Text className="text-lg text-dim">{strings.readiness.scoreUnit}</Text>
                </Text>
                <Text className="mt-1 text-sm text-dim">
                  {strings.readiness.baseline}: {lastScore.baselineMedian} · {strings.readiness.deviation}:{' '}
                  {lastScore.deviationPct >= 0 ? '+' : ''}
                  {lastScore.deviationPct}%
                </Text>
              </>
            ) : (
              <Text className="text-sm text-dim">{strings.readiness.noBaseline}</Text>
            )}
            <Text className="mt-2 text-xs text-dim">
              {strings.readiness.baseline}:{' '}
              {baseline
                ? `${baseline.medianTapCount} (${baseline.sampleCount} ${strings.readiness.samples})`
                : strings.readiness.insufficient}
            </Text>
          </Card>
        </View>

        <View className="px-4 pt-4">
          <SectionHeader title={strings.readiness.history} />
          {tests.length === 0 ? (
            <Text className="text-sm text-dim">{strings.readiness.insufficient}</Text>
          ) : (
            tests.map((t) => (
              <Card key={t.id} className="mb-2">
                <Text className="text-sm text-fg">
                  {t.tapCount} taps · {formatWhen(t.testedAt)}
                </Text>
              </Card>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

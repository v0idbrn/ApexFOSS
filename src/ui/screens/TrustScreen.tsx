import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { strings } from '../../constants/strings';
import { countLocalData, deleteAllLocalData, type LocalDataCounts } from '../../data/deletion';
import { useNav } from '../navigation';
import { AppHeader, Button, Screen, SectionHeader, confirmDestructive } from '../components';

/**
 * Trust, Safety & Legal center (spec section 19).
 * Fully offline: plain RN text/cards, no WebView, no network, no analytics.
 * Canonical six-color palette only (D-032).
 */

function InfoCard({ title, body, testID }: { title: string; body: string; testID?: string }) {
  return (
    <View className="mb-4" testID={testID}>
      <Text className="mb-1.5 text-sm font-semibold text-accent-ink">{title}</Text>
      <Text className="text-sm leading-5 text-dim">{body}</Text>
    </View>
  );
}

function CountRow({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text className="text-sm text-dim">{label}</Text>
      <Text className="text-sm font-semibold text-fg" testID={`count-${label}`}>
        {value}
      </Text>
    </View>
  );
}

export function TrustScreen() {
  const { pop } = useNav();
  const [counts, setCounts] = useState<LocalDataCounts | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    try {
      setCounts(await countLocalData(database));
    } catch {
      setCounts(null);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onDeleteAll = useCallback(() => {
    confirmDestructive(strings.trust.deleteAllConfirm, () => {
      void (async () => {
        try {
          await deleteAllLocalData(database);
          setStatus(strings.trust.deleteAllDone);
          setFailed(false);
          await reload();
        } catch {
          setStatus(null);
          setFailed(true);
        }
      })();
    });
  }, [reload]);

  return (
    <Screen>
      <AppHeader title={strings.trust.title} onBack={pop} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} className="flex-1 px-4">
        <SectionHeader title={strings.trust.dataStorage} />
        <View className="mb-4 rounded-xl border border-accent-muted bg-surface p-4" testID="trust-data-card">
          <Text className="mb-2 text-sm text-dim">{strings.trust.dataBody}</Text>
          <View testID="trust-counts" className="mb-3 border-b border-line pb-2">
            <CountRow label={strings.trust.countExercises} value={counts?.exercises ?? 0} />
            <CountRow label={strings.trust.countRoutines} value={counts?.routines ?? 0} />
            <CountRow label={strings.trust.countSessions} value={counts?.sessions ?? 0} />
            <CountRow label={strings.trust.countReadiness} value={counts?.readinessTests ?? 0} />
          </View>
          <Text className="mb-2 text-sm text-dim">{strings.trust.deleteAllBody}</Text>
          <Button
            label={strings.trust.deleteAll}
            variant="danger"
            onPress={onDeleteAll}
            className="self-start"
          />
          <Text className="mt-2 text-xs text-dim">{strings.trust.reseedNote}</Text>
          {status ? (
            <Text className="mt-2 text-sm text-accent-ink" testID="trust-status">
              {status}
            </Text>
          ) : null}
          {failed ? (
            <Text className="mt-2 text-sm text-danger" testID="trust-error">
              {strings.trust.deleteAllFailed}
            </Text>
          ) : null}
        </View>

        <SectionHeader title={strings.trust.title} />
        <InfoCard title={strings.trust.privacy} body={strings.trust.privacyBody} testID="trust-privacy" />
        <InfoCard title={strings.trust.terms} body={strings.trust.termsBody} testID="trust-terms" />
        <InfoCard title={strings.trust.health} body={strings.trust.healthBody} testID="trust-health" />
        <InfoCard title={strings.trust.security} body={strings.trust.securityBody} testID="trust-security" />
        <InfoCard title={strings.trust.limitations} body={strings.trust.limitationsBody} testID="trust-limitations" />
        <InfoCard title={strings.trust.licenses} body={strings.trust.licensesBody} testID="trust-licenses" />
        <InfoCard title={strings.trust.about} body={strings.trust.aboutBody} testID="trust-about" />
      </ScrollView>
    </Screen>
  );
}

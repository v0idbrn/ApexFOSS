import { useCallback } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { strings, type Locale } from '../../constants/strings';
import { GITHUB_SPONSORS_URL, MERCADOPAGO_URL, PAYPAL_URL } from '../../constants/support';
import { useLocale, useLocaleStore } from '../../state/localeStore';
import { useNav } from '../navigation';
import { ListRow, Screen, SectionHeader } from '../components';
import { Enter } from '../motion';

/**
 * More hub (Phase 2L tab 5): low-frequency functionality — exercise
 * library, equipment inventory, readiness, backup, language, Trust.
 * Training-critical surfaces stay out of here by design.
 */
export function MoreScreen() {
  const { push } = useNav();
  const locale = useLocale();
  const setLocale = useLocaleStore((s) => s.setLocale);

  const onLanguage = useCallback((l: Locale) => {
    void setLocale(l);
  }, [setLocale]);

  const openSupport = useCallback((url: string) => {
    // Explicit user tap only; the platform opens the URL. Offline devices
    // simply do nothing (rejection is swallowed).
    void Linking.openURL(url).catch(() => {});
  }, []);

  const toolRows = [
    { title: strings.exercises.title, subtitle: strings.more.exerciseSub, route: 'exercises' as const, testID: 'more-exercises' },
    { title: strings.inventory.title, subtitle: strings.more.equipmentSub, route: 'inventory' as const, testID: 'more-inventory' },
    { title: strings.athleteTools.readiness, subtitle: strings.more.readinessSub, route: 'readiness' as const, testID: 'more-readiness' },
    { title: strings.report.title, subtitle: strings.more.reportSub, route: 'report' as const, testID: 'more-report' },
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-4">
          <Enter className="mt-8">
            <Text className="text-display text-fg">{strings.more.title}</Text>
          </Enter>

          <Enter delayMs={40}>
            <SectionHeader title={strings.more.trainingTools} />
            <View className="overflow-hidden rounded-xl border border-line bg-surface">
              {toolRows.map((row) => (
                <ListRow
                  key={row.route}
                  title={row.title}
                  subtitle={row.subtitle}
                  testID={row.testID}
                  onPress={() => push({ name: row.route })}
                />
              ))}
            </View>
          </Enter>

          <Enter delayMs={80}>
            <SectionHeader title={strings.more.dataSection} />
            <View className="overflow-hidden rounded-xl border border-line bg-surface">
              <ListRow
                title={strings.portability.title}
                subtitle={strings.more.backupSub}
                testID="more-portability"
                onPress={() => push({ name: 'portability' })}
              />
            </View>
          </Enter>

          <Enter delayMs={120}>
            <SectionHeader title={strings.more.preferences} />
            <View
              className="min-h-14 flex-row items-center justify-between border-b border-line px-4 py-3"
              testID="more-language"
            >
              <View className="flex-1 pr-3">
                <Text className="text-base font-medium text-fg">{strings.more.languageRow}</Text>
                <Text className="mt-0.5 text-sm text-dim">
                  {locale === 'es' ? strings.common.langSpanish : strings.common.langEnglish}
                </Text>
              </View>
              <View className="flex-row overflow-hidden rounded-lg border border-line">
                {(['en', 'es'] as const).map((l) => {
                  const active = locale === l;
                  return (
                    <Pressable
                      key={l}
                      accessibilityRole="button"
                      accessibilityLabel={l === 'en' ? strings.common.langEnglish : strings.common.langSpanish}
                      accessibilityState={{ selected: active }}
                      testID={`more-lang-${l}`}
                      onPress={() => onLanguage(l)}
                      className={`min-h-12 items-center justify-center px-3 ${active ? 'bg-accent' : 'bg-surface'}`}
                    >
                      <Text className={`text-sm ${active ? 'font-semibold text-fg' : 'text-dim'}`}>
                        {l === 'en' ? strings.common.langEnglish : strings.common.langSpanish}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </Enter>

          <Enter delayMs={160}>
            <SectionHeader title={strings.more.aboutSection} />
            <View className="overflow-hidden rounded-xl border border-line bg-surface">
              <ListRow
                title={strings.trust.title}
                subtitle={strings.more.trustSub}
                testID="more-trust"
                onPress={() => push({ name: 'trust' })}
              />
            </View>
            <Text className="mt-3 text-caption text-muted">{strings.more.storageNote}</Text>

            <Text className="mt-6 text-base font-medium text-fg">{strings.more.supportTitle}</Text>
            <Text className="mt-1 text-sm text-dim">{strings.more.supportBody}</Text>
            <View className="mt-3 overflow-hidden rounded-xl border border-line bg-surface">
              <ListRow
                title={strings.more.supportSponsors}
                testID="more-support-sponsors"
                onPress={() => openSupport(GITHUB_SPONSORS_URL)}
              />
              <ListRow
                title={strings.more.supportPayPal}
                testID="more-support-paypal"
                onPress={() => openSupport(PAYPAL_URL)}
              />
              <ListRow
                title={strings.more.supportMercadoPago}
                testID="more-support-mercadopago"
                onPress={() => openSupport(MERCADOPAGO_URL)}
              />
            </View>
          </Enter>
        </View>
      </ScrollView>
    </Screen>
  );
}

import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { database } from '../../data';
import { strings } from '../../constants/strings';
import { ROUTINE_TEMPLATES, templateByKey, type TemplateKey } from '../../templates/catalog';
import { instantiateTemplate } from '../../templates/instantiate';
import { useNav } from '../navigation';
import { AppHeader, Card, Screen } from '../components';
import { Enter } from '../motion';

/**
 * Phase 4F: template picker — creates a structure-only routine (empty
 * prescriptions) and opens it in the routine editor.
 */
export function TemplatesScreen() {
  const { pop, push } = useNav();
  const [busyKey, setBusyKey] = useState<TemplateKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const useTemplate = async (key: TemplateKey) => {
    if (busyKey) return;
    const template = templateByKey(key);
    if (!template) return;
    setBusyKey(key);
    setError(null);
    try {
      const routineId = await instantiateTemplate(database, template, strings.templates[key]);
      push({ name: 'routineEditor', routineId });
    } catch {
      setError(strings.templates.failed);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Screen>
      <AppHeader title={strings.templates.title} onBack={pop} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="px-4 pt-2">
          <Text className="mb-3 text-label text-dim">{strings.templates.subtitle}</Text>
          {error ? (
            <Text accessibilityRole="alert" className="mb-2 text-caption text-danger">
              {error}
            </Text>
          ) : null}
          {ROUTINE_TEMPLATES.map((template, index) => (
            <Enter key={template.key} delayMs={Math.min(index, 6) * 40}>
              <Card testID={`template-${template.key}`} className="mb-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${strings.templates[template.key]}, ${template.steps.length} ${strings.routines.exercises}`}
                  accessibilityState={{ disabled: busyKey != null }}
                  disabled={busyKey != null}
                  onPress={() => void useTemplate(template.key)}
                  testID={`template-use-${template.key}`}
                  style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}
                  className={`min-h-12 justify-center ${busyKey != null ? 'opacity-50' : ''}`}
                >
                  <Text numberOfLines={1} className="text-card-title text-fg">
                    {strings.templates[template.key]}
                  </Text>
                  <Text numberOfLines={1} className="mt-1 text-label text-dim">
                    {`${template.steps.length} ${strings.routines.exercises}`}
                  </Text>
                </Pressable>
              </Card>
            </Enter>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

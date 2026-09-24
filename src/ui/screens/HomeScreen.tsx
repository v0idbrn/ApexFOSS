import { Text, View, Pressable } from 'react-native';
import { strings } from '../../constants/strings';
import { useNav } from '../navigation';
import { Screen, SectionHeader } from '../components';

/** Home — navigation hub only (no dashboard/analytics per Day 2 contract). */
export function HomeScreen() {
  const { push } = useNav();

  return (
    <Screen>
      <View className="flex-1 px-4">
        <View className="mb-8 mt-10">
          <Text className="text-3xl font-bold text-fg">{strings.home.title}</Text>
          <Text className="mt-1 text-sm text-dim">{strings.home.tagline}</Text>
        </View>

        <SectionHeader title={strings.home.authoring} />
        <Pressable
          accessibilityRole="button"
          onPress={() => push({ name: 'exercises' })}
          className="mb-3 h-16 min-h-16 flex-row items-center justify-between rounded-xl border border-line bg-surface px-4"
        >
          <Text className="text-lg font-medium text-fg">{strings.home.exercises}</Text>
          <Text className="text-xl text-dim">›</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => push({ name: 'routines' })}
          className="h-16 min-h-16 flex-row items-center justify-between rounded-xl border border-line bg-surface px-4"
        >
          <Text className="text-lg font-medium text-fg">{strings.home.routines}</Text>
          <Text className="text-xl text-dim">›</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

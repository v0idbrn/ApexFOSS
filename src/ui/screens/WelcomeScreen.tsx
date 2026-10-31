import { ScrollView, Text, View } from 'react-native';
import { strings } from '../../constants/strings';
import { Button } from '../components';

/**
 * First-run welcome (D-061): shown once, purely informational, and both paths
 * leave the app fully usable. Completion is recorded by the caller.
 */
export function WelcomeScreen({ onLearn, onKnown }: { onLearn: () => void; onKnown: () => void }) {
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }} testID="learn-welcome">
      <View className="px-5 pt-10">
        <Text accessibilityRole="header" className="text-display text-fg">
          {strings.learn.welcome.title}
        </Text>
        <Text className="mt-3 text-body text-dim">{strings.learn.welcome.intro}</Text>
        <Text className="mt-3 text-body text-dim">{strings.learn.welcome.principles}</Text>
        <Text className="mt-2 text-caption text-muted">{strings.learn.welcome.sub}</Text>

        <View className="mt-8 gap-3">
          <Button label={strings.learn.welcome.learn} onPress={onLearn} testID="welcome-learn" />
          <Button
            label={strings.learn.welcome.known}
            variant="secondary"
            onPress={onKnown}
            testID="welcome-known"
          />
        </View>

        <Text className="mt-6 text-caption text-muted">{strings.learn.welcome.doneBody}</Text>
      </View>
    </ScrollView>
  );
}

import { View, Text } from 'react-native';
import './global.css';
import { strings } from './src/constants/strings';

export default function App() {
  return (
    <View className="flex-1 items-center justify-center bg-bg">
      <Text className="text-2xl font-bold text-fg">{strings.common.appName}</Text>
      <Text className="mt-2 text-dim">Day 1 gates — foundation OK</Text>
    </View>
  );
}

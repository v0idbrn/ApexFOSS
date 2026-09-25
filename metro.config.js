const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// react-native-css-interop (NativeWind runtime) hard-requires
// react-native-reanimated from its CSS animation/transition helpers. The app
// uses no animate-*/transition-* classes, and installing reanimated (native
// module + jest setup) is out of scope, so Metro resolves it to a no-op stub.
// See stubs/react-native-reanimated.js and docs/DECISIONS.md.
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  'react-native-reanimated': path.resolve(__dirname, 'stubs/react-native-reanimated.js'),
};

module.exports = withNativeWind(config, { input: './global.css' });

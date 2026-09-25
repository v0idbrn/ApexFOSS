// Metro-only stub for react-native-reanimated (see metro.config.js resolveRequest).
//
// react-native-css-interop (NativeWind's runtime) hard-requires reanimated from
// inside its CSS animation/transition helpers. This project does not use any
// animate-* / transition-* classes, so those helpers never execute; the require
// only needs to resolve for Metro to build the bundle. Installing reanimated
// (native module + jest setup) is deliberately out of scope.
//
// Replace this stub with the real dependency before adding CSS animations.

const noop = () => undefined;

module.exports = {
  __esModule: true,
  makeMutable: (initialValue) => ({ value: initialValue, get: () => initialValue, set: noop }),
  withTiming: noop,
  withDelay: noop,
  withRepeat: noop,
  withSequence: noop,
  cancelAnimation: noop,
  Easing: new Proxy({}, { get: () => noop }),
  default: {},
};

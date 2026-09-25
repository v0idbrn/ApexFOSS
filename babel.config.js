module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // babel-preset-expo ships @babel/plugin-proposal-decorators { legacy: true } natively
      // (the exact transform WatermelonDB models need). Do NOT pass `decorators: false` —
      // that DISABLES the transform. Bare preset = decorators enabled with legacy semantics.
      //
      // jsxImportSource 'nativewind' is REQUIRED: it routes JSX through
      // nativewind/jsx-runtime (react-native-css-interop) so className props are
      // compiled to styles. It was dropped in dcecda2 while fixing a metro issue,
      // which silently rendered every screen unstyled (invisible on the dark theme).
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
    ],
  };
};

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // babel-preset-expo ships @babel/plugin-proposal-decorators { legacy: true } natively
      // (the exact transform WatermelonDB models need). Do NOT pass `decorators: false` —
      // that DISABLES the transform. Bare preset = decorators enabled with legacy semantics.
      'babel-preset-expo',
    ],
  };
};

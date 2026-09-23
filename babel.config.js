module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { decorators: false }]],
    plugins: [
      // 1. Strip TypeScript types & declarations first
      ['@babel/plugin-transform-typescript', { isTSX: true, allExtensions: true }],
      // 2. WatermelonDB legacy decorators (required recipe)
      ['@babel/plugin-proposal-decorators', { legacy: true }],
      // 3. Modern class features with matching loose config
      ['@babel/plugin-transform-class-properties', { loose: true }],
      ['@babel/plugin-transform-private-methods', { loose: true }],
      ['@babel/plugin-transform-private-property-in-object', { loose: true }],
      // 4. NativeWind
      ['nativewind/babel', { mode: 'compileOnly' }],
    ],
  };
};

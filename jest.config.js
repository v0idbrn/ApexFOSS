module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'jsdom',
  testTimeout: 30_000,
  setupFiles: ['./jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|expo-modules-core/.*|@nozbe/.*|nativewind|react-native-css-interop|rxjs|lokijs)/)',
  ],
};

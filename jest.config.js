/** @type {import('jest-expo').JestExpoConfig} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['./jest.setup.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/__tests__/**',
    '!src/**/*.d.ts',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  // Firebase v12 ships ESM — tell Jest to transform it
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|react-navigation|@react-navigation/.*|firebase|@firebase/.*))',
  ],
  // Stub packages that aren't installed or require native build
  moduleNameMapper: {
    '^expo-asset$':   '<rootDir>/__mocks__/expo-asset.js',
    '^expo-constants$': '<rootDir>/__mocks__/expo-constants.js',
  },
};

const path = require('node:path');
const projectRoot = path.dirname(require.resolve('./package.json'));

const expoPackagePath = require.resolve('expo/package.json', {
  paths: [projectRoot],
});
const reactPath = path.dirname(
  require.resolve('react/package.json', {
    paths: [projectRoot],
  }),
);
const reactTestRendererPath = path.dirname(
  require.resolve('react-test-renderer/package.json', {
    paths: [projectRoot],
  }),
);
const expoModulesCorePath = path.dirname(
  require.resolve('expo-modules-core/package.json', {
    paths: [path.dirname(expoPackagePath)],
  }),
);

module.exports = {
  rootDir: projectRoot,
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^react$': reactPath,
    '^react-test-renderer$': reactTestRendererPath,
    '^expo-modules-core$': expoModulesCorePath,
    '^expo-modules-core/src/polyfill/dangerous-internal$': path.join(
      expoModulesCorePath,
      'src/polyfill/dangerous-internal.ts',
    ),
  },
  transformIgnorePatterns: [
    'node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(?:/.*)?|react-clone-referenced-element|@react-navigation(?:/.*)?|expo(?:nent)?(?:/.*)?|@expo(?:nent)?(?:/.*)?|expo-.*|@expo-google-fonts/.*|react-navigation|@walletconnect(?:/.*)?|@sentry(?:/.*)?))',
  ],
};

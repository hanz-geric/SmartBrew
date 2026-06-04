const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

// react-native-svg ≥15.x points Metro at its TypeScript source via the
// "react-native" package.json field. That source imports css-tree, but
// Metro's package resolver fails to follow css-tree's `main` field in this
// context. Pin it directly so Metro doesn't try to walk the package.json.
const cssTreeEntry = require.resolve('css-tree');

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'css-tree') {
    return { filePath: cssTreeEntry, type: 'sourceFile' };
  }
  if (platform === 'web' && moduleName === 'expo-sqlite') {
    return {
      filePath: path.resolve(__dirname, 'src/db/schema.web.ts'),
      type: 'sourceFile',
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

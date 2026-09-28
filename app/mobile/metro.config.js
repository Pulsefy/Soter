const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Find the project and workspace directories
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);








// 1. Watch all files within the monorepo
config.watchFolders = [workspaceRoot];

// 1.5 Add blockList to exclude large irrelevant directories from the watcher
config.resolver.blockList = [
  /.*\/app\/backend\/.*/,
  /.*\/app\/frontend\/.*/,
  /.*\.git\/.*/,
];

// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. pnpm keeps most packages out of the two directories above, reachable
// only via symlinks nested inside their dependents' own node_modules (e.g.
// expo-modules-core lives under node_modules/.pnpm/expo@.../node_modules,
// not hoisted anywhere flat). Metro needs hierarchical lookup enabled to
// walk up and find those, and needs to actually follow the symlinks pnpm
// uses to place them there.
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
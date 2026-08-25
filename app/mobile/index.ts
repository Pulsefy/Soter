import '@walletconnect/react-native-compat';
import 'react-native-get-random-values';
import 'fast-text-encoding';
import { registerRootComponent } from 'expo';

import App from './App';
import { markStartupPhase } from './src/performance/startup';

markStartupPhase('js_entry');

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

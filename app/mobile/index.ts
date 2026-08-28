import '@walletconnect/react-native-compat';
import 'react-native-get-random-values';
import 'fast-text-encoding';
import { registerRootComponent } from 'expo';

import App from './App';
import { initializeCertificatePinning } from './src/services/certificatePinning';

// Fire immediately, before anything else runs, so pinning is active before
// the first network request. Not awaited: initialization only needs to win
// a race against fetch calls triggered by app render/mount, which happen on
// a later tick.
void initializeCertificatePinning();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

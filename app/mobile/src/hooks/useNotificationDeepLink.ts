import { useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNotification } from '../contexts/NotificationContext';
import { deepLinkToNavParams } from '../navigation/types';
import { RootStackParamList } from '../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

/**
 * Hook that watches for pending deep links from the NotificationContext
 * and navigates to the appropriate screen when one is detected.
 *
 * This is an alternative to wiring the navigation inside App.tsx – useful
 * if you prefer the navigation logic to live closer to the screen layer.
 */
export function useNotificationDeepLink() {
  const { pendingDeepLink, consumeDeepLink } = useNotification();
  const navigation = useNavigation<NavigationProp>();

  useEffect(() => {
    if (!pendingDeepLink) return;

    const navParams = deepLinkToNavParams(pendingDeepLink);
    if (navParams) {
      navigation.navigate(navParams.screen as any, navParams.params as any);
    }
    consumeDeepLink();
  }, [pendingDeepLink, consumeDeepLink, navigation]);
}

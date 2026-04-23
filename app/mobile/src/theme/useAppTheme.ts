import { useState, useEffect } from 'react';
import { Appearance, ColorSchemeName } from 'react-native';
import { Colors, SoterLightTheme, SoterDarkTheme } from './theme';

/**
 * Cross-platform color scheme hook using Appearance API.
 * Works on iOS, Android, and Expo Web (react-native-web doesn't export
 * useColorScheme at the path Metro expects, but Appearance is supported).
 */
function useColorScheme(): ColorSchemeName {
  const [scheme, setScheme] = useState<ColorSchemeName>(
    Appearance.getColorScheme(),
  );

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setScheme(colorScheme);
    });
    return () => sub.remove();
  }, []);

  return scheme;
}

/**
 * Returns the full resolved theme for the current device color scheme:
 * - `colors`: mode-specific tokens merged with brand tokens
 * - `navTheme`: the React Navigation theme to pass to <NavigationContainer>
 */
export const useAppTheme = () => {
  const scheme = useColorScheme();

  const colors =
    scheme === 'dark'
      ? { ...Colors.dark, brand: Colors.brand }
      : { ...Colors.light, brand: Colors.brand };

  const navTheme = scheme === 'dark' ? SoterDarkTheme : SoterLightTheme;

  return { colors, navTheme, scheme };
};

export type AppColors = ReturnType<typeof useAppTheme>['colors'];

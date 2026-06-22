import React, { createContext, useContext } from 'react';
import { useAppTheme, AppColors } from './useAppTheme';
import { Theme } from '@react-navigation/native';
import { ColorSchemeName } from 'react-native';

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------

interface ThemeContextValue {
  colors: AppColors;
  navTheme: Theme;
  scheme: ColorSchemeName;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Wrap your app root with <ThemeProvider> so every screen can access the
 * resolved theme via useTheme() without calling useColorScheme() individually.
 * This also makes future enhancements (manual toggle, persisted preference)
 * trivial — change it here, screens get it for free.
 */
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const theme = useAppTheme();
  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
};

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a <ThemeProvider>');
  }
  return ctx;
};

'use client';

import { useTheme as useNextTheme } from 'next-themes';

export type Theme = 'light' | 'dark' | 'system';

export interface UseThemeReturn {
  /** The user's explicit selection, or 'system' if none has been saved. */
  theme: Theme;
  /** The actual rendered theme ('light' | 'dark'), resolved from system preference when theme is 'system'. */
  resolvedTheme: 'light' | 'dark' | undefined;
  /** Update the theme and persist it to localStorage. */
  setTheme: (theme: Theme) => void;
}

/**
 * Thin wrapper around next-themes `useTheme`.
 *
 * Behaviour:
 * - Reads the persisted preference from localStorage on first render.
 * - Falls back to the OS `prefers-color-scheme` when no saved preference exists.
 * - Persisting happens automatically via next-themes (storageKey = 'soter-theme').
 * - Calling `setTheme` writes the selection to localStorage, which survives refresh.
 */
export function useTheme(): UseThemeReturn {
  const { theme, resolvedTheme, setTheme } = useNextTheme();

  const normalised: Theme =
    theme === 'light' || theme === 'dark' ? theme : 'system';

  const resolved: 'light' | 'dark' | undefined =
    resolvedTheme === 'light' || resolvedTheme === 'dark'
      ? resolvedTheme
      : undefined;

  return {
    theme: normalised,
    resolvedTheme: resolved,
    setTheme: (t: Theme) => setTheme(t),
  };
}

'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import {
  ComputerDesktopIcon,
  MoonIcon,
  SunIcon,
} from '@heroicons/react/24/solid';

type ThemeMode = 'system' | 'light' | 'dark';

const THEME_OPTIONS = [
  {
    value: 'system',
    label: 'System',
    ariaLabel: 'Use system theme preference',
    Icon: ComputerDesktopIcon,
  },
  {
    value: 'light',
    label: 'Light',
    ariaLabel: 'Use light theme',
    Icon: SunIcon,
  },
  {
    value: 'dark',
    label: 'Dark',
    ariaLabel: 'Use dark theme',
    Icon: MoonIcon,
  },
] as const;

function normalizeTheme(theme?: string): ThemeMode {
  return theme === 'light' || theme === 'dark' ? theme : 'system';
}

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  // The mounted guard avoids a client/server theme mismatch during hydration.
  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setMounted(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  if (!mounted) {
    return (
      <div
        className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        aria-label="Theme preference loading"
        aria-disabled="true"
      >
        {THEME_OPTIONS.map(option => (
          <span
            key={option.value}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium opacity-60"
          >
            <option.Icon className="h-4 w-4 animate-pulse" aria-hidden="true" />
            <span>{option.label}</span>
          </span>
        ))}
      </div>
    );
  }

  const currentTheme = normalizeTheme(theme);

  return (
    <div
      role="group"
      aria-label="Theme preference"
      className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm dark:border-slate-700 dark:bg-slate-900"
      data-theme={currentTheme}
      data-resolved-theme={resolvedTheme}
    >
      {THEME_OPTIONS.map(option => {
        const isActive = currentTheme === option.value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setTheme(option.value)}
            aria-label={option.ariaLabel}
            aria-pressed={isActive}
            title={option.ariaLabel}
            className={`inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-blue-400 dark:focus-visible:ring-offset-slate-950 ${
              isActive
                ? 'bg-blue-600 text-white shadow-sm dark:bg-blue-500 dark:text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
            }`}
          >
            <option.Icon className="h-4 w-4" aria-hidden="true" />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

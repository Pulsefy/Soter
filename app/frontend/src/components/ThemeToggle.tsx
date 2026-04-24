'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { MoonIcon, SunIcon } from '@heroicons/react/24/solid'; // Example icons

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
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
      <button
        className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-950 focus:ring-slate-300 dark:focus:ring-slate-600"
        aria-label="Toggle theme (loading)"
        disabled
      >
        <div className="h-5 w-5 bg-slate-300 dark:bg-slate-600 rounded-full animate-pulse"></div>
      </button>
    );
  }

  const handleToggle = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <button
      onClick={handleToggle}
      className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-slate-950 focus:ring-slate-300 dark:focus:ring-slate-600"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? (
        <SunIcon className="h-5 w-5 text-yellow-400" />
      ) : (
        <MoonIcon className="h-5 w-5 text-blue-300" />
      )}
    </button>
  );
}

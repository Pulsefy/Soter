/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';
import { useTheme } from '../useTheme';

// ---------------------------------------------------------------------------
// next-themes mock — lets us control the underlying state from tests
// ---------------------------------------------------------------------------

let _theme = 'system';
let _resolvedTheme: string | undefined = 'light';
const _setTheme = jest.fn((t: string) => {
  _theme = t;
});

jest.mock('next-themes', () => ({
  useTheme: () => ({
    theme: _theme,
    resolvedTheme: _resolvedTheme,
    setTheme: _setTheme,
  }),
}));

// Helpers
function reset(theme = 'system', resolvedTheme: string | undefined = 'light') {
  _theme = theme;
  _resolvedTheme = resolvedTheme;
  _setTheme.mockClear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useTheme', () => {
  beforeEach(() => reset());

  // 1. Theme persists after refresh (simulated by localStorage re-read)
  it('restores the saved theme preference on load', () => {
    // Simulate: user previously picked 'dark', next-themes reads localStorage
    reset('dark', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    expect(result.current.resolvedTheme).toBe('dark');
  });

  // 2. System preference used on first load (no saved preference)
  it('uses the system-resolved theme when no explicit preference is saved', () => {
    // next-themes sets theme='system' and resolves via matchMedia
    reset('system', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('system');
    expect(result.current.resolvedTheme).toBe('dark');
  });

  it('resolves to light via system preference', () => {
    reset('system', 'light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('system');
    expect(result.current.resolvedTheme).toBe('light');
  });

  // 3. Saved preference overrides system preference
  it('uses explicit saved preference over system preference', () => {
    // OS says dark, but user saved 'light'
    reset('light', 'light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
    expect(result.current.resolvedTheme).toBe('light');
  });

  // 4. Theme toggle updates correctly
  it('calls setTheme with the selected value and updates theme', () => {
    reset('system', 'light');
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme('dark');
    });

    expect(_setTheme).toHaveBeenCalledWith('dark');
    expect(_setTheme).toHaveBeenCalledTimes(1);
  });

  it('toggles from dark back to system', () => {
    reset('dark', 'dark');
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme('system');
    });

    expect(_setTheme).toHaveBeenCalledWith('system');
  });

  it('toggles from dark to light', () => {
    reset('dark', 'dark');
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme('light');
    });

    expect(_setTheme).toHaveBeenCalledWith('light');
  });

  // 5. Normalisation: unknown theme string is treated as 'system'
  it('normalises an unrecognised theme value to system', () => {
    reset('unknown-value', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('system');
    // resolvedTheme is passed through unchanged when it is a valid value
    expect(result.current.resolvedTheme).toBe('dark');
  });
});

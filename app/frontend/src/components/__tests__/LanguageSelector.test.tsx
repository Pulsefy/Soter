/** @jest-environment jsdom */
/**
 * Tests for LanguageSelector:
 * - Locale persistence: restores stored locale on mount by redirecting
 * - No redirect when stored locale already matches URL locale
 * - Selecting a new locale saves it to the store and navigates
 * - Same locale selection is a no-op
 * - Renders all language options and reflects the active locale
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { LanguageSelector } from '../LanguageSelector';

// ─── Mock dependencies ────────────────────────────────────────────────────────

const mockRouterReplace = jest.fn();
const mockRouterPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockRouterReplace,
    push: mockRouterPush,
  }),
  usePathname: () => '/en/dashboard',
}));

// Mocked locale — overridden per test where needed
let mockCurrentLocale = 'en';
jest.mock('next-intl', () => ({
  useLocale: () => mockCurrentLocale,
}));

// Mocked store state — overridden per test where needed
let mockStoredLocale = 'en';
const mockSetLocale = jest.fn();
jest.mock('@/lib/localeStore', () => ({
  useLocaleStore: () => ({
    locale: mockStoredLocale,
    setLocale: mockSetLocale,
  }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderSelector() {
  return render(<LanguageSelector />);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentLocale = 'en';
  mockStoredLocale = 'en';
});

describe('LanguageSelector — locale persistence on mount', () => {
  it('redirects to the stored locale when it differs from the URL locale', async () => {
    // Simulate: user previously selected 'fr', but the URL still shows 'en'
    mockCurrentLocale = 'en';
    mockStoredLocale = 'fr';

    await act(async () => {
      renderSelector();
    });

    // Should replace the URL locale segment with 'fr'
    expect(mockRouterReplace).toHaveBeenCalledWith('/fr/dashboard');
  });

  it('does NOT redirect when stored locale matches the URL locale', async () => {
    mockCurrentLocale = 'en';
    mockStoredLocale = 'en';

    await act(async () => {
      renderSelector();
    });

    expect(mockRouterReplace).not.toHaveBeenCalled();
  });
});

describe('LanguageSelector — locale change', () => {
  it('saves the new locale to the store when changed', () => {
    mockCurrentLocale = 'en';
    mockStoredLocale = 'en';

    renderSelector();

    const select = screen.getByRole('combobox', { name: /select language/i });
    fireEvent.change(select, { target: { value: 'es' } });

    expect(mockSetLocale).toHaveBeenCalledWith('es');
  });

  it('navigates to the new locale path when changed', () => {
    mockCurrentLocale = 'en';
    mockStoredLocale = 'en';

    renderSelector();

    const select = screen.getByRole('combobox', { name: /select language/i });
    fireEvent.change(select, { target: { value: 'fr' } });

    expect(mockRouterPush).toHaveBeenCalledWith('/fr/dashboard');
  });

  it('does not navigate if the same locale is selected again', () => {
    mockCurrentLocale = 'en';
    mockStoredLocale = 'en';

    renderSelector();

    const select = screen.getByRole('combobox', { name: /select language/i });
    // Selecting the already-active locale should be a no-op
    fireEvent.change(select, { target: { value: 'en' } });

    expect(mockSetLocale).not.toHaveBeenCalled();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});

describe('LanguageSelector — rendering', () => {
  it('renders all three language options', () => {
    renderSelector();

    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Español' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Français' })).toBeInTheDocument();
  });

  it('reflects the current locale as the selected option', () => {
    mockCurrentLocale = 'fr';
    mockStoredLocale = 'fr';

    renderSelector();

    const select = screen.getByRole('combobox', { name: /select language/i });
    expect((select as HTMLSelectElement).value).toBe('fr');
  });
});

/** @jest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '../ThemeProvider';
import { ThemeToggle } from '../ThemeToggle';

let mockTheme = 'system';
let mockResolvedTheme = 'dark';
const mockSetTheme = jest.fn();

jest.mock('next-themes', () => {
  const actualReact = jest.requireActual<typeof import('react')>('react');

  return {
    ThemeProvider: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      actualReact.createElement(
        'div',
        {
          'data-testid': 'next-themes-provider',
          'data-attribute': props.attribute,
          'data-default-theme': props.defaultTheme,
          'data-enable-system': String(props.enableSystem),
          'data-enable-color-scheme': String(props.enableColorScheme),
          'data-storage-key': props.storageKey,
        },
        children,
      ),
    useTheme: () => ({
      theme: mockTheme,
      resolvedTheme: mockResolvedTheme,
      setTheme: mockSetTheme,
    }),
  };
});

describe('ThemeProvider', () => {
  it('follows the system color scheme by default', () => {
    render(
      <ThemeProvider>
        <span>content</span>
      </ThemeProvider>,
    );

    const provider = screen.getByTestId('next-themes-provider');
    expect(provider).toHaveAttribute('data-attribute', 'class');
    expect(provider).toHaveAttribute('data-default-theme', 'system');
    expect(provider).toHaveAttribute('data-enable-system', 'true');
    expect(provider).toHaveAttribute('data-enable-color-scheme', 'true');
    expect(provider).toHaveAttribute('data-storage-key', 'soter-theme');
  });
});

describe('ThemeToggle', () => {
  beforeEach(() => {
    mockTheme = 'system';
    mockResolvedTheme = 'dark';
    mockSetTheme.mockClear();

    window.requestAnimationFrame = callback => {
      callback(0);
      return 1;
    };
    window.cancelAnimationFrame = jest.fn();
  });

  it('renders explicit system, light, and dark theme controls', async () => {
    render(<ThemeToggle />);

    expect(
      await screen.findByRole('group', { name: 'Theme preference' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Use system theme preference' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', { name: 'Use light theme' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Use dark theme' }),
    ).toBeInTheDocument();
  });

  it('lets the user override the theme directly', async () => {
    render(<ThemeToggle />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Use light theme' }),
    );
    expect(mockSetTheme).toHaveBeenLastCalledWith('light');

    fireEvent.click(screen.getByRole('button', { name: 'Use dark theme' }));
    expect(mockSetTheme).toHaveBeenLastCalledWith('dark');

    fireEvent.click(
      screen.getByRole('button', { name: 'Use system theme preference' }),
    );
    expect(mockSetTheme).toHaveBeenLastCalledWith('system');
  });
});

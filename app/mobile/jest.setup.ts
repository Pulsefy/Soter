jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.spyOn(console, 'warn').mockImplementation((message?: any, ...optionalParams: any[]) => {
  if (
    typeof message === 'string' &&
    message.includes('Soroban Contract ID is missing (EXPO_PUBLIC_SOROBAN_CONTRACT_ID)')
  ) {
    return;
  }

  const originalWarn = jest.requireActual('console').warn as (...args: any[]) => void;
  originalWarn(message, ...optionalParams);
});

// Mock window event dispatch/listeners for compatibility in Node environment
const win = typeof window !== 'undefined' ? window : (global as any).window;
if (win) {
  if (typeof win.dispatchEvent !== 'function') {
    Object.defineProperty(win, 'dispatchEvent', {
      value: jest.fn(),
      writable: true
    });
  }
  if (typeof win.addEventListener !== 'function') {
    Object.defineProperty(win, 'addEventListener', {
      value: jest.fn(),
      writable: true
    });
  }
  if (typeof win.removeEventListener !== 'function') {
    Object.defineProperty(win, 'removeEventListener', {
      value: jest.fn(),
      writable: true
    });
  }
}

jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

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

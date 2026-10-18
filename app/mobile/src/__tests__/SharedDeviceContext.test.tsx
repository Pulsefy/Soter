import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { SharedDeviceProvider, useSharedDevice } from '../contexts/SharedDeviceContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Mock dependencies
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

jest.mock('../contexts/WalletContext', () => ({
  useWallet: () => ({
    disconnectWallet: jest.fn(),
    status: 'connected',
  }),
}));

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

describe('SharedDeviceContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize with enabled state from storage', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('true');

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SharedDeviceProvider>{children}</SharedDeviceProvider>
    );

    const { result } = renderHook(() => useSharedDevice(), { wrapper });

    await waitFor(() => {
      expect(result.current.enabled).toBe(true);
    });

    expect(AsyncStorage.getItem).toHaveBeenCalledWith('shared_device_mode_enabled');
  });

  it('should initialize as disabled when storage returns false', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('false');

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SharedDeviceProvider>{children}</SharedDeviceProvider>
    );

    const { result } = renderHook(() => useSharedDevice(), { wrapper });

    await waitFor(() => {
      expect(result.current.enabled).toBe(false);
    });
  });

  it('should initialize as disabled when storage returns null', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SharedDeviceProvider>{children}</SharedDeviceProvider>
    );

    const { result } = renderHook(() => useSharedDevice(), { wrapper });

    await waitFor(() => {
      expect(result.current.enabled).toBe(false);
    });
  });

  it('should toggle shared device mode and persist to storage', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('false');
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SharedDeviceProvider>{children}</SharedDeviceProvider>
    );

    const { result } = renderHook(() => useSharedDevice(), { wrapper });

    await waitFor(() => {
      expect(result.current.enabled).toBe(false);
    });

    await act(async () => {
      await result.current.toggle(true);
    });

    expect(result.current.enabled).toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('shared_device_mode_enabled', 'true');
  });

  it('should throw error when useSharedDevice is used outside provider', () => {
    expect(() => {
      renderHook(() => useSharedDevice());
    }).toThrow('useSharedDevice must be used within a SharedDeviceProvider');
  });
});

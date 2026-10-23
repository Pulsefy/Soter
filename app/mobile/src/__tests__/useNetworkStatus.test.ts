import { act, renderHook } from '@testing-library/react-native';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

type NetworkEvent = {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  type: 'wifi' | 'cellular' | 'none';
};

let mockNetInfoListener: ((state: NetworkEvent) => void) | undefined;

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(
      (listener: (state: NetworkEvent) => void) => {
        mockNetInfoListener = listener;
        return jest.fn();
      },
    ),
  },
}));

const emitNetworkState = (state: NetworkEvent) => {
  const listener = mockNetInfoListener;
  if (!listener) {
    throw new Error('NetInfo listener has not been registered');
  }

  act(() => listener(state));
};

describe('useNetworkStatus', () => {
  beforeEach(() => {
    mockNetInfoListener = undefined;
  });

  it('preserves existing callers that provide no network-change callback', () => {
    renderHook(() => useNetworkStatus());

    emitNetworkState({
      isConnected: true,
      isInternetReachable: true,
      type: 'wifi',
    });
    emitNetworkState({
      isConnected: true,
      isInternetReachable: true,
      type: 'cellular',
    });
  });

  it('fires the network-change callback after a connected interface switch', () => {
    const onNetworkChange = jest.fn();
    renderHook(() => useNetworkStatus(undefined, onNetworkChange));

    emitNetworkState({
      isConnected: true,
      isInternetReachable: true,
      type: 'wifi',
    });
    expect(onNetworkChange).not.toHaveBeenCalled();

    emitNetworkState({
      isConnected: true,
      isInternetReachable: true,
      type: 'cellular',
    });
    expect(onNetworkChange).toHaveBeenCalledTimes(1);
  });

  it('preserves reconnect callbacks passed as a function', () => {
    const onReconnect = jest.fn();
    renderHook(() => useNetworkStatus(onReconnect));

    emitNetworkState({
      isConnected: false,
      isInternetReachable: false,
      type: 'none',
    });
    emitNetworkState({
      isConnected: true,
      isInternetReachable: true,
      type: 'wifi',
    });

    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});

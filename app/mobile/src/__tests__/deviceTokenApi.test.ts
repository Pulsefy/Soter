jest.mock('../services/requestLayer', () => ({
  apiPost: jest.fn(),
  apiDelete: jest.fn(),
}));

jest.mock('expo-device', () => ({
  isDevice: true,
  getDeviceIdAsync: jest.fn(),
}));

import * as Device from 'expo-device';
import { apiPost } from '../services/requestLayer';
import {
  DevicePlatform,
  registerDeviceToken,
} from '../services/deviceTokenApi';

const mockedApiPost = jest.mocked(apiPost);
const mockedGetDeviceIdAsync = jest.mocked(Device.getDeviceIdAsync);

describe('deviceTokenApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetDeviceIdAsync.mockResolvedValue('device-123');
  });

  it('registers a valid push token successfully', async () => {
    const response = {
      id: 'device-token-1',
      userId: 'user-123',
      orgId: null,
      platform: DevicePlatform.ios,
      deviceId: 'device-123',
      token: 'ExponentPushToken[abc123]',
      deviceName: 'iOS Device',
      appVersion: null,
      isActive: true,
      lastUsedAt: '2024-01-01T00:00:00.000Z',
      revokedAt: null,
      revokedBy: null,
      revokedReason: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    mockedApiPost.mockResolvedValue({ data: response } as any);

    const result = await registerDeviceToken('ExponentPushToken[abc123]');

    expect(result).toEqual(response);
    expect(mockedApiPost).toHaveBeenCalledTimes(1);
    expect(mockedApiPost).toHaveBeenCalledWith(
      '/device-tokens',
      expect.objectContaining({
        platform: DevicePlatform.ios,
        deviceId: 'device-123',
        token: 'ExponentPushToken[abc123]',
        deviceName: 'iOS Device',
      }),
    );
  });

  it('returns null when the network request fails', async () => {
    mockedApiPost.mockRejectedValue(new Error('Network error'));

    await expect(registerDeviceToken('ExponentPushToken[abc123]')).resolves.toBeNull();
    expect(mockedApiPost).toHaveBeenCalledTimes(1);
  });

  it('returns null when the server rejects an invalid token', async () => {
    mockedApiPost.mockRejectedValue(new Error('HTTP 400'));

    await expect(registerDeviceToken('invalid-token')).resolves.toBeNull();
    expect(mockedApiPost).toHaveBeenCalledTimes(1);
  });
});

import { config } from '../config';

const API_URL = config.apiUrl;

export interface RegisterDeviceTokenPayload {
  platform: 'ios' | 'android';
  deviceId: string;
  token: string;
  deviceName?: string;
  appVersion?: string;
}

export const registerDeviceToken = async (
  payload: RegisterDeviceTokenPayload,
  walletPublicKey: string
): Promise<unknown> => {
  const response = await fetch(`${API_URL}/device-tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': walletPublicKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to register device token: ${response.status}`);
  }

  return response.json();
};

export const revokeDeviceTokenByToken = async (
  token: string,
  walletPublicKey: string
): Promise<unknown> => {
  const response = await fetch(`${API_URL}/device-tokens/revoke-by-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': walletPublicKey,
    },
    body: JSON.stringify({ token, reason: 'user_signout' }),
  });

  if (!response.ok) {
    throw new Error(`Failed to revoke device token: ${response.status}`);
  }

  return response.json();
};

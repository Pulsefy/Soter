/**
 * Screen tests for the pre-capture storage quota gate (#1160).
 *
 * Simulates a low-storage device by mocking `expo-file-system`'s
 * `Paths.availableDiskSpace` and verifies that:
 *  - a capture attempt on a healthy device proceeds without warnings
 *  - a low-storage device shows a warning Alert BEFORE any capture starts
 *  - the worker can proceed anyway ("Continue Anyway") or cancel
 *  - a critical-storage device blocks capture entirely
 *  - the persistent banner reflects the current storage level
 */

import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as imagePicker from 'expo-image-picker';

import { EvidenceUploadScreen } from '../screens/EvidenceUploadScreen';
import type { RootStackParamList } from '../navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type EvidenceUploadProps = NativeStackScreenProps<RootStackParamList, 'EvidenceUpload'>;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAvailableDiskSpace = jest.fn<number, []>();
const mockTotalDiskSpace = jest.fn<number, []>();

jest.mock('expo-file-system', () => ({
  Paths: {
    get availableDiskSpace() {
      return mockAvailableDiskSpace();
    },
    get totalDiskSpace() {
      return mockTotalDiskSpace();
    },
  },
}));

jest.mock('../services/logger', () => ({
  structuredLogger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../contexts/SyncContext', () => ({
  useSync: () => ({
    isConnected: true,
    queueEvidenceUpload: jest.fn(),
    getActionsForAid: jest.fn(() => []),
    retryAction: jest.fn(),
  }),
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      background: '#FFFFFF',
      surface: '#F5F5F5',
      border: '#E0E0E0',
      textPrimary: '#000000',
      textSecondary: '#666666',
      info: '#007AFF',
      error: '#FF3B30',
      brand: { primary: '#007AFF' },
    },
  }),
}));

jest.mock('../i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      // Minimal key map: fall back to en.json-equivalent strings.
      const map: Record<string, string> = {
        'evidence.step1': 'Step 1: Choose a photo',
        'evidence.step2': 'Step 2: Preview',
        'evidence.step3': 'Step 3: Upload',
        'evidence.takePhoto': 'Take Photo',
        'evidence.selectPhoto': 'Select Photo',
        'evidence.chooseAgain': 'Choose Again',
        'evidence.storageLowTitle': 'Low Storage',
        'evidence.storageCriticalTitle': 'Storage Almost Full',
        'evidence.storageBannerBody':
          'Free storage: about {free} (includes {pending} held by pending uploads). Capture may fail if space runs out.',
        'evidence.storageContinue': 'Continue Anyway',
        'common.cancel': 'Cancel',
        'common.ok': 'OK',
        'aidDetails.uploadEvidence': 'Upload Evidence',
      };
      let out = map[key] ?? key;
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          out = out.replace(`{${k}}`, String(v));
        });
      }
      return out;
    },
  }),
}));

jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' },
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('../services/verificationApi', () => ({
  buildEvidenceUploadPayload: jest.fn(() => ({})),
}));

jest.spyOn(Alert, 'alert');

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

const setFreeDiskBytes = (bytes: number) => {
  mockAvailableDiskSpace.mockReturnValue(bytes);
};

const renderScreen = () => {
  const route = { key: 'evidence-test', params: { aidId: 'aid-1160' } } as unknown as EvidenceUploadProps['route'];
  const navigation = { navigate: jest.fn(), goBack: jest.fn() } as unknown as EvidenceUploadProps['navigation'];
  return render(<EvidenceUploadScreen route={route} navigation={navigation} />);
};

// `AsyncStorageStatic.clear` is missing from the installed typings (a known
// repo-wide typing gap); go through an untyped view instead.
const clearAsyncStorage = async (): Promise<void> => {
  await (AsyncStorage as unknown as { clear: () => Promise<void> }).clear();
};

const pressSelectPhoto = (getByText: (text: string) => any) => {
  fireEvent.press(getByText('Select Photo'));
};

describe('EvidenceUploadScreen storage quota gate (#1160)', () => {
  beforeAll(() => {
    mockTotalDiskSpace.mockReturnValue(64 * GB);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    (Alert.alert as jest.Mock).mockClear();
    await clearAsyncStorage();
    // Happy-path picker mocks: granted permission + cancelled picker. Tests
    // that assert the gate runs only need these to be callable/awaitable.
    (imagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (imagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (imagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: true, assets: [] });
    (imagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({ canceled: true, assets: [] });
    setFreeDiskBytes(32 * GB);
  });

  it('renders the screen without a storage banner when storage is healthy', async () => {
    const { getByText, queryByTestId } = renderScreen();

    await waitFor(() => {
      expect(mockAvailableDiskSpace).toHaveBeenCalled();
    });

    expect(getByText('Take Photo')).toBeTruthy();
    expect(queryByTestId('storage-quota-warning')).toBeNull();
    // No pre-capture warnings fired on mount with healthy storage.
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('shows a low-storage warning and blocks the capture until confirmed (simulated low storage)', async () => {
    // 150 MB free on a 64 GB device: below the 200 MB absolute threshold.
    setFreeDiskBytes(150 * MB);

    const { getByText } = renderScreen();

    // Banner appears without any user action.
    await waitFor(() => {
      expect(getByText('Low Storage')).toBeTruthy();
    });

    // Attempt capture: pre-capture Alert appears BEFORE image picker opens.
    pressSelectPhoto(getByText);

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Low Storage',
        expect.stringContaining('pending uploads'),
        expect.arrayContaining([
          expect.objectContaining({ text: 'Cancel' }),
          expect.objectContaining({ text: 'Continue Anyway' }),
        ]),
        expect.objectContaining({ cancelable: true }),
      );
    });

    // The photo library must NOT have opened before the warning was shown.
    expect(imagePicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  });

  it('proceeds with capture when the worker chooses Continue Anyway', async () => {
    setFreeDiskBytes(150 * MB);

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Low Storage')).toBeTruthy();
    });

    pressSelectPhoto(getByText);

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalled();
    });

    // Resolve the alert with "Continue Anyway".
    const alertCall = (Alert.alert as jest.Mock).mock.calls.find(
      (call) => call[0] === 'Low Storage',
    );
    const continueBtn = alertCall[2].find(
      (btn: { text?: string }) => btn.text === 'Continue Anyway',
    ) as { onPress: () => void };
    continueBtn.onPress();

    await waitFor(() => {
      expect(imagePicker.requestMediaLibraryPermissionsAsync).toHaveBeenCalled();
    });
  });

  it('cancels capture when the worker dismisses the low-storage warning', async () => {
    setFreeDiskBytes(150 * MB);

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Low Storage')).toBeTruthy();
    });

    pressSelectPhoto(getByText);

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalled();
    });

    const alertCall = (Alert.alert as jest.Mock).mock.calls.find(
      (call) => call[0] === 'Low Storage',
    );
    const cancelBtn = alertCall[2].find((btn: { text?: string }) => btn.text === 'Cancel');
    cancelBtn.onPress();

    // Allow the promise resolution to settle.
    await waitFor(() => {
      expect(imagePicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    });
  });

  it('blocks capture entirely with a critical-storage alert (no continue option)', async () => {
    // 4 MB free: below the capture-overhead floor.
    setFreeDiskBytes(4 * MB);

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(getByText('Storage Almost Full')).toBeTruthy();
    });

    pressSelectPhoto(getByText);

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Storage Almost Full',
        expect.any(String),
        expect.arrayContaining([expect.objectContaining({ text: 'OK' })]),
        expect.objectContaining({ cancelable: true }),
      );
    });

    const criticalCall = (Alert.alert as jest.Mock).mock.calls.find(
      (call) => call[0] === 'Storage Almost Full',
    );
    const buttons = criticalCall[2] as { text?: string }[];
    expect(buttons.some((btn) => btn.text === 'Continue Anyway')).toBe(false);

    expect(imagePicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  });

  it('includes pending queued upload size in the banner numbers', async () => {
    // 250 MB free with 100 MB of pending uploads => ~150 MB effective (low).
    setFreeDiskBytes(250 * MB);
    await AsyncStorage.setItem(
      '@soter/sync-queue',
      JSON.stringify([
        {
          id: 'q1',
          type: 'evidence-upload',
          state: 'pending',
          payload: { estimatedSize: 100 * MB },
        },
      ]),
    );

    const { getByText } = renderScreen();

    await waitFor(() => {
      const banner = getByText('Free storage: about 150 MB (includes 100 MB held by pending uploads). Capture may fail if space runs out.');
      expect(banner).toBeTruthy();
    });
  });
});

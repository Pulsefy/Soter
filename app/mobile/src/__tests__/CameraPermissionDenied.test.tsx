/**
 * Tests for camera permission denied state (#930)
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { CameraPermissionDenied } from '../components/CameraPermissionDenied';

// Mock the theme context
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      background: '#FFFFFF',
      surface: '#F5F5F5',
      textPrimary: '#000000',
      textSecondary: '#666666',
      border: '#E0E0E0',
      brand: { primary: '#007AFF' },
      success: '#34C759',
      error: '#FF3B30',
      warning: '#FF9500',
    },
  }),
}));

describe('CameraPermissionDenied', () => {
  const defaultProps = {
    permissionState: 'denied' as const,
    statusMessage: 'Camera access was denied.',
    canRequestAgain: true,
    canUsePhotoLibrary: false,
    onRequestPermission: jest.fn(),
    onOpenSettings: jest.fn(),
    onGoBack: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('when permission is denied but can request again', () => {
    it('renders the grant permission button', () => {
      const { getByText } = render(<CameraPermissionDenied {...defaultProps} />);
      expect(getByText('Grant Permission')).toBeTruthy();
    });

    it('calls onRequestPermission when grant button is pressed', () => {
      const { getByText } = render(<CameraPermissionDenied {...defaultProps} />);
      fireEvent.press(getByText('Grant Permission'));
      expect(defaultProps.onRequestPermission).toHaveBeenCalledTimes(1);
    });

    it('displays the correct title for scanner context', () => {
      const { getByText } = render(
        <CameraPermissionDenied {...defaultProps} context="scanner" />
      );
      expect(getByText('Camera Required for Scanning')).toBeTruthy();
    });

    it('displays the correct title for evidence context', () => {
      const { getByText } = render(
        <CameraPermissionDenied {...defaultProps} context="evidence" />
      );
      expect(getByText('Camera Required for Evidence')).toBeTruthy();
    });
  });

  describe('when permission is blocked', () => {
    const blockedProps = {
      ...defaultProps,
      permissionState: 'blocked' as const,
      canRequestAgain: false,
    };

    it('renders the open settings button instead of grant permission', () => {
      const { getByText, queryByText } = render(
        <CameraPermissionDenied {...blockedProps} />
      );
      expect(getByText('Open Settings')).toBeTruthy();
      expect(queryByText('Grant Permission')).toBeNull();
    });

    it('calls onOpenSettings when settings button is pressed', () => {
      const { getByText } = render(<CameraPermissionDenied {...blockedProps} />);
      fireEvent.press(getByText('Open Settings'));
      expect(blockedProps.onOpenSettings).toHaveBeenCalledTimes(1);
    });

    it('displays help instructions for enabling camera', () => {
      const { getByText } = render(<CameraPermissionDenied {...blockedProps} />);
      expect(getByText('How to enable camera access:')).toBeTruthy();
      expect(getByText(/Tap "Open Settings" above/)).toBeTruthy();
    });

    it('shows blocked icon', () => {
      const { getByText } = render(<CameraPermissionDenied {...blockedProps} />);
      expect(getByText('🚫')).toBeTruthy();
    });
  });

  describe('when photo library fallback is available', () => {
    const propsWithLibrary = {
      ...defaultProps,
      canUsePhotoLibrary: true,
      onUsePhotoLibrary: jest.fn(),
    };

    it('renders the choose from library button', () => {
      const { getByText } = render(<CameraPermissionDenied {...propsWithLibrary} />);
      expect(getByText('Choose from Library')).toBeTruthy();
    });

    it('calls onUsePhotoLibrary when library button is pressed', () => {
      const { getByText } = render(<CameraPermissionDenied {...propsWithLibrary} />);
      fireEvent.press(getByText('Choose from Library'));
      expect(propsWithLibrary.onUsePhotoLibrary).toHaveBeenCalledTimes(1);
    });
  });

  describe('go back functionality', () => {
    it('always renders the go back button', () => {
      const { getByText } = render(<CameraPermissionDenied {...defaultProps} />);
      expect(getByText('Go Back')).toBeTruthy();
    });

    it('calls onGoBack when go back is pressed', () => {
      const { getByText } = render(<CameraPermissionDenied {...defaultProps} />);
      fireEvent.press(getByText('Go Back'));
      expect(defaultProps.onGoBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('accessibility', () => {
    it('has accessible role alert on container', () => {
      const { getByRole } = render(<CameraPermissionDenied {...defaultProps} />);
      expect(getByRole('alert')).toBeTruthy();
    });

    it('has accessible buttons with proper labels', () => {
      const { getByLabelText } = render(<CameraPermissionDenied {...defaultProps} />);
      expect(getByLabelText('Grant camera permission')).toBeTruthy();
      expect(getByLabelText('Go back')).toBeTruthy();
    });

    it('has accessible hint on settings button when blocked', () => {
      const blockedProps = {
        ...defaultProps,
        permissionState: 'blocked' as const,
        canRequestAgain: false,
      };
      const { getByLabelText } = render(<CameraPermissionDenied {...blockedProps} />);
      expect(getByLabelText('Open device settings')).toBeTruthy();
    });
  });
});

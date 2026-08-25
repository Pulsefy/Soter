/**
 * CameraPermissionDenied - Graceful UI for denied camera permission (#930)
 *
 * Displays an informative screen when camera access is denied or blocked,
 * with options to:
 * - Request permission again (if not permanently blocked)
 * - Open system settings (if blocked)
 * - Use photo library as fallback alternative
 * - Go back to previous screen
 */

import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import type { PermissionState } from '../hooks/useCameraPermission';

interface CameraPermissionDeniedProps {
  /** Current permission state */
  permissionState: PermissionState;
  /** User-friendly explanation message */
  statusMessage: string;
  /** Whether permission can be requested again */
  canRequestAgain: boolean;
  /** Whether photo library is available as fallback */
  canUsePhotoLibrary?: boolean;
  /** Callback to request camera permission */
  onRequestPermission: () => void;
  /** Callback to open system settings */
  onOpenSettings: () => void;
  /** Callback to use photo library fallback */
  onUsePhotoLibrary?: () => void;
  /** Callback to go back */
  onGoBack: () => void;
  /** Screen context for appropriate messaging */
  context?: 'scanner' | 'evidence' | 'default';
}

export const CameraPermissionDenied: React.FC<CameraPermissionDeniedProps> = ({
  permissionState,
  statusMessage,
  canRequestAgain,
  canUsePhotoLibrary = false,
  onRequestPermission,
  onOpenSettings,
  onUsePhotoLibrary,
  onGoBack,
  context = 'default',
}) => {
  const { colors } = useTheme();
  const isBlocked = permissionState === 'blocked';

  const getContextTitle = () => {
    switch (context) {
      case 'scanner':
        return 'Camera Required for Scanning';
      case 'evidence':
        return 'Camera Required for Evidence';
      default:
        return 'Camera Access Required';
    }
  };

  const getContextDescription = () => {
    if (isBlocked) {
      switch (context) {
        case 'scanner':
          return 'To scan QR codes, please enable camera access in your device settings.';
        case 'evidence':
          return 'To capture evidence photos, please enable camera access in your device settings.';
        default:
          return 'Camera access has been blocked. Please enable it in your device settings to continue.';
      }
    }

    switch (context) {
      case 'scanner':
        return 'Camera access is needed to scan QR codes. Grant permission to continue.';
      case 'evidence':
        return 'Camera access is needed to capture evidence photos. Grant permission to continue.';
      default:
        return statusMessage;
    }
  };

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background }]}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={`${getContextTitle()}. ${getContextDescription()}`}
    >
      <View style={styles.iconContainer}>
        <Text style={styles.icon}>
          {isBlocked ? '🚫' : '📷'}
        </Text>
      </View>

      <Text
        style={[styles.title, { color: colors.textPrimary }]}
        accessibilityRole="header"
      >
        {getContextTitle()}
      </Text>

      <Text style={[styles.description, { color: colors.textSecondary }]}>
        {getContextDescription()}
      </Text>

      <View style={styles.buttonContainer}>
        {isBlocked ? (
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.brand.primary }]}
            onPress={onOpenSettings}
            accessibilityRole="button"
            accessibilityLabel="Open device settings"
            accessibilityHint="Opens your device settings where you can enable camera access"
          >
            <Text style={styles.primaryButtonText}>Open Settings</Text>
          </TouchableOpacity>
        ) : canRequestAgain ? (
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.brand.primary }]}
            onPress={onRequestPermission}
            accessibilityRole="button"
            accessibilityLabel="Grant camera permission"
            accessibilityHint="Requests camera access permission"
          >
            <Text style={styles.primaryButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        ) : null}

        {canUsePhotoLibrary && onUsePhotoLibrary && (
          <TouchableOpacity
            style={[
              styles.secondaryButton,
              { borderColor: colors.brand.primary },
            ]}
            onPress={onUsePhotoLibrary}
            accessibilityRole="button"
            accessibilityLabel="Select from photo library"
            accessibilityHint="Choose an existing photo instead of taking a new one"
          >
            <Text style={[styles.secondaryButtonText, { color: colors.brand.primary }]}>
              Choose from Library
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.textButton]}
          onPress={onGoBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous screen"
        >
          <Text style={[styles.textButtonText, { color: colors.textSecondary }]}>
            Go Back
          </Text>
        </TouchableOpacity>
      </View>

      {isBlocked && (
        <View style={[styles.helpCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.helpTitle, { color: colors.textPrimary }]}>
            How to enable camera access:
          </Text>
          <Text style={[styles.helpStep, { color: colors.textSecondary }]}>
            1. Tap "Open Settings" above
          </Text>
          <Text style={[styles.helpStep, { color: colors.textSecondary }]}>
            2. Find and tap "Camera" or "Permissions"
          </Text>
          <Text style={[styles.helpStep, { color: colors.textSecondary }]}>
            3. Toggle camera access to "On" or "Allow"
          </Text>
          <Text style={[styles.helpStep, { color: colors.textSecondary }]}>
            4. Return to this app
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  iconContainer: {
    marginBottom: 20,
  },
  icon: {
    fontSize: 64,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
    paddingHorizontal: 20,
  },
  buttonContainer: {
    width: '100%',
    maxWidth: 300,
    gap: 12,
  },
  primaryButton: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: 'center',
    minHeight: 52,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryButton: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: 'center',
    minHeight: 52,
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
  secondaryButtonText: {
    fontSize: 17,
    fontWeight: '700',
  },
  textButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    minHeight: 44,
  },
  textButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  helpCard: {
    marginTop: 32,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    width: '100%',
    maxWidth: 300,
  },
  helpTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 12,
  },
  helpStep: {
    fontSize: 14,
    lineHeight: 22,
  },
});

export default CameraPermissionDenied;

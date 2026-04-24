import React, { useState, useEffect } from 'react';
import {
  Text,
  View,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { BarCodeScanner } from 'expo-barcode-scanner';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeContext';

type ScannerScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Scanner'>;

interface Props {
  navigation: ScannerScreenNavigationProp;
}

export const ScannerScreen: React.FC<Props> = ({ navigation }) => {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const { colors } = useTheme();

  useEffect(() => {
    const getBarCodeScannerPermissions = async () => {
      const { status } = await BarCodeScanner.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    };

    getBarCodeScannerPermissions();
  }, []);

  const handleBarCodeScanned = ({ type, data }: { type: string; data: string }) => {
    setScanned(true);

    // Check if it's the correct format: soter://package/{id}
    const regex = /^soter:\/\/package\/(.+)$/;
    const match = data.match(regex);

    if (match && match[1]) {
      const aidId = match[1];
      navigation.replace('AidDetails', { aidId });
    } else {
      Alert.alert(
        'Invalid QR Code',
        'This QR code is not a valid Soter package link. Please scan a Soter QR code.',
        [{ text: 'Try Again', onPress: () => setScanned(false) }],
      );
    }
  };

  // ── Permission: requesting ───────────────────────────────────────────────
  if (hasPermission === null) {
    return (
      <View
        style={[styles.container, { backgroundColor: colors.background }]}
        accessible
        accessibilityLabel="Requesting camera permission to scan QR codes"
        accessibilityLiveRegion="polite"
      >
        <Text style={{ color: colors.textPrimary }}>
          Requesting camera permission…
        </Text>
      </View>
    );
  }

  // ── Permission: denied ───────────────────────────────────────────────────
  if (hasPermission === false) {
    return (
      <View
        style={[styles.container, { backgroundColor: colors.background }]}
        accessible
        accessibilityLabel="Camera access denied. Cannot scan QR codes."
      >
        <Text style={{ color: colors.textPrimary, marginBottom: 20 }}>
          No access to camera
        </Text>
        <TouchableOpacity
          style={[styles.permissionButton, { backgroundColor: colors.brand.primary }]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous screen"
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.permissionButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Scanner active ───────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <BarCodeScanner
        onBarCodeScanned={scanned ? undefined : handleBarCodeScanned}
        style={StyleSheet.absoluteFillObject}
        // The camera view itself is not interactive for screen readers;
        // the overlay controls below provide all necessary actions.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />

      <View style={styles.overlay} pointerEvents="box-none">
        {/* Top dim area */}
        <View style={styles.unfocusedContainer} accessibilityElementsHidden />

        {/* Middle row: dim | viewfinder | dim */}
        <View style={styles.focusedContainer}>
          <View style={styles.unfocusedContainer} accessibilityElementsHidden />
          <View
            style={styles.focusedView}
            accessible
            accessibilityLabel="QR code scan area. Align the QR code within this frame."
          />
          <View style={styles.unfocusedContainer} accessibilityElementsHidden />
        </View>

        {/* Bottom dim area with instruction + cancel */}
        <View style={styles.unfocusedContainer}>
          <Text
            style={styles.instructionText}
            accessibilityLiveRegion="polite"
          >
            {scanned ? 'QR code detected' : 'Align QR code within the frame'}
          </Text>

          {!scanned ? (
            <TouchableOpacity
              style={styles.sessionButton}
              accessibilityRole="button"
              accessibilityLabel="Switch to bulk scan session"
              accessibilityHint="Opens session mode optimized for repeated package scans"
              onPress={() => navigation.replace('BulkScanSession')}
            >
              <Text style={styles.sessionText}>Bulk Scan Session</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.cancelButton}
            accessibilityRole="button"
            accessibilityLabel="Cancel scanning"
            accessibilityHint="Closes the scanner and returns to the previous screen"
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Scan-again button — shown after a failed scan */}
      {scanned && (
        <View style={styles.rescanContainer}>
          <TouchableOpacity
            style={[styles.rescanButton, { backgroundColor: colors.brand.primary }]}
            accessibilityRole="button"
            accessibilityLabel="Scan again"
            accessibilityHint="Resets the scanner so you can scan another QR code"
            onPress={() => setScanned(false)}
          >
            <Text style={styles.rescanButtonText}>Tap to Scan Again</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const { width } = Dimensions.get('window');
const scannerSize = width * 0.7;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  unfocusedContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  focusedContainer: {
    height: scannerSize,
    flexDirection: 'row',
  },
  focusedView: {
    width: scannerSize,
    height: scannerSize,
    borderWidth: 2,
    borderColor: '#00FF00',
    backgroundColor: 'transparent',
  },
  instructionText: {
    color: 'white',
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  cancelButton: {
    // Minimum 44×44 pt tap target (WCAG 2.5.5)
    minWidth: 44,
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  sessionButton: {
    minWidth: 44,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 18,
    marginBottom: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sessionText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '700',
  },
  rescanContainer: {
    position: 'absolute',
    bottom: 50,
  },
  rescanButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    // Minimum 44 pt height
    minHeight: 44,
    borderRadius: 8,
    alignItems: 'center',
  },
  rescanButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  permissionButton: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    // Minimum 44 pt height
    minHeight: 44,
    borderRadius: 8,
    alignItems: 'center',
  },
  permissionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

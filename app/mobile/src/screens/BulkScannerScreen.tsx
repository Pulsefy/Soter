import React, { useState, useEffect, useCallback } from 'react';
import {
  Text,
  View,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { BarCodeScanner } from 'expo-barcode-scanner';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useTheme } from '../theme/ThemeContext';
import { useSync } from '../contexts/SyncContext';

type BulkScannerScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'BulkScanner'>;

interface Props {
  navigation: BulkScannerScreenNavigationProp;
}

interface SessionStats {
  scanned: number;
  verified: number;
  failed: number;
  skipped: number;
}

export const BulkScannerScreen: React.FC<Props> = ({ navigation }) => {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastScanResult, setLastScanResult] = useState<{ status: 'success' | 'error'; message: string } | null>(null);
  const [stats, setStats] = useState<SessionStats>({
    scanned: 0,
    verified: 0,
    failed: 0,
    skipped: 0,
  });

  const { colors } = useTheme();
  const { queueClaimConfirmation, isConnected } = useSync();

  useEffect(() => {
    const getBarCodeScannerPermissions = async () => {
      const { status } = await BarCodeScanner.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    };

    getBarCodeScannerPermissions();
  }, []);

  const handleBarCodeScanned = async ({ type, data }: { type: string; data: string }) => {
    if (isProcessing) return;
    setIsProcessing(true);

    // Check if it's the correct format: soter://package/{id}
    const regex = /^soter:\/\/package\/(.+)$/;
    const match = data.match(regex);

    setStats(prev => ({ ...prev, scanned: prev.scanned + 1 }));

    if (match && match[1]) {
      const aidId = match[1];
      const claimId = `claim-${aidId}`; // Assuming standard claimId format for bulk verify

      try {
        const result = await queueClaimConfirmation(aidId, claimId);
        
        if (result.status === 'completed' || result.status === 'queued') {
          setStats(prev => ({ ...prev, verified: prev.verified + 1 }));
          setLastScanResult({ 
            status: 'success', 
            message: result.status === 'completed' ? 'Package verified successfully!' : 'Package queued for verification (offline).'
          });
        }
      } catch (error) {
        setStats(prev => ({ ...prev, failed: prev.failed + 1 }));
        setLastScanResult({ status: 'error', message: 'Verification failed. Please try again.' });
      }
    } else {
      setStats(prev => ({ ...prev, failed: prev.failed + 1 }));
      setLastScanResult({ status: 'error', message: 'Invalid Soter QR code.' });
    }

    // Short delay before allowing the next scan to provide feedback
    setTimeout(() => {
      setIsProcessing(false);
      setLastScanResult(null);
    }, 2000);
  };

  if (hasPermission === null) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textPrimary }}>Requesting camera permission…</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textPrimary, marginBottom: 20 }}>No access to camera</Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.brand.primary }]}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <BarCodeScanner
        onBarCodeScanned={isProcessing ? undefined : handleBarCodeScanned}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={styles.overlay} pointerEvents="box-none">
        {/* Stats Header */}
        <View style={styles.statsHeader}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats.scanned}</Text>
            <Text style={styles.statLabel}>Scanned</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.success }]}>{stats.verified}</Text>
            <Text style={styles.statLabel}>Verified</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.error }]}>{stats.failed}</Text>
            <Text style={styles.statLabel}>Failed</Text>
          </View>
        </View>

        <View style={styles.viewfinderContainer}>
           <View style={[styles.viewfinder, isProcessing && styles.viewfinderProcessing]} />
        </View>

        {/* Feedback Area */}
        <View style={styles.feedbackContainer}>
          {isProcessing && !lastScanResult && (
            <View style={styles.processingIndicator}>
              <ActivityIndicator color="white" size="small" />
              <Text style={styles.processingText}>Processing...</Text>
            </View>
          )}

          {lastScanResult && (
            <View style={[
              styles.resultBadge, 
              { backgroundColor: lastScanResult.status === 'success' ? colors.success : colors.error }
            ]}>
              <Text style={styles.resultText}>{lastScanResult.message}</Text>
            </View>
          )}

          {!isProcessing && !lastScanResult && (
            <Text style={styles.instructionText}>Align QR code to scan</Text>
          )}

          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.closeButtonText}>End Session</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const { width } = Dimensions.get('window');
const scannerSize = width * 0.7;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    paddingVertical: 40,
  },
  statsHeader: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.7)',
    marginHorizontal: 20,
    padding: 15,
    borderRadius: 15,
    justifyContent: 'space-around',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
  },
  statLabel: {
    fontSize: 10,
    color: '#aaa',
    textTransform: 'uppercase',
    marginTop: 2,
  },
  viewfinderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewfinder: {
    width: scannerSize,
    height: scannerSize,
    borderWidth: 2,
    borderColor: '#00FF00',
    borderRadius: 20,
    backgroundColor: 'transparent',
  },
  viewfinderProcessing: {
    borderColor: '#FFD700',
    borderStyle: 'dashed',
  },
  feedbackContainer: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  instructionText: {
    color: 'white',
    fontSize: 16,
    marginBottom: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
  },
  processingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 25,
    marginBottom: 20,
    gap: 10,
  },
  processingText: {
    color: 'white',
    fontWeight: '600',
  },
  resultBadge: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 20,
    width: '100%',
    alignItems: 'center',
  },
  resultText: {
    color: 'white',
    fontWeight: '700',
    textAlign: 'center',
  },
  closeButton: {
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  closeButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

import React from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

interface WalletConnectModalProps {
  visible: boolean;
  uri: string | null;
  onClose: () => void;
  onCopyUri?: () => void;
}

export const WalletConnectModal: React.FC<WalletConnectModalProps> = ({
  visible,
  uri,
  onClose,
  onCopyUri,
}) => {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContent}>
          <Text style={styles.title}>Connect Wallet</Text>
          <Text style={styles.subtitle}>
            Scan this QR code with your Stellar wallet (LOBSTR, Beans, etc.)
          </Text>

          {uri ? (
            <View style={styles.qrContainer}>
              <QRCode
                value={uri}
                size={250}
                backgroundColor="white"
                color="black"
              />
            </View>
          ) : (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#007AFF" />
              <Text style={styles.loadingText}>Generating connection...</Text>
            </View>
          )}

          {uri && (
            <View style={styles.uriContainer}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Text style={styles.uriText} numberOfLines={1}>
                  {uri}
                </Text>
              </ScrollView>
            </View>
          )}

          <View style={styles.buttonContainer}>
            {onCopyUri && uri && (
              <TouchableOpacity style={styles.copyButton} onPress={onCopyUri}>
                <Text style={styles.copyButtonText}>Copy URI</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 24,
    width: '90%',
    maxWidth: 400,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#000',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  qrContainer: {
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: '#666',
  },
  uriContainer: {
    width: '100%',
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    marginBottom: 16,
    maxHeight: 60,
  },
  uriText: {
    fontSize: 10,
    color: '#333',
    fontFamily: 'monospace',
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  copyButton: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  copyButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
  closeButton: {
    flex: 1,
    backgroundColor: '#007AFF',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
});


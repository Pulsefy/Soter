import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Clipboard from '@react-native-clipboard/clipboard';
import type { RootStackParamList } from '../navigation/types';
import { useWalletConnect } from '../hooks/useWalletConnect';
import { WalletConnectModal } from '../components/WalletConnectModal';

type HomeScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

interface Props {
  navigation: HomeScreenNavigationProp;
}

export const HomeScreen: React.FC<Props> = ({ navigation }) => {
  const {
    session,
    publicKey,
    isConnecting,
    error,
    connect,
    waitForSession,
    disconnect,
    initialize,
  } = useWalletConnect();

  const [modalVisible, setModalVisible] = useState(false);
  const [connectionUri, setConnectionUri] = useState<string | null>(null);

  useEffect(() => {
    // Initialize WalletConnect on mount (non-blocking)
    initialize().catch((err) => {
      // Silently handle initialization errors - app should still work
      console.warn('WalletConnect initialization warning:', err.message);
    });
  }, [initialize]);

  useEffect(() => {
    if (error) {
      Alert.alert('Connection Error', error);
    }
  }, [error]);

  useEffect(() => {
    // Close modal when session is established
    if (session && publicKey && modalVisible) {
      setModalVisible(false);
      setConnectionUri(null);
    }
  }, [session, publicKey, modalVisible]);

  const handleConnectWallet = async () => {
    try {
      setModalVisible(true);
      const uri = await connect();
      setConnectionUri(uri);
      
      // Wait for session to be established after wallet approves
      waitForSession().catch((err) => {
        console.error('Connection failed:', err);
        // Don't show error immediately - user might still be scanning
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create connection';
      let userMessage = errorMessage;
      
      // Provide helpful message if Project ID is missing
      if (errorMessage.includes('Project ID')) {
        userMessage = 'WalletConnect Project ID not configured. Please set EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID in your .env file or edit src/services/walletConnect.ts';
      }
      
      Alert.alert('Connection Error', userMessage);
      setModalVisible(false);
    }
  };

  const handleCopyUri = async () => {
    if (connectionUri) {
      Clipboard.setString(connectionUri);
      Alert.alert('Copied', 'Connection URI copied to clipboard');
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
      Alert.alert('Disconnected', 'Wallet disconnected successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to disconnect';
      Alert.alert('Error', errorMessage);
    }
  };

  const formatPublicKey = (key: string | undefined) => {
    if (!key) return '';
    if (key.length <= 12) return key;
    return `${key.slice(0, 6)}...${key.slice(-6)}`;
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Soter Mobile</Text>
      <Text style={styles.subtitle}>Transparent aid, directly delivered.</Text>

      {session && publicKey ? (
        <View style={styles.walletInfo}>
          <View style={styles.connectedBadge}>
            <View style={styles.connectedDot} />
            <Text style={styles.connectedText}>Wallet Connected</Text>
          </View>
          <View style={styles.publicKeyContainer}>
            <Text style={styles.publicKeyLabel}>Public Key:</Text>
            <Text style={styles.publicKeyValue} selectable>
              {publicKey}
            </Text>
            <Text style={styles.publicKeyShort}>
              {formatPublicKey(publicKey)}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.button, styles.disconnectButton]}
            onPress={handleDisconnect}
          >
            <Text style={styles.disconnectButtonText}>Disconnect Wallet</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.button, styles.connectButton]}
          onPress={handleConnectWallet}
          disabled={isConnecting}
        >
          {isConnecting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.connectButtonText}>Connect Wallet</Text>
          )}
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[styles.button, styles.secondaryButton]}
        onPress={() => navigation.navigate('Health')}
      >
        <Text style={styles.secondaryButtonText}>Check Backend Health</Text>
      </TouchableOpacity>

      <WalletConnectModal
        visible={modalVisible}
        uri={connectionUri}
        onClose={() => {
          setModalVisible(false);
          setConnectionUri(null);
        }}
        onCopyUri={handleCopyUri}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 30,
  },
  button: {
    width: '100%',
    maxWidth: 300,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  connectButton: {
    backgroundColor: '#007AFF',
  },
  connectButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#f0f0f0',
  },
  secondaryButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: '600',
  },
  walletInfo: {
    width: '100%',
    maxWidth: 300,
    marginBottom: 20,
  },
  connectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8f5e9',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  connectedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4caf50',
    marginRight: 8,
  },
  connectedText: {
    color: '#2e7d32',
    fontSize: 14,
    fontWeight: '600',
  },
  publicKeyContainer: {
    backgroundColor: '#f5f5f5',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
  },
  publicKeyLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
    fontWeight: '600',
  },
  publicKeyValue: {
    fontSize: 12,
    color: '#333',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  publicKeyShort: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '600',
  },
  disconnectButton: {
    backgroundColor: '#ff3b30',
  },
  disconnectButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

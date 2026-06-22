import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  SafeAreaView,
  TouchableOpacity,
  Platform,
  Clipboard,
  Alert,
} from 'react-native';
import Constants from 'expo-constants';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { fetchHealthStatus, HealthStatus } from '../services/api';
import { getMockHealthData } from '../services/mockData';
import { useTheme } from '../theme/ThemeContext';
import { AppColors } from '../theme/useAppTheme';

import { config } from '../config';

// Derive environment label from config
const getEnvLabel = (): string => config.envName;

const getEnvBadgeColor = (label: string): string => {
  switch (label.toLowerCase()) {
    case 'prod':
    case 'production':
      return '#C62828'; // red
    case 'staging':
      return '#F57F17'; // amber
    default:
      return '#1565C0'; // blue – dev / local
  }
};

export const HealthScreen = () => {
  const [healthData, setHealthData] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [isMockData, setIsMockData] = useState(false);
  const [netInfo, setNetInfo] = useState<NetInfoState | null>(null);
  const [apiReachable, setApiReachable] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);

  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const envLabel = getEnvLabel();
  const envBadgeColor = getEnvBadgeColor(envLabel);
  const apiUrl = config.apiUrl;
  const shortApiUrl = (() => {
    try {
      return new URL(apiUrl).host;
    } catch {
      return apiUrl;
    }
  })();

  const loadHealthData = async (showRefreshing = false) => {
    try {
      setError(null);
      if (!showRefreshing) setLoading(true);

      try {
        const data = await fetchHealthStatus();
        setHealthData(data);
        setIsMockData(false);
        setApiReachable(true);
      } catch (err) {
        console.log('Using mock data fallback');
        setHealthData(getMockHealthData());
        setIsMockData(true);
        setError('Backend unreachable - showing mock data');
        setApiReachable(false);
      }
    } catch (err) {
      setError('Failed to load health data');
      setApiReachable(false);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadHealthData();

    // Fetch initial network state
    if (process.env.NODE_ENV === 'test') {
      setNetInfo({
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
        details: { isConnectionExpensive: false },
      } as any);
    } else {
      void NetInfo.fetch().then((state) => {
        setNetInfo(state);
      });
    }

    // Subscribe to network state changes
    const unsubscribe = NetInfo.addEventListener((state) => {
      setNetInfo(state);
    });

    return () => unsubscribe();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadHealthData(true);
  };

  const appVersion = Constants.expoConfig?.version || '1.0.0';

  const handleCopyDiagnostics = async () => {
    const formattedNetworkType = netInfo?.type ? netInfo.type.toUpperCase() : 'UNKNOWN';
    const formattedInternetReachable = netInfo?.isInternetReachable === true 
      ? 'Yes' 
      : netInfo?.isInternetReachable === false 
        ? 'No' 
        : 'Unknown';
    const formattedApiReachable = apiReachable === true 
      ? 'Reachable' 
      : apiReachable === false 
        ? 'Unreachable' 
        : 'Checking...';

    const diagnosticsText = `Soter App Diagnostics
---------------------
App Version: ${appVersion}
Platform: ${Platform.OS === 'android' ? 'Android' : 'iOS'}
Environment: ${envLabel}
API URL: ${apiUrl}
API Reachability: ${formattedApiReachable}
Network Connected: ${netInfo?.isConnected ? 'Yes' : 'No'}
Network Type: ${formattedNetworkType}
Internet Reachable: ${formattedInternetReachable}
Contract ID: ${config.sorobanContractId || 'None'}
Timestamp: ${new Date().toISOString()}`;

    try {
      await Clipboard.setString(diagnosticsText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      Alert.alert('Error', 'Failed to copy diagnostics');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ok':
        return colors.success;
      default:
        return colors.warning;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ok':
        return '✅';
      default:
        return '⚠️';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch (e) {
      return new Date().toLocaleString();
    }
  };

  if (loading) {
    return (
      <View
        style={styles.centered}
        accessible
        accessibilityLabel="Loading system health data"
        accessibilityLiveRegion="polite"
      >
        {/* Third-party: ActivityIndicator uses brand.primary for consistent branding */}
        <ActivityIndicator
          size="large"
          color={colors.brand.primary}
          accessibilityElementsHidden
        />
        <Text style={styles.loadingText}>Checking system health...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        refreshControl={
          // Third-party: RefreshControl tintColor / colors aligned to brand
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brand.primary}
            colors={[colors.brand.primary]}
            accessibilityLabel="Pull to refresh health data"
          />
        }
      >
        <View style={styles.content}>
          {/* ── Header ─────────────────────────────────────────────────── */}
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              System Health
            </Text>
            <View style={styles.headerBadges}>
              {/* Environment badge */}
              <View
                testID="env-badge"
                style={[styles.envBadge, { backgroundColor: envBadgeColor }]}
                accessible
                accessibilityLabel={`Environment: ${envLabel}`}
              >
                <Text
                  style={styles.envBadgeText}
                  importantForAccessibility="no-hide-descendants"
                >
                  {envLabel.toUpperCase()}
                </Text>
              </View>
              {isMockData && (
                <View
                  style={styles.mockBadge}
                  accessible
                  accessibilityLabel="Using mock data"
                >
                  <Text
                    style={styles.mockBadgeText}
                    importantForAccessibility="no-hide-descendants"
                  >
                    🔧 MOCK
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* ── Error message ───────────────────────────────────────────── */}
          {error && (
            <View
              style={styles.errorContainer}
              accessible
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              accessibilityLabel={error}
            >
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* ── Configuration Errors ────────────────────────────────────────── */}
          {!config.isValid && (
            <View
              style={styles.configErrorContainer}
              accessible
              accessibilityRole="alert"
            >
              <Text style={styles.configErrorTitle}>⚠️ Configuration Issues</Text>
              {config.errors.map((err, index) => (
                <Text key={index} style={styles.configErrorText}>• {err}</Text>
              ))}
            </View>
          )}

          {/* ── Environment & Blockchain Section ─────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              Environment & Blockchain
            </Text>
            <View style={styles.card}>
              <View style={styles.infoRow} accessible accessibilityLabel={`Network: ${config.network}`}>
                <Text style={styles.infoLabel}>Network:</Text>
                <Text style={styles.infoValue}>{config.network.toUpperCase()}</Text>
              </View>

              <View style={styles.infoRow} accessible accessibilityLabel={`API URL: ${config.apiUrl}`}>
                <Text style={styles.infoLabel}>Backend URL:</Text>
                <Text style={styles.infoValue} numberOfLines={1} ellipsizeMode="middle">
                  {config.apiUrl}
                </Text>
              </View>

              <View style={styles.infoRow} accessible accessibilityLabel={`Contract ID: ${config.sorobanContractId || 'Not Configured'}`}>
                <Text style={styles.infoLabel}>Contract ID:</Text>
                <Text style={[styles.infoValue, !config.sorobanContractId && { color: colors.warning }]} numberOfLines={1} ellipsizeMode="middle">
                  {config.sorobanContractId || 'None'}
                </Text>
              </View>

              <View style={styles.infoRow} accessible accessibilityLabel={`Config Status: ${config.isValid ? 'Valid' : 'Invalid'}`}>
                <Text style={styles.infoLabel}>Config Status:</Text>
                <Text style={[styles.infoValue, { color: config.isValid ? colors.success : colors.error }]}>
                  {config.isValid ? 'VALID ✅' : 'INVALID ❌'}
                </Text>
              </View>
            </View>
          </View>

          {/* ── Health Data Card ────────────────────────────────────────── */}
          {healthData && (
            <View
              style={[
                styles.card,
                { borderLeftColor: getStatusColor(healthData.status) },
              ]}
              accessible
              accessibilityLabel={`Backend status: ${healthData.status.toUpperCase()}. Service: ${healthData.service}. Version: ${healthData.version}. Environment: ${healthData.environment}.`}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Backend Status</Text>
                <View
                  style={styles.statusBadge}
                  accessible
                  accessibilityLabel={`Status: ${healthData.status.toUpperCase()}`}
                >
                  <Text
                    style={styles.statusIcon}
                    accessibilityElementsHidden
                  >
                    {getStatusIcon(healthData.status)}
                  </Text>
                  <Text
                    style={[
                      styles.statusText,
                      { color: getStatusColor(healthData.status) },
                    ]}
                  >
                    {healthData.status.toUpperCase()}
                  </Text>
                </View>
              </View>

              <View style={styles.infoRow} accessible accessibilityLabel={`Service: ${healthData.service}`}>
                <Text style={styles.infoLabel} importantForAccessibility="no-hide-descendants">Service:</Text>
                <Text style={styles.infoValue} importantForAccessibility="no-hide-descendants">{healthData.service}</Text>
              </View>

              <View style={styles.infoRow} accessible accessibilityLabel={`Version: ${healthData.version}`}>
                <Text style={styles.infoLabel} importantForAccessibility="no-hide-descendants">Version:</Text>
                <Text style={styles.infoValue} importantForAccessibility="no-hide-descendants">{healthData.version}</Text>
              </View>

              <View style={styles.infoRow} accessible accessibilityLabel={`Environment: ${healthData.environment}`}>
                <Text style={styles.infoLabel} importantForAccessibility="no-hide-descendants">Environment:</Text>
                <Text style={styles.infoValue} importantForAccessibility="no-hide-descendants">{healthData.environment}</Text>
              </View>

              <View style={styles.infoRow} accessible accessibilityLabel={`Last updated: ${formatTimestamp(healthData.timestamp)}`}>
                <Text style={styles.infoLabel} importantForAccessibility="no-hide-descendants">Last updated:</Text>
                <Text style={styles.infoValue} importantForAccessibility="no-hide-descendants">
                  {formatTimestamp(healthData.timestamp)}
                </Text>
              </View>

              {isMockData && (
                <View
                  style={styles.insideMockIndicator}
                  accessible
                  accessibilityRole="alert"
                  accessibilityLabel="Warning: This is simulated data. Backend connection failed."
                >
                  <Text style={styles.insideMockText} importantForAccessibility="no-hide-descendants">
                    ⚠️ This is simulated data - backend connection failed
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* ── Safe Diagnostics Section ─────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              Diagnostics
            </Text>
            <View style={styles.card}>
              <View style={styles.infoRow} accessible accessibilityLabel={`App Version: ${appVersion}`}>
                <Text style={styles.infoLabel}>App Version:</Text>
                <Text style={styles.infoValue}>{appVersion}</Text>
              </View>

              <View style={styles.infoRow} accessible accessibilityLabel={`API Reachability: ${apiReachable === true ? 'Reachable' : apiReachable === false ? 'Unreachable' : 'Checking...'}`}>
                <Text style={styles.infoLabel}>API Reachability:</Text>
                <Text style={[styles.infoValue, { color: apiReachable === true ? colors.success : apiReachable === false ? colors.error : colors.textSecondary }]}>
                  {apiReachable === true ? 'REACHABLE ✅' : apiReachable === false ? 'UNREACHABLE ❌' : 'CHECKING...'}
                </Text>
              </View>

              <View style={styles.infoRow} accessible accessibilityLabel={`Network Connection: ${netInfo?.isConnected ? 'Connected' : 'Disconnected'}`}>
                <Text style={styles.infoLabel}>Network Status:</Text>
                <Text style={[styles.infoValue, { color: netInfo?.isConnected ? colors.success : colors.error }]}>
                  {netInfo?.isConnected ? 'CONNECTED' : 'DISCONNECTED'}
                </Text>
              </View>

              <View style={styles.infoRow} accessible accessibilityLabel={`Network Type: ${netInfo?.type ? netInfo.type.toUpperCase() : 'UNKNOWN'}`}>
                <Text style={styles.infoLabel}>Network Type:</Text>
                <Text style={styles.infoValue}>{netInfo?.type ? netInfo.type.toUpperCase() : 'UNKNOWN'}</Text>
              </View>

              <View style={styles.infoRow} accessible accessibilityLabel={`Internet Reachable: ${netInfo?.isInternetReachable === true ? 'Yes' : netInfo?.isInternetReachable === false ? 'No' : 'Unknown'}`}>
                <Text style={styles.infoLabel}>Internet Reachable:</Text>
                <Text style={[styles.infoValue, { color: netInfo?.isInternetReachable === true ? colors.success : netInfo?.isInternetReachable === false ? colors.error : colors.textSecondary }]}>
                  {netInfo?.isInternetReachable === true ? 'YES' : netInfo?.isInternetReachable === false ? 'NO' : 'UNKNOWN'}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.copyButton, copied && styles.copyButtonActive]}
              accessibilityRole="button"
              accessibilityLabel="Copy Diagnostics to Clipboard"
              accessibilityHint="Copies non-sensitive diagnostics information to your clipboard for debugging"
              onPress={handleCopyDiagnostics}
              activeOpacity={0.8}
            >
              <Text style={[styles.copyButtonText, copied && { color: colors.success }]}>
                {copied ? '✅ Diagnostics Copied!' : '📋 Copy Diagnostics'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── Quick Stats ─────────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              Quick Info
            </Text>

            <View style={styles.statsGrid}>
              <View
                style={styles.statItem}
                accessible
                accessibilityLabel={`Platform: ${Platform.OS === 'android' ? 'Android' : 'iOS'}`}
              >
                <Text style={styles.statLabel} importantForAccessibility="no-hide-descendants">Platform</Text>
                <Text style={styles.statValue} importantForAccessibility="no-hide-descendants">
                  {Platform.OS === 'android' ? 'Android' : 'iOS'}
                </Text>
              </View>

              <View
                style={styles.statItem}
                accessible
                accessibilityLabel={`Last check: ${healthData ? formatTimestamp(healthData.timestamp).split(',')[0] : 'Not available'}`}
              >
                <Text style={styles.statLabel} importantForAccessibility="no-hide-descendants">Last Check</Text>
                <Text style={styles.statValue} importantForAccessibility="no-hide-descendants">
                  {healthData
                    ? formatTimestamp(healthData.timestamp).split(',')[0]
                    : 'N/A'}
                </Text>
              </View>
            </View>
          </View>

          {/* ── Troubleshooting Tips ────────────────────────────────────── */}
          {isMockData && (
            <View style={styles.tipsContainer} accessible accessibilityRole="summary">
              <Text style={styles.tipsTitle} accessibilityRole="header">
                🔍 Troubleshooting Tips
              </Text>
              <Text style={styles.tipText}>
                • Ensure backend server is running on port 3000
              </Text>
              <Text style={styles.tipText}>
                • Check if API URL is correct:{' '}
                {config.apiUrl}
              </Text>
              <Text style={styles.tipText}>
                • For Android emulator, use 10.0.2.2 instead of localhost
              </Text>
              <Text style={styles.tipText}>
                • Try restarting the backend server
              </Text>
            </View>
          )}

          {/* ── Retry Button ────────────────────────────────────────────── */}
          {error && (
            <TouchableOpacity
              style={styles.retryButton}
              accessibilityRole="button"
              accessibilityLabel="Retry connection"
              accessibilityHint="Attempts to reconnect to the backend server"
              onPress={() => loadHealthData()}
            >
              <Text style={styles.retryButtonText}>🔄 Retry Connection</Text>
            </TouchableOpacity>
          )}

          {/* ── Footer ──────────────────────────────────────────────────── */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              {isMockData ? '📊 Using simulated data' : '🌐 Live backend data'}
            </Text>
            <Text style={styles.footerSubText}>
              {!isMockData && 'Data fetched from /health endpoint'}
            </Text>
            <View
              style={styles.footerEnvRow}
              testID="footer-env-row"
              accessibilityLabel={`Environment: ${envLabel} · ${shortApiUrl}`}
            >
              <Text style={styles.footerEnvLabel}>
                Environment:{' '}
              </Text>
              <Text
                testID="footer-env-name"
                style={[styles.footerEnvValue, { color: envBadgeColor }]}
              >
                {envLabel}
              </Text>
              <Text style={styles.footerEnvSeparator}>
                {' '}·{' '}
              </Text>
              <Text
                testID="footer-api-url"
                style={styles.footerEnvUrl}
                numberOfLines={1}
              >
                {shortApiUrl}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
    },
    loadingText: {
      marginTop: 10,
      fontSize: 16,
      color: colors.textSecondary,
    },
    content: {
      padding: 16,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    title: {
      fontSize: 28,
      fontWeight: 'bold',
      color: colors.textPrimary,
    },
    mockBadge: {
      backgroundColor: colors.warning,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
    },
    mockBadgeText: {
      color: '#fff',
      fontWeight: 'bold',
      fontSize: 12,
    },
    errorContainer: {
      backgroundColor: colors.errorBg,
      padding: 12,
      borderRadius: 8,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.errorBorder,
    },
    errorText: {
      color: colors.error,
      fontSize: 14,
    },
    configErrorContainer: {
      backgroundColor: colors.errorBg,
      padding: 16,
      borderRadius: 12,
      marginBottom: 20,
      borderWidth: 1,
      borderColor: colors.errorBorder,
    },
    configErrorTitle: {
      color: colors.error,
      fontSize: 16,
      fontWeight: 'bold',
      marginBottom: 8,
    },
    configErrorText: {
      color: colors.error,
      fontSize: 14,
      marginBottom: 4,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 3,
      borderLeftWidth: 4,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    cardTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    statusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    statusIcon: {
      fontSize: 16,
      marginRight: 4,
    },
    statusText: {
      fontSize: 16,
      fontWeight: 'bold',
    },
    infoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 4,
    },
    infoLabel: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    infoValue: {
      fontSize: 14,
      color: colors.textPrimary,
      fontWeight: '500',
    },
    insideMockIndicator: {
      marginTop: 12,
      padding: 8,
      backgroundColor: colors.warningBg,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.warningBorder,
    },
    insideMockText: {
      color: colors.warning,
      fontSize: 12,
      fontWeight: '500',
      textAlign: 'center',
    },
    section: {
      marginTop: 8,
      marginBottom: 16,
    },
    sectionTitle: {
      fontSize: 20,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: 12,
    },
    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },
    statItem: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      padding: 14,
      width: '48%',
      marginBottom: 10,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 2,
    },
    statLabel: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 4,
    },
    statValue: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    tipsContainer: {
      backgroundColor: colors.infoBg,
      padding: 16,
      borderRadius: 12,
      marginBottom: 20,
    },
    tipsTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.info,
      marginBottom: 10,
    },
    tipText: {
      fontSize: 13,
      color: colors.textPrimary,
      marginBottom: 6,
      lineHeight: 18,
    },
    retryButton: {
      backgroundColor: colors.brand.primary,
      padding: 16,
      // Minimum 44 pt height (WCAG 2.5.5)
      minHeight: 44,
      borderRadius: 12,
      alignItems: 'center',
      marginBottom: 20,
    },
    retryButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
    headerBadges: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    envBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
    },
    envBadgeText: {
      color: '#fff',
      fontWeight: 'bold',
      fontSize: 11,
      letterSpacing: 0.5,
    },
    footer: {
      marginTop: 20,
      paddingVertical: 10,
      alignItems: 'center',
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    footerText: {
      fontSize: 14,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    footerSubText: {
      fontSize: 11,
      color: colors.textMuted,
      marginTop: 4,
    },
    footerEnvRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 8,
      flexWrap: 'nowrap',
    },
    footerEnvLabel: {
      fontSize: 11,
      color: colors.textMuted,
    },
    footerEnvValue: {
      fontSize: 11,
      fontWeight: '700',
    },
    footerEnvSeparator: {
      fontSize: 11,
      color: colors.textMuted,
    },
    footerEnvUrl: {
      fontSize: 11,
      color: colors.textSecondary,
      flexShrink: 1,
    },
    copyButton: {
      backgroundColor: colors.infoBg,
      borderColor: colors.border,
      borderWidth: 1,
      padding: 14,
      minHeight: 44,
      borderRadius: 12,
      alignItems: 'center',
      marginTop: 8,
      marginBottom: 12,
    },
    copyButtonActive: {
      backgroundColor: colors.background === '#0F172A' ? '#14532D' : '#DCFCE7',
      borderColor: colors.success,
    },
    copyButtonText: {
      color: colors.info,
      fontSize: 16,
      fontWeight: '600',
    },
  });

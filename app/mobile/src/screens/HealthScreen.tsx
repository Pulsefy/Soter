import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  SafeAreaView,
  TouchableOpacity,
  Platform
} from 'react-native';
import { fetchHealthStatus, HealthStatus } from '../services/api';
import { getMockHealthData } from '../services/mockData';

export const HealthScreen = () => {
  const [healthData, setHealthData] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [isMockData, setIsMockData] = useState(false);

  const loadHealthData = async (showRefreshing = false) => {
    try {
      setError(null);
      if (!showRefreshing) setLoading(true);
      
      try {
        const data = await fetchHealthStatus();
        setHealthData(data);
        setIsMockData(false);
      } catch (err) {
        // Fallback to mock data when backend is unreachable
        console.log('Using mock data fallback');
        setHealthData(getMockHealthData());
        setIsMockData(true);
        setError('Backend unreachable - showing mock data');
      }
    } catch (err) {
      setError('Failed to load health data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadHealthData();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadHealthData(true);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ok':
        return '#4CAF50';
      default:
        return '#FF9800'; // Orange for any non-ok status
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
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text style={styles.loadingText}>Checking system health...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>System Health</Text>
            {isMockData && (
              <View style={styles.mockBadge}>
                <Text style={styles.mockBadgeText}>🔧 MOCK DATA</Text>
              </View>
            )}
          </View>

          {/* Error message if any */}
          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Health Data Card */}
          {healthData && (
            <View style={[
              styles.card,
              { borderLeftColor: getStatusColor(healthData.status) }
            ]}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Backend Status</Text>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusIcon}>
                    {getStatusIcon(healthData.status)}
                  </Text>
                  <Text style={[
                    styles.statusText,
                    { color: getStatusColor(healthData.status) }
                  ]}>
                    {healthData.status.toUpperCase()}
                  </Text>
                </View>
              </View>

              {/* Service Info */}
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Service:</Text>
                <Text style={styles.infoValue}>{healthData.service}</Text>
              </View>

              {/* Version */}
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Version:</Text>
                <Text style={styles.infoValue}>{healthData.version}</Text>
              </View>

              {/* Environment */}
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Environment:</Text>
                <Text style={styles.infoValue}>{healthData.environment}</Text>
              </View>

              {/* Timestamp */}
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Last updated:</Text>
                <Text style={styles.infoValue}>
                  {formatTimestamp(healthData.timestamp)}
                </Text>
              </View>

              {/* Mock indicator inside card for extra visibility */}
              {isMockData && (
                <View style={styles.insideMockIndicator}>
                  <Text style={styles.insideMockText}>
                    ⚠️ This is simulated data - backend connection failed
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Quick Stats Section - Since we don't have nested services, 
              we can show additional helpful info */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Quick Info</Text>
            
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>API URL</Text>
                <Text style={styles.statValue} numberOfLines={1}>
                  {process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000'}
                </Text>
              </View>
              
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Platform</Text>
                <Text style={styles.statValue}>
                  {Platform.OS === 'android' ? 'Android' : 'iOS'}
                </Text>
              </View>
              
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>Last Check</Text>
                <Text style={styles.statValue}>
                  {healthData ? formatTimestamp(healthData.timestamp).split(',')[0] : 'N/A'}
                </Text>
              </View>
            </View>
          </View>

          {/* Troubleshooting Tips - Only show when mock data */}
          {isMockData && (
            <View style={styles.tipsContainer}>
              <Text style={styles.tipsTitle}>🔍 Troubleshooting Tips</Text>
              <Text style={styles.tipText}>• Ensure backend server is running on port 3000</Text>
              <Text style={styles.tipText}>• Check if API URL is correct: {process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000'}</Text>
              <Text style={styles.tipText}>• For Android emulator, use 10.0.2.2 instead of localhost</Text>
              <Text style={styles.tipText}>• Try restarting the backend server</Text>
            </View>
          )}

          {/* Retry Button for Error State */}
          {error && (
            <TouchableOpacity style={styles.retryButton} onPress={() => loadHealthData()}>
              <Text style={styles.retryButtonText}>🔄 Retry Connection</Text>
            </TouchableOpacity>
          )}

          {/* Data Source Indicator */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              {isMockData ? '📊 Using simulated data' : '🌐 Live backend data'}
            </Text>
            <Text style={styles.footerSubText}>
              {!isMockData && 'Data fetched from /health endpoint'}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
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
    color: '#333',
  },
  mockBadge: {
    backgroundColor: '#FF9800',
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
    backgroundColor: '#FFEBEE',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  errorText: {
    color: '#D32F2F',
    fontSize: 14,
  },
  card: {
    backgroundColor: '#fff',
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
    color: '#333',
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
    color: '#666',
  },
  infoValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  insideMockIndicator: {
    marginTop: 12,
    padding: 8,
    backgroundColor: '#FFF3E0',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FFE0B2',
  },
  insideMockText: {
    color: '#F57C00',
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
    color: '#333',
    marginBottom: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statItem: {
    backgroundColor: '#fff',
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
    color: '#666',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  tipsContainer: {
    backgroundColor: '#E3F2FD',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  tipsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1976D2',
    marginBottom: 10,
  },
  tipText: {
    fontSize: 13,
    color: '#333',
    marginBottom: 6,
    lineHeight: 18,
  },
  retryButton: {
    backgroundColor: '#2196F3',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 20,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    marginTop: 20,
    paddingVertical: 10,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  footerText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  footerSubText: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
  },
});

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Button } from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

export const HealthScreen: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [healthData, setHealthData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/health`);
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }
      const data = await response.json();
      setHealthData(data);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to fetch health status');
      // Mock data if backend is offline
      setHealthData({
        status: 'ok',
        info: { database: { status: 'up' } },
        error: {},
        details: { database: { status: 'up' } },
        mocked: true,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>System Health</Text>
      
      {loading ? (
        <ActivityIndicator size="large" color="#0000ff" />
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Error: {error}</Text>
          <Text style={styles.mockHint}>Using mock data for demonstration</Text>
          {healthData && (
            <View style={styles.dataContainer}>
              <Text>Status: {healthData.status}</Text>
              <Text>Mocked: Yes</Text>
            </View>
          )}
          <Button title="Retry" onPress={fetchHealth} />
        </View>
      ) : healthData ? (
        <View style={styles.dataContainer}>
          <Text style={styles.statusText}>Status: {healthData.status}</Text>
          <Text>Version: {healthData.version || '1.0.0'}</Text>
          <Text>Timestamp: {new Date().toLocaleTimeString()}</Text>
          <Button title="Refresh" onPress={fetchHealth} />
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  statusText: {
    fontSize: 18,
    color: 'green',
    marginBottom: 10,
  },
  errorContainer: {
    alignItems: 'center',
  },
  errorText: {
    color: 'red',
    marginBottom: 10,
  },
  mockHint: {
    fontStyle: 'italic',
    color: '#666',
    marginBottom: 10,
  },
  dataContainer: {
    padding: 15,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    width: '100%',
    marginBottom: 20,
  },
});

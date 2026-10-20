import React from 'react';
import { render, waitFor, screen, fireEvent } from '@testing-library/react-native';
import { TaskListScreen } from '../screens/TaskListScreen';
import { fetchTaskList, getMockTaskList } from '../services/taskApi';
import {
  cacheTaskList,
  loadCachedTaskList,
  getTaskCacheTimestamp,
} from '../services/taskCache';
import { ThemeProvider } from '../theme/ThemeContext';
import { LanguageProvider } from '../contexts/LanguageContext';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View } from 'react-native';

// Mock dependencies
jest.mock('../services/taskApi', () => {
  const actual = jest.requireActual('../services/taskApi');
  return {
    ...actual,
    fetchTaskList: jest.fn(),
    getMockTaskList: jest.fn(actual.getMockTaskList),
  };
});
jest.mock('../services/taskCache');

jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: jest.fn(() => ({ isConnected: true })),
}));

jest.mock('../components/OfflineBanner', () => ({
  OfflineBanner: () => null,
}));

jest.mock('../components/DataFreshnessIndicator', () => ({
  DataFreshnessIndicator: () => null,
}));

const mockFetchTaskList = fetchTaskList as jest.MockedFunction<typeof fetchTaskList>;
const mockGetMockTaskList = getMockTaskList as jest.MockedFunction<typeof getMockTaskList>;
const mockCacheTaskList = cacheTaskList as jest.MockedFunction<typeof cacheTaskList>;
const mockLoadCachedTaskList = loadCachedTaskList as jest.MockedFunction<typeof loadCachedTaskList>;
const mockGetTaskCacheTimestamp = getTaskCacheTimestamp as jest.MockedFunction<typeof getTaskCacheTimestamp>;

const Stack = createNativeStackNavigator();

const renderScreen = () => {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <NavigationContainer>
          <Stack.Navigator>
            <Stack.Screen name="TaskList" component={TaskListScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </LanguageProvider>
    </ThemeProvider>,
  );
};

describe('TaskListScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadCachedTaskList.mockResolvedValue(null);
    mockGetTaskCacheTimestamp.mockResolvedValue(null);
  });

  it('renders fresh task list and writes to cache when backend is reachable', async () => {
    const freshTasks = [
      {
        id: 'task-1',
        title: 'Verify Aid Package 1',
        assignedPackageId: '1',
        dueDate: new Date().toISOString(),
        dueState: 'due-today' as const,
        status: 'pending' as const,
      },
    ];

    mockFetchTaskList.mockResolvedValueOnce(freshTasks);

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Verify Aid Package 1')).toBeTruthy();
      expect(mockCacheTaskList).toHaveBeenCalledWith(freshTasks);
    });
  });

  it('displays cached task data with age label when backend fails and cached data exists', async () => {
    const cachedTasks = [
      {
        id: 'task-1',
        title: 'Verify Aid Package 1',
        assignedPackageId: '1',
        dueDate: new Date().toISOString(),
        dueState: 'due-today' as const,
        status: 'pending' as const,
      },
    ];

    mockFetchTaskList.mockRejectedValueOnce(new Error('Network offline'));
    mockLoadCachedTaskList.mockResolvedValueOnce(cachedTasks);
    mockGetTaskCacheTimestamp.mockResolvedValueOnce('2026-08-28T09:00:00Z');

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Verify Aid Package 1')).toBeTruthy();
    });
  });

  it('falls back to getMockTaskList and shows visible MOCK indicator when both cache and network fail', async () => {
    mockFetchTaskList.mockRejectedValueOnce(new Error('Network offline'));
    mockLoadCachedTaskList.mockResolvedValueOnce(null);

    renderScreen();

    await waitFor(() => {
      // Mock badge is visible
      expect(screen.getByText('🔧 MOCK')).toBeTruthy();
      expect(screen.getByTestId('mock-badge')).toBeTruthy();
      expect(screen.getByText('Showing mock task data — backend unreachable')).toBeTruthy();
      // Mock tasks are rendered
      expect(screen.getByText('Verify Aid Package 1')).toBeTruthy();
      expect(screen.getByText('Scan Recipient QR Code')).toBeTruthy();
      expect(screen.getByText('Deliver Medical Supplies')).toBeTruthy();
    });

    expect(mockGetMockTaskList).toHaveBeenCalledTimes(1);
  });

  it('does not trigger mock fallback when cache is available', async () => {
    const cachedTasks = [
      {
        id: 'task-cached-1',
        title: 'Cached Task',
        assignedPackageId: '1',
        dueDate: new Date().toISOString(),
        dueState: 'due-today' as const,
        status: 'pending' as const,
      },
    ];

    mockFetchTaskList.mockRejectedValueOnce(new Error('Network offline'));
    mockLoadCachedTaskList.mockResolvedValueOnce(cachedTasks);

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Cached Task')).toBeTruthy();
      expect(screen.queryByText('🔧 MOCK')).toBeNull();
    });

    expect(mockGetMockTaskList).not.toHaveBeenCalled();
  });

  it('does not trigger mock fallback when backend is reachable', async () => {
    const freshTasks = [
      {
        id: 'task-live-1',
        title: 'Live Task',
        assignedPackageId: '1',
        dueDate: new Date().toISOString(),
        dueState: 'due-today' as const,
        status: 'pending' as const,
      },
    ];

    mockFetchTaskList.mockResolvedValueOnce(freshTasks);

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Live Task')).toBeTruthy();
      expect(screen.queryByText('🔧 MOCK')).toBeNull();
    });

    expect(mockGetMockTaskList).not.toHaveBeenCalled();
  });
});


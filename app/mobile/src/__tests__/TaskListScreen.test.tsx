import React from 'react';
import { render, waitFor, screen, fireEvent } from '@testing-library/react-native';
import { TaskListScreen } from '../screens/TaskListScreen';
import { fetchTaskList, getMockTaskList } from '../services/taskApi';
import {
  cacheTaskList,
  loadCachedTaskList,
  getTaskCacheTimestamp,
} from '../services/taskCache';

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => {
    const { Colors, SoterLightTheme } = require('../theme/theme');
    return {
      colors: { ...Colors.light, brand: Colors.brand },
      navTheme: SoterLightTheme,
      scheme: 'light',
      setScheme: jest.fn(),
    };
  },
}));

jest.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({
    locale: 'en',
    deviceLocale: 'en',
    locales: ['en', 'es', 'fr'],
    isOverridden: false,
    setActiveLocale: jest.fn(),
  }),
}));

jest.mock('../services/taskApi', () => {
  const actual = jest.requireActual('../services/taskApi');
  return {
    ...actual,
    fetchTaskList: jest.fn(),
  };
});

jest.mock('../services/taskCache', () => ({
  cacheTaskList: jest.fn().mockResolvedValue(undefined),
  loadCachedTaskList: jest.fn().mockResolvedValue(null),
  getTaskCacheTimestamp: jest.fn().mockResolvedValue(null),
}));

jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: jest.fn().mockReturnValue({ isConnected: true }),
}));

jest.mock('../components/OfflineBanner', () => ({
  OfflineBanner: () => null,
}));

jest.mock('../components/DataFreshnessIndicator', () => ({
  DataFreshnessIndicator: () => null,
}));

const mockFetchTaskList = fetchTaskList as jest.MockedFunction<typeof fetchTaskList>;
const mockCacheTaskList = cacheTaskList as jest.MockedFunction<typeof cacheTaskList>;
const mockLoadCachedTaskList = loadCachedTaskList as jest.MockedFunction<typeof loadCachedTaskList>;
const mockGetTaskCacheTimestamp = getTaskCacheTimestamp as jest.MockedFunction<
  typeof getTaskCacheTimestamp
>;

const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
} as any;

const route = { key: 'TaskList', name: 'TaskList', params: undefined } as any;

describe('TaskListScreen mock fallback retirement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadCachedTaskList.mockResolvedValue(null);
    mockGetTaskCacheTimestamp.mockResolvedValue(null);
  });

  it('shows explicit unavailable state when backend fails and no cache exists', async () => {
    mockFetchTaskList.mockRejectedValueOnce(new Error('Network error'));
    mockLoadCachedTaskList.mockResolvedValueOnce(null);

    render(<TaskListScreen navigation={navigation} route={route} />);

    await waitFor(() => {
      expect(screen.getByTestId('task-list-unavailable')).toBeTruthy();
      expect(screen.getByText('UNAVAILABLE')).toBeTruthy();
      expect(
        screen.getByText(
          'Unable to load tasks. Backend unreachable and no cached data is available.',
        ),
      ).toBeTruthy();
      expect(screen.queryByText('Verify Aid Package 1')).toBeNull();
      expect(screen.queryByText('🔧 MOCK')).toBeNull();
    });

    expect(mockCacheTaskList).not.toHaveBeenCalled();
  });

  it('uses cached tasks when backend fails but cache exists (no mock)', async () => {
    const cached = [
      {
        id: 'cached-1',
        title: 'Cached Real Task',
        assignedPackageId: 'pkg-9',
        dueDate: '2026-09-01T00:00:00.000Z',
        dueState: 'upcoming' as const,
        status: 'pending' as const,
      },
    ];
    mockFetchTaskList.mockRejectedValueOnce(new Error('Network error'));
    mockLoadCachedTaskList.mockResolvedValueOnce(cached);
    mockGetTaskCacheTimestamp.mockResolvedValueOnce('9/1/2026, 12:00:00 AM');

    render(<TaskListScreen navigation={navigation} route={route} />);

    await waitFor(() => {
      expect(screen.getByText('Cached Real Task')).toBeTruthy();
      expect(screen.queryByTestId('task-list-unavailable')).toBeNull();
      expect(screen.queryByText('Verify Aid Package 1')).toBeNull();
    });
  });

  it('retries fetching when retry is pressed after unavailable state', async () => {
    mockFetchTaskList.mockRejectedValueOnce(new Error('Network error'));
    mockLoadCachedTaskList.mockResolvedValueOnce(null);

    render(<TaskListScreen navigation={navigation} route={route} />);

    await waitFor(() => {
      expect(screen.getByTestId('task-list-retry')).toBeTruthy();
    });

    mockFetchTaskList.mockResolvedValueOnce([
      {
        id: 'live-1',
        title: 'Live Task After Retry',
        assignedPackageId: '1',
        dueDate: '2026-09-02T00:00:00.000Z',
        dueState: 'upcoming',
        status: 'pending',
      },
    ]);

    fireEvent.press(screen.getByTestId('task-list-retry'));

    await waitFor(() => {
      expect(screen.getByText('Live Task After Retry')).toBeTruthy();
      expect(screen.queryByTestId('task-list-unavailable')).toBeNull();
    });
  });
});

describe('getMockTaskList isolation', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('remains reachable from tests in non-production', () => {
    process.env.NODE_ENV = 'test';
    const mock = getMockTaskList();
    expect(mock).toHaveLength(3);
    expect(mock[0].id).toBe('task-1');
  });

  it('throws in production builds', () => {
    process.env.NODE_ENV = 'production';
    expect(() => getMockTaskList()).toThrow(
      'getMockTaskList cannot be used in production builds',
    );
  });
});

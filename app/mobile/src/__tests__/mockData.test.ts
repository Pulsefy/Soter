import { getMockHealthData } from '../services/mockData';
import { getMockTaskList } from '../services/taskApi';

describe('mockData', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('returns mock health data in non-production environments', () => {
    process.env.NODE_ENV = 'development';
    const data = getMockHealthData();
    expect(data.status).toBe('ok');
    expect(data.service).toBe('backend');
    expect(data.version).toBe('0.0.0');
    expect(data.environment).toBe('development');
    expect(data.mocked).toBe(true);
  });

  it('throws an error when accessed in a production environment', () => {
    process.env.NODE_ENV = 'production';
    expect(() => getMockHealthData()).toThrow(
      'mockData.ts cannot be used in production builds',
    );
  });

  it('returns mock task list in non-production environments', () => {
    process.env.NODE_ENV = 'development';
    const tasks = getMockTaskList();
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0]).toHaveProperty('id');
    expect(tasks[0]).toHaveProperty('title');
  });

  it('throws an error when getMockTaskList is accessed in a production environment', () => {
    process.env.NODE_ENV = 'production';
    expect(() => getMockTaskList()).toThrow(
      'getMockTaskList cannot be used in production builds',
    );
  });
});



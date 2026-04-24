import { Platform } from 'react-native';

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');

export type TaskStatus = 'pending' | 'in-progress' | 'completed';
export type TaskDueState = 'due-today' | 'overdue' | 'upcoming';

export interface TaskItem {
  id: string;
  title: string;
  assignedPackageId: string;
  dueDate: string;
  dueState: TaskDueState;
  status: TaskStatus;
}

/** Fetch task list from the backend */
export const fetchTaskList = async (): Promise<TaskItem[]> => {
  const response = await fetch(`${API_URL}/tasks`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.json();
};

/** Fallback mock data used when the backend is unreachable */
export const getMockTaskList = (): TaskItem[] => {
  const now = new Date();
  
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const today = new Date(now);
  
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return [
    {
      id: 'task-1',
      title: 'Verify Aid Package 1',
      assignedPackageId: '1',
      dueDate: yesterday.toISOString(),
      dueState: 'overdue',
      status: 'in-progress',
    },
    {
      id: 'task-2',
      title: 'Scan Recipient QR Code',
      assignedPackageId: '2',
      dueDate: today.toISOString(),
      dueState: 'due-today',
      status: 'pending',
    },
    {
      id: 'task-3',
      title: 'Deliver Medical Supplies',
      assignedPackageId: '3',
      dueDate: tomorrow.toISOString(),
      dueState: 'upcoming',
      status: 'pending',
    },
  ];
};

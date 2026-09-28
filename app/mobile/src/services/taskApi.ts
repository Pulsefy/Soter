import { apiGet } from './requestLayer';

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
  const { data } = await apiGet<TaskItem[]>('/tasks');
  return data;
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

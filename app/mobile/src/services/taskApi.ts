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

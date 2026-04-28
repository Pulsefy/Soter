import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ActivityItem, ActivityStore } from '@/types/activity';

export const useActivityStore = create<ActivityStore>()(
  persist(
    (set, get) => ({
      activities: [],

      addActivity: (activity) => {
        const newActivity: ActivityItem = {
          ...activity,
          id: crypto.randomUUID(),
          timestamp: new Date(),
        };
        set((state) => ({
          activities: [newActivity, ...state.activities],
        }));

        return newActivity.id;
      },

      updateActivity: (id, updates) => {
        set((state) => ({
          activities: state.activities.map((activity) =>
            activity.id === id ? { ...activity, ...updates } : activity
          ),
        }));
      },

      removeActivity: (id) => {
        set((state) => ({
          activities: state.activities.filter((activity) => activity.id !== id),
        }));
      },

      clearCompleted: () => {
        set((state) => ({
          activities: state.activities.filter(
            (activity) => activity.status !== 'succeeded' && activity.status !== 'failed'
          ),
        }));
      },
    }),
    {
      name: 'activity-storage',
      partialize: (state) => ({
        activities: state.activities.slice(0, 50), // Keep only recent 50 activities
      }),
    }
  )
);
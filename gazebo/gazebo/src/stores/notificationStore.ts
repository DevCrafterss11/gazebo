import { create } from 'zustand';

import type { PlatformMessage, PlatformNotification } from '../types/platform';

interface NotificationState {
  notifications: PlatformNotification[];
  messages: PlatformMessage[];
  addNotification: (notification: Omit<PlatformNotification, 'id' | 'createdAt' | 'read'>) => void;
  markRead: (notificationId: string) => void;
  markAllRead: () => void;
}

let notificationSequence = 0;

const now = Date.now();

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [
    {
      id: 'notification-welcome',
      title: 'MUVA 平台已就绪',
      detail: '仿真教学环境已就绪，可直接开始实验一。',
      createdAt: new Date(now - 4 * 60_000).toISOString(),
      kind: 'system',
      read: false,
    },
  ],
  messages: [
    {
      id: 'message-system',
      sender: '系统助手',
      content: '欢迎进入无人机基础飞行实验。',
      createdAt: new Date(now - 3 * 60_000).toISOString(),
    },
    {
      id: 'message-teaching',
      sender: '教学助手',
      content: '完成无人机选择后，请继续进行实验参数配置。',
      createdAt: new Date(now - 2 * 60_000).toISOString(),
    },
  ],
  addNotification: (notification) => {
    notificationSequence += 1;
    set((state) => ({
      notifications: [
        {
          ...notification,
          id: `notification-${Date.now()}-${notificationSequence}`,
          createdAt: new Date().toISOString(),
          read: false,
        },
        ...state.notifications,
      ],
    }));
  },
  markRead: (notificationId) => set((state) => ({
    notifications: state.notifications.map((item) => (
      item.id === notificationId ? { ...item, read: true } : item
    )),
  })),
  markAllRead: () => set((state) => ({
    notifications: state.notifications.map((item) => ({ ...item, read: true })),
  })),
}));

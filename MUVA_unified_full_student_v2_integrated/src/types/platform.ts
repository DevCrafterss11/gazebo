export type NotificationKind = 'system' | 'environment' | 'training';

export interface PlatformNotification {
  id: string;
  title: string;
  detail: string;
  createdAt: string;
  kind: NotificationKind;
  read: boolean;
}

export interface PlatformMessage {
  id: string;
  sender: string;
  content: string;
  createdAt: string;
}

export type ToastTone = 'info' | 'success' | 'warning';

export interface ToastMessage {
  id: string;
  message: string;
  tone: ToastTone;
}

export enum NotificationType {
  EMAIL = 'email',
  SMS = 'sms',
}

export interface NotificationJobData {
  type: NotificationType;
  recipient: string;
  subject?: string;
  message: string;
  timestamp: number;
}

export interface NotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

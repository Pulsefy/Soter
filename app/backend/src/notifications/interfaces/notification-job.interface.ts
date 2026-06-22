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
  outboxId: string;
  correlationId?: string;
}

export interface NotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

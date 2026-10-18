import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AiVerificationWebhookDto,
  TaskStatus,
} from './ai-verification-webhook.dto';

describe('AiVerificationWebhookDto', () => {
  it('validates the canonical AI callback shape', async () => {
    const dto = plainToInstance(AiVerificationWebhookDto, {
      taskId: 'task-1',
      deliveryId: 'delivery-1',
      timestamp: '2024-03-24T10:30:00Z',
      status: TaskStatus.COMPLETED,
      result: { score: 0.9 },
      taskType: 'humanitarian_verification',
      completedAt: '2024-03-24T10:35:00Z',
      schemaVersion: '1.0',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects malformed callback payloads consistently', async () => {
    const dto = plainToInstance(AiVerificationWebhookDto, {
      taskId: '',
      deliveryId: '',
      timestamp: 'not-a-date',
      status: 'unknown',
      result: 'not-an-object',
    });

    const errors = await validate(dto);

    expect(errors.map(error => error.property)).toEqual(
      expect.arrayContaining([
        'taskId',
        'deliveryId',
        'timestamp',
        'status',
        'result',
      ]),
    );
  });

  it('requires failed callbacks to include an error', async () => {
    const dto = plainToInstance(AiVerificationWebhookDto, {
      taskId: 'task-1',
      deliveryId: 'delivery-1',
      timestamp: '2024-03-24T10:30:00Z',
      status: TaskStatus.FAILED,
    });

    const errors = await validate(dto);

    expect(errors.map(error => error.property)).toContain('error');
  });
});

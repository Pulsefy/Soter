import { Test, TestingModule } from '@nestjs/testing';
import { AidService } from './aid.service';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../../cache/redis.service';
import { AiTaskWebhookDto, TaskStatus } from './dto/ai-task-webhook.dto';

describe('AidService - Webhook Reliability Checks', () => {
  let service: AidService;
  let redisService: jest.Mocked<RedisService>;
  let auditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AidService,
        {
          provide: AuditService,
          useValue: { record: jest.fn() },
        },
        {
          provide: RedisService,
          useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AidService>(AidService);
    redisService = module.get(RedisService);
    auditService = module.get(AuditService);
  });

  it('1. should successfully process a fresh, valid webhook payload', async () => {
    const payload: AiTaskWebhookDto = {
      taskId: 'task-1',
      deliveryId: 'del-1',
      timestamp: '2024-03-24T10:00:00Z',
      status: TaskStatus.COMPLETED,
    };

    redisService.get.mockResolvedValueOnce(null);
    redisService.get.mockResolvedValueOnce(null);

    const result = await service.handleTaskWebhook(payload);

    expect(result).toEqual({ received: true, taskId: 'task-1', status: 'completed' });
    expect(redisService.set).toHaveBeenCalledWith('webhook:delivery:del-1', true, expect.any(Number));
    expect(redisService.set).toHaveBeenCalledWith(
      'webhook:task_ts:task-1',
      new Date('2024-03-24T10:00:00Z').getTime(),
      expect.any(Number)
    );
    expect(auditService.record).toHaveBeenCalled();
  });

  it('2. should reject duplicate exact deliveries', async () => {
    const payload: AiTaskWebhookDto = {
      taskId: 'task-1',
      deliveryId: 'del-1',
      timestamp: '2024-03-24T10:00:00Z',
      status: TaskStatus.COMPLETED,
    };

    redisService.get.mockResolvedValueOnce(true);

    const result = await service.handleTaskWebhook(payload);

    expect(result).toEqual({ received: true, status: 'ignored', reason: 'duplicate_delivery' });
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('3. should reject stale/delayed out-of-order payloads (conflicts)', async () => {
    const stalePayload: AiTaskWebhookDto = {
      taskId: 'task-1',
      deliveryId: 'del-2',
      timestamp: '2024-03-24T09:00:00Z',
      status: TaskStatus.PROCESSING,
    };

    redisService.get.mockResolvedValueOnce(null);
    redisService.get.mockResolvedValueOnce(new Date('2024-03-24T10:00:00Z').getTime());

    const result = await service.handleTaskWebhook(stalePayload);

    expect(result).toEqual({ received: true, status: 'ignored', reason: 'stale_payload' });
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('4. should process a progressive newer payload sequentially', async () => {
    const newerPayload: AiTaskWebhookDto = {
      taskId: 'task-1',
      deliveryId: 'del-3',
      timestamp: '2024-03-24T11:00:00Z',
      status: TaskStatus.COMPLETED,
    };

    redisService.get.mockResolvedValueOnce(null);
    redisService.get.mockResolvedValueOnce(new Date('2024-03-24T10:00:00Z').getTime());

    const result = await service.handleTaskWebhook(newerPayload);

    expect(result.status).toEqual('completed');
    expect(auditService.record).toHaveBeenCalled();
  });
});
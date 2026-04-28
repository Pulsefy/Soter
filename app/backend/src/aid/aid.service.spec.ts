import { Test, TestingModule } from '@nestjs/testing';
import { AidService } from './aid.service';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../../cache/redis.service';
import { AiTaskWebhookDto, TaskStatus } from './dto/ai-task-webhook.dto';

describe('AidService - Webhook Reliability Checks', () => {
  let service: AidService;
  let redisService: RedisService;
  let auditService: AuditService;
  let redisGetSpy: jest.SpyInstance;
  let redisSetSpy: jest.SpyInstance;
  let auditRecordSpy: jest.SpyInstance;

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
    redisService = module.get<RedisService>(RedisService);
    auditService = module.get<AuditService>(AuditService);

    redisGetSpy = jest.spyOn(redisService, 'get');
    redisSetSpy = jest.spyOn(redisService, 'set');
    auditRecordSpy = jest.spyOn(auditService, 'record');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('1. should successfully process a fresh, valid webhook payload', async () => {
    const payload: AiTaskWebhookDto = {
      taskId: 'task-1',
      deliveryId: 'del-1',
      timestamp: '2024-03-24T10:00:00Z',
      status: TaskStatus.COMPLETED,
    };

    redisGetSpy.mockResolvedValueOnce(null);
    redisGetSpy.mockResolvedValueOnce(null);

    const result = await service.handleTaskWebhook(payload);

    expect(result).toEqual({
      received: true,
      taskId: 'task-1',
      status: 'completed',
    });

    expect(redisSetSpy).toHaveBeenCalledWith(
      'webhook:delivery:del-1',
      true,
      expect.any(Number),
    );
    expect(redisSetSpy).toHaveBeenCalledWith(
      'webhook:task_ts:task-1',
      new Date('2024-03-24T10:00:00Z').getTime(),
      expect.any(Number),
    );
    expect(auditRecordSpy).toHaveBeenCalled();
  });

  it('2. should reject duplicate exact deliveries', async () => {
    const payload: AiTaskWebhookDto = {
      taskId: 'task-1',
      deliveryId: 'del-1',
      timestamp: '2024-03-24T10:00:00Z',
      status: TaskStatus.COMPLETED,
    };

    redisGetSpy.mockResolvedValueOnce(true);

    const result = await service.handleTaskWebhook(payload);

    expect(result).toEqual({
      received: true,
      status: 'ignored',
      reason: 'duplicate_delivery',
    });
    expect(auditRecordSpy).not.toHaveBeenCalled();
  });

  it('3. should reject stale/delayed out-of-order payloads (conflicts)', async () => {
    const stalePayload: AiTaskWebhookDto = {
      taskId: 'task-1',
      deliveryId: 'del-2',
      timestamp: '2024-03-24T09:00:00Z',
      status: TaskStatus.PROCESSING,
    };

    redisGetSpy.mockResolvedValueOnce(null);
    redisGetSpy.mockResolvedValueOnce(
      new Date('2024-03-24T10:00:00Z').getTime(),
    );

    const result = await service.handleTaskWebhook(stalePayload);

    expect(result).toEqual({
      received: true,
      status: 'ignored',
      reason: 'stale_payload',
    });
    expect(auditRecordSpy).not.toHaveBeenCalled();
  });

  it('4. should process a progressive newer payload sequentially', async () => {
    const newerPayload: AiTaskWebhookDto = {
      taskId: 'task-1',
      deliveryId: 'del-3',
      timestamp: '2024-03-24T11:00:00Z',
      status: TaskStatus.COMPLETED,
    };

    redisGetSpy.mockResolvedValueOnce(null);
    redisGetSpy.mockResolvedValueOnce(
      new Date('2024-03-24T10:00:00Z').getTime(),
    );

    const result = await service.handleTaskWebhook(newerPayload);

    expect(result.status).toEqual('completed');
    expect(auditRecordSpy).toHaveBeenCalled();
  });
});

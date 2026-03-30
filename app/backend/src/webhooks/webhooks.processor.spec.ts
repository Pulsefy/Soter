import { Job } from 'bullmq';
import axios from 'axios';
import { createHmac } from 'node:crypto';
import { WebhooksProcessor } from './webhooks.processor';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('axios');

describe('WebhooksProcessor', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;
  const findSubscription = jest.fn();
  const createDeliveryAttempt = jest.fn();

  const prisma = {
    webhookSubscription: {
      findUnique: findSubscription,
    },
    webhookDeliveryAttempt: {
      create: createDeliveryAttempt,
    },
  } as unknown as PrismaService;

  let processor: WebhooksProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new WebhooksProcessor(prisma);
  });

  it('posts webhook payloads with HMAC signature headers', async () => {
    findSubscription.mockResolvedValue({
      id: 'sub-1',
      url: 'https://ngo.example.com/hooks',
      secret: 'supersecret',
      isActive: true,
    });
    createDeliveryAttempt.mockResolvedValue({});
    mockedAxios.post.mockResolvedValue({
      status: 202,
      data: { accepted: true },
    });

    const job = {
      id: 'job-1',
      attemptsMade: 0,
      data: {
        subscriptionId: 'sub-1',
        event: 'claim.disbursed',
        payload: {
          event: 'claim.disbursed',
          claim: { id: 'claim-1', amount: '200.00' },
        },
      },
    } as Job;

    await processor.process(job);

    const [, body, config] = mockedAxios.post.mock.calls[0] ?? [];
    const timestamp = config?.headers?.['x-soter-timestamp'] as string;
    const signature = config?.headers?.['x-soter-signature'] as string;
    const expected = createHmac('sha256', 'supersecret')
      .update(`${timestamp}.${JSON.stringify(body)}`)
      .digest('hex');

    expect(config?.headers?.['x-soter-event']).toBe('claim.disbursed');
    expect(signature).toBe(`sha256=${expected}`);
    expect(createDeliveryAttempt).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subscriptionId: 'sub-1',
        status: 'delivered',
        responseStatus: 202,
      }),
    });
  });

  it('records failed delivery attempts for retryable errors', async () => {
    findSubscription.mockResolvedValue({
      id: 'sub-1',
      url: 'https://ngo.example.com/hooks',
      secret: 'supersecret',
      isActive: true,
    });
    createDeliveryAttempt.mockResolvedValue({});
    mockedAxios.post.mockRejectedValue(new Error('socket hang up'));

    const job = {
      id: 'job-2',
      attemptsMade: 1,
      data: {
        subscriptionId: 'sub-1',
        event: 'claim.verified',
        payload: {
          event: 'claim.verified',
          claim: { id: 'claim-2' },
        },
      },
    } as Job;

    await expect(processor.process(job)).rejects.toThrow('socket hang up');

    expect(createDeliveryAttempt).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subscriptionId: 'sub-1',
        attempt: 2,
        status: 'failed',
        errorMessage: 'socket hang up',
      }),
    });
  });
});

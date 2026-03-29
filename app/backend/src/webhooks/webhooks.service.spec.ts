import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../prisma/prisma.service';
import { WEBHOOK_QUEUE } from './webhook-events';

describe('WebhooksService', () => {
  let service: WebhooksService;

  const prisma = {
    webhookSubscription: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const queue = {
    add: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken(WEBHOOK_QUEUE), useValue: queue },
      ],
    }).compile();

    service = moduleRef.get(WebhooksService);
  });

  it('creates a subscription for the authenticated NGO api key', async () => {
    prisma.webhookSubscription.create.mockResolvedValue({ id: 'sub-1' });

    await service.createSubscription('api-key-1', {
      url: 'https://ngo.example.com/hooks',
      secret: 'supersecret',
      events: ['claim.verified'],
      isActive: true,
    });

    expect(prisma.webhookSubscription.create).toHaveBeenCalledWith({
      data: {
        apiKeyId: 'api-key-1',
        url: 'https://ngo.example.com/hooks',
        secret: 'supersecret',
        events: ['claim.verified'],
        isActive: true,
      },
    });
  });

  it('enqueues deliveries for all matching active subscriptions', async () => {
    prisma.webhookSubscription.findMany.mockResolvedValue([
      { id: 'sub-1' },
      { id: 'sub-2' },
    ]);

    const count = await service.enqueueEvent('claim.verified', {
      event: 'claim.verified',
      claim: { id: 'claim-1' },
    });

    expect(count).toBe(2);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith(
      'deliver-claim.verified',
      expect.objectContaining({
        subscriptionId: 'sub-1',
        event: 'claim.verified',
      }),
      expect.objectContaining({
        attempts: 5,
      }),
    );
  });

  it('throws when updating a subscription the NGO does not own', async () => {
    prisma.webhookSubscription.findFirst.mockResolvedValue(null);

    await expect(
      service.updateSubscription('api-key-1', 'sub-1', {
        isActive: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

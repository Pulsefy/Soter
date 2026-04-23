import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { getQueueToken } from '@nestjs/bullmq';
import { NotificationType } from './interfaces/notification-job.interface';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let queueMock: any;

  beforeEach(async () => {
    queueMock = {
      add: jest.fn().mockResolvedValue({ id: '123' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getQueueToken('notifications'),
          useValue: queueMock,
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should enqueue an email job', async () => {
    const recipient = 'test@example.com';
    const subject = 'Test Subject';
    const message = 'Test Message';

    const job = await service.sendEmail(recipient, subject, message);

    expect(job).toBeDefined();
    expect(job.id).toBe('123');
    expect(queueMock.add).toHaveBeenCalledWith(
      'send-email',
      expect.objectContaining({
        type: NotificationType.EMAIL,
        recipient,
        subject,
        message,
      }),
      expect.any(Object),
    );
  });

  it('should enqueue an SMS job', async () => {
    const recipient = '+1234567890';
    const message = 'Test SMS';

    const job = await service.sendSms(recipient, message);

    expect(job).toBeDefined();
    expect(job.id).toBe('123');
    expect(queueMock.add).toHaveBeenCalledWith(
      'send-sms',
      expect.objectContaining({
        type: NotificationType.SMS,
        recipient,
        message,
      }),
      expect.any(Object),
    );
  });
});

import { DeliveryAdapter } from './adapters/delivery-adapter.interface';
import { NotificationProviderHealthService } from './notification-provider-health.service';

function makeAdapter(
  provider: string,
  checkReachability: jest.Mock,
): DeliveryAdapter {
  return {
    provider,
    checkReachability,
  } as unknown as DeliveryAdapter;
}

describe('NotificationProviderHealthService', () => {
  it('reports healthy configured providers', async () => {
    const emailAdapter = makeAdapter(
      'sendgrid',
      jest.fn().mockResolvedValue({
        provider: 'sendgrid',
        reachable: true,
        latencyMs: 12,
      }),
    );
    const smsAdapter = makeAdapter(
      'twilio',
      jest.fn().mockResolvedValue({
        provider: 'twilio',
        reachable: true,
        latencyMs: 15,
      }),
    );
    const service = new NotificationProviderHealthService(
      emailAdapter,
      smsAdapter,
    );

    const checks = await service.checkProviders(2000);

    expect(checks).toEqual({
      email: { provider: 'sendgrid', reachable: true, latencyMs: 12 },
      sms: { provider: 'twilio', reachable: true, latencyMs: 15 },
    });
    expect(emailAdapter.checkReachability).toHaveBeenCalledWith(2000);
    expect(smsAdapter.checkReachability).toHaveBeenCalledWith(2000);
  });

  it('reports an unreachable provider without throwing', async () => {
    const emailAdapter = makeAdapter(
      'sendgrid',
      jest.fn().mockResolvedValue({
        provider: 'sendgrid',
        reachable: false,
        latencyMs: 2000,
        error: 'SendGrid health check failed: HTTP 503',
      }),
    );
    const smsAdapter = makeAdapter(
      'twilio',
      jest.fn().mockResolvedValue({
        provider: 'twilio',
        reachable: true,
        latencyMs: 10,
      }),
    );
    const service = new NotificationProviderHealthService(
      emailAdapter,
      smsAdapter,
    );

    const checks = await service.checkProviders(2000);

    expect(checks.email).toEqual(
      expect.objectContaining({
        provider: 'sendgrid',
        reachable: false,
        error: 'SendGrid health check failed: HTTP 503',
      }),
    );
    expect(checks.sms).toEqual(
      expect.objectContaining({ provider: 'twilio', reachable: true }),
    );
  });

  it('converts a thrown adapter error into an unreachable result', async () => {
    const emailAdapter = makeAdapter(
      'sendgrid',
      jest.fn().mockRejectedValue(new Error('network down')),
    );
    const smsAdapter = makeAdapter(
      'twilio',
      jest.fn().mockResolvedValue({
        provider: 'twilio',
        reachable: true,
        latencyMs: 10,
      }),
    );
    const service = new NotificationProviderHealthService(
      emailAdapter,
      smsAdapter,
    );

    const checks = await service.checkProviders(2000);

    expect(checks.email).toEqual(
      expect.objectContaining({
        provider: 'sendgrid',
        reachable: false,
        error: 'Provider health check failed: network down',
      }),
    );
  });

  it('passes through skipped console fallbacks', async () => {
    const skipped = {
      provider: 'console',
      reachable: true,
      latencyMs: 0,
      skipped: true,
    };
    const service = new NotificationProviderHealthService(
      makeAdapter('console', jest.fn().mockResolvedValue(skipped)),
      makeAdapter('console', jest.fn().mockResolvedValue(skipped)),
    );

    const checks = await service.checkProviders(2000);

    expect(checks.email.skipped).toBe(true);
    expect(checks.sms.skipped).toBe(true);
  });
});

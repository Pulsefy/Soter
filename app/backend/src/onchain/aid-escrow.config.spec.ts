import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BudgetService } from '../common/budget/budget.service';
import { AuditService } from '../audit/audit.service';
import { AidEscrowService } from './aid-escrow.service';
import { OnchainAdapter } from './onchain.adapter';
import { UpdateAidEscrowConfigDto } from './dto/aid-escrow.dto';

const VALID_TOKEN = `C${'A'.repeat(55)}`;

describe('AidEscrowService.updateConfig', () => {
  const previousConfig = {
    minAmount: '100',
    maxExpiresIn: 3600,
    allowedTokens: [VALID_TOKEN],
    claimCooldown: 0,
  };

  let adapter: {
    getConfig: jest.Mock;
    setConfig: jest.Mock;
  };
  let audit: { record: jest.Mock };
  let service: AidEscrowService;

  beforeEach(() => {
    adapter = {
      getConfig: jest.fn().mockResolvedValue(previousConfig),
      setConfig: jest.fn().mockResolvedValue({
        transactionHash: 'ABC123',
        timestamp: new Date('2026-01-01T00:00:00Z'),
      }),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new AidEscrowService(
      adapter as unknown as OnchainAdapter,
      {} as BudgetService,
      { get: jest.fn().mockReturnValue('testnet') } as unknown as ConfigService,
      audit as unknown as AuditService,
    );
  });

  it('reads, applies, and audit-logs a complete configuration', async () => {
    const config: UpdateAidEscrowConfigDto = {
      minAmount: '250',
      maxExpiresIn: 7200,
      allowedTokens: [VALID_TOKEN],
      claimCooldown: 60,
    };

    const result = await service.updateConfig(config, 'admin-1');

    expect(adapter.getConfig).toHaveBeenCalledTimes(1);
    expect(adapter.setConfig).toHaveBeenCalledWith(config);
    expect(result.previousConfig).toEqual(previousConfig);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        entity: 'aid_escrow_config',
        action: 'update_config',
        metadata: expect.objectContaining({ before: previousConfig, after: config }),
      }),
    );
  });

  it('rejects a partial or malformed configuration before contacting the adapter', async () => {
    await expect(
      service.updateConfig(
        { minAmount: '0' } as UpdateAidEscrowConfigDto,
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(adapter.getConfig).not.toHaveBeenCalled();
    expect(adapter.setConfig).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

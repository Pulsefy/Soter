import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CancelReasonCode } from '@prisma/client';
import { CancelClaimDto } from './cancel-claim.dto';

const validateDto = async (input: Record<string, unknown>) => {
  const dto = plainToInstance(CancelClaimDto, input);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
};

describe('CancelClaimDto', () => {
  it('accepts a request carrying a valid code and free-text detail', async () => {
    const errors = await validateDto({
      operatorId: 'operator-1',
      code: CancelReasonCode.duplicate,
      reason: 'Duplicate of claim-0',
    });

    expect(errors).toHaveLength(0);
  });

  it('accepts a valid code with no detail, since detail is optional', async () => {
    const errors = await validateDto({
      operatorId: 'operator-1',
      code: CancelReasonCode.fraud_flag,
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects a request with no code', async () => {
    const errors = await validateDto({
      operatorId: 'operator-1',
      reason: 'Recipient relocated',
    });

    expect(errors.map(e => e.property)).toContain('code');
  });

  it('rejects a code outside the enum', async () => {
    const errors = await validateDto({
      operatorId: 'operator-1',
      code: 'recipient_felt_like_a_dupe',
    });

    const codeError = errors.find(e => e.property === 'code');
    expect(codeError).toBeDefined();
    // The message enumerates the valid codes so a caller can self-correct.
    expect(codeError?.constraints?.isEnum).toContain('duplicate');
  });

  it('rejects a detail string longer than 500 characters', async () => {
    const errors = await validateDto({
      operatorId: 'operator-1',
      code: CancelReasonCode.duplicate,
      reason: 'x'.repeat(501),
    });

    expect(errors.map(e => e.property)).toContain('reason');
  });
});

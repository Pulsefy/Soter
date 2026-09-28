import { SorobanErrorMapper } from './soroban-error.mapper';

describe('SorobanErrorMapper', () => {
  const mapper = new SorobanErrorMapper();

  it('maps invalid token contract errors from numeric contract codes', () => {
    expect(mapper.mapError({ errorCode: 17 })).toMatchObject({
      statusCode: 400,
      message: 'Invalid token contract address',
      details: {
        error_code: 17,
        error_type: 'contract_error',
      },
    });
  });

  it('maps reverted token transfers from numeric contract codes', () => {
    expect(mapper.mapError({ errorCode: 18 })).toMatchObject({
      statusCode: 502,
      message: 'Token transfer failed',
      details: {
        error_code: 18,
        error_type: 'contract_error',
      },
    });
  });

  it('maps token errors from contract error messages', () => {
    expect(
      mapper.mapError(
        new Error('HostError: Error(Contract, #17) InvalidToken'),
      ),
    ).toMatchObject({
      statusCode: 400,
      message: 'Invalid token contract address',
      details: {
        error_name: 'InvalidToken',
        error_type: 'contract_error',
      },
    });
  });

  it('maps token errors embedded in Soroban JSON-RPC responses', () => {
    expect(
      mapper.mapError({
        response: {
          data: {
            error: {
              code: -32603,
              message: 'HostError: Error(Contract, #18)',
            },
          },
        },
      }),
    ).toMatchObject({
      statusCode: 502,
      message: 'Token transfer failed',
      details: {
        error_code: 18,
        error_type: 'contract_error',
      },
    });
  });

  it('maps no pending transfer errors from numeric contract codes', () => {
    expect(mapper.mapError({ errorCode: 19 })).toMatchObject({
      statusCode: 400,
      message: 'No pending admin transfer in progress',
      details: {
        error_code: 19,
        error_type: 'contract_error',
      },
    });
  });

  it('maps invalid pending admin errors from numeric contract codes', () => {
    expect(mapper.mapError({ errorCode: 20 })).toMatchObject({
      statusCode: 403,
      message: 'Invalid pending admin address',
      details: {
        error_code: 20,
        error_type: 'contract_error',
      },
    });
  });

  it('maps batch too large errors from numeric contract codes', () => {
    expect(mapper.mapError({ errorCode: 21 })).toMatchObject({
      statusCode: 400,
      message: 'Batch operation exceeds the maximum allowed size',
      details: {
        error_code: 21,
        error_type: 'contract_error',
      },
    });
  });

  it('maps claim cooldown errors from numeric contract codes', () => {
    expect(mapper.mapError({ errorCode: 22 })).toMatchObject({
      statusCode: 400,
      message: 'Claim cooldown is still active',
      details: {
        error_code: 22,
        error_type: 'contract_error',
      },
    });
  });

  it('maps claim cooldown errors from contract error messages', () => {
    expect(
      mapper.mapError(
        new Error('HostError: Error(Contract, #22) ClaimCooldownActive'),
      ),
    ).toMatchObject({
      statusCode: 400,
      message: 'Claim cooldown is still active',
      details: {
        error_name: 'ClaimCooldownActive',
        error_type: 'contract_error',
      },
    });
  });
});

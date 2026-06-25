import { SorobanErrorMapper } from './soroban-error.mapper';

describe('SorobanErrorMapper', () => {
  const mapper = new SorobanErrorMapper();

  it('maps invalid token contract errors from numeric contract codes', () => {
    expect(mapper.mapError({ errorCode: 17 })).toEqual({
      statusCode: 400,
      message: 'Invalid token contract address',
      details: {
        error_code: 17,
        error_type: 'contract_error',
      },
    });
  });

  it('maps reverted token transfers from numeric contract codes', () => {
    expect(mapper.mapError({ errorCode: 18 })).toEqual({
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
});

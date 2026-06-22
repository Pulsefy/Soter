export const mockStellarSDK = {
  Server: jest.fn().mockImplementation(() => ({
    loadAccount: jest.fn().mockResolvedValue({
      id: 'GBXGQJWVLWOYHFLVTKWV5FGHA3JYYV3A7JQKNO6TCTSVL4K3JDLDZBPK',
      sequence: '1234567890',
    }),
    submitTransaction: jest.fn().mockResolvedValue({
      hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      status: 'SUCCESS',
    }),
    getFeeStats: jest.fn().mockResolvedValue({
      feeCharged: {
        min: 100,
        max: 1000,
        mode: 100,
      },
    }),
  })),
  Keypair: {
    fromSecret: jest.fn().mockReturnValue({
      publicKey: () =>
        'GBXGQJWVLWOYHFLVTKWV5FGHA3JYYV3A7JQKNO6TCTSVL4K3JDLDZBPK',
      secret: () =>
        'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    }),
    random: jest.fn().mockReturnValue({
      publicKey: () =>
        'GBXGQJWVLWOYHFLVTKWV5FGHA3JYYV3A7JQKNO6TCTSVL4K3JDLDZBPK',
    }),
  },
  Networks: {
    PUBLIC: 'Public Global Stellar Network ; September 2015',
    TESTNET: 'Test SDF Network ; September 2015',
  },
  Asset: {
    native: jest.fn().mockReturnValue({
      isNative: true,
      getCode: () => 'XLM',
      getIssuer: () => null,
    }),
  },
  Operation: {
    payment: jest.fn().mockReturnValue({
      type: 'payment',
      destination: 'GBXGQJWVLWOYHFLVTKWV5FGHA3JYYV3A7JQKNO6TCTSVL4K3JDLDZBPK',
      asset: { isNative: true },
      amount: '1000',
    }),
    createAccount: jest.fn().mockReturnValue({
      type: 'createAccount',
      destination: 'GBXGQJWVLWOYHFLVTKWV5FGHA3JYYV3A7JQKNO6TCTSVL4K3JDLDZBPK',
      startingBalance: '1000',
    }),
  },
  TransactionBuilder: jest.fn().mockImplementation((_account, _options) => ({
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnValue({
      toXDR: () => 'AAAAAgAAA...',
      sign: jest.fn(),
      hash: () => Buffer.from('1234567890abcdef', 'hex'),
    }),
  })),
};

export default mockStellarSDK;

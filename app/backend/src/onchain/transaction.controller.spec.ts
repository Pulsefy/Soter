import { Test, TestingModule } from '@nestjs/testing';
import { TransactionController } from './transaction.controller';
import { ONCHAIN_ADAPTER_TOKEN, OnchainAdapter } from './onchain.adapter';
import { InternalServerErrorException } from '@nestjs/common';

describe('TransactionController', () => {
  let controller: TransactionController;
  let mockOnchainAdapter: jest.Mocked<OnchainAdapter>;

  beforeEach(async () => {
    mockOnchainAdapter = {
      getTransactionStatus: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionController],
      providers: [
        {
          provide: ONCHAIN_ADAPTER_TOKEN,
          useValue: mockOnchainAdapter,
        },
      ],
    }).compile();

    controller = module.get<TransactionController>(TransactionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getTransactionStatus', () => {
    it('should return pending status', async () => {
      const mockResult = {
        transactionHash: 'hash-123',
        status: 'pending' as const,
        timestamp: new Date(),
      };
      mockOnchainAdapter.getTransactionStatus.mockResolvedValue(mockResult);

      const result = await controller.getTransactionStatus('hash-123');

      expect(result).toEqual(mockResult);
      expect(mockOnchainAdapter.getTransactionStatus).toHaveBeenCalledWith({
        transactionHash: 'hash-123',
      });
    });

    it('should return succeeded status', async () => {
      const mockResult = {
        transactionHash: 'hash-123',
        status: 'succeeded' as const,
        timestamp: new Date(),
      };
      mockOnchainAdapter.getTransactionStatus.mockResolvedValue(mockResult);

      const result = await controller.getTransactionStatus('hash-123');

      expect(result).toEqual(mockResult);
    });

    it('should return failed status', async () => {
      const mockResult = {
        transactionHash: 'hash-123',
        status: 'failed' as const,
        timestamp: new Date(),
      };
      mockOnchainAdapter.getTransactionStatus.mockResolvedValue(mockResult);

      const result = await controller.getTransactionStatus('hash-123');

      expect(result).toEqual(mockResult);
    });

    it('should handle timeout or unknown errors properly', async () => {
      // Simulate timeout error thrown by adapter mapping
      mockOnchainAdapter.getTransactionStatus.mockRejectedValue({
        code: 'ETIMEDOUT',
        message: 'Timeout',
      });

      // The error mapper will map this to a 504 status (which corresponds to InternalServerErrorException via the default fallback if not explicitly thrown as such)
      // Actually, SorobanErrorMapper throws standard NestJS HttpExceptions based on its mapped status code.
      // Wait, 504 isn't explicitly handled in throwMappedError (it handles 400,403,404,409,410,503), so it throws InternalServerErrorException.
      await expect(controller.getTransactionStatus('hash-123')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});

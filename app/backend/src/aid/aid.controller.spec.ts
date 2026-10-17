import { Test, TestingModule } from '@nestjs/testing';
import { AidController } from './aid.controller';
import { AidService } from './aid.service';
import { ListAidPackagesDto } from './dto/list-aid-packages.dto';
import { ListRecipientPackagesDto } from './dto/list-recipient-packages.dto';

describe('AidController', () => {
  let controller: AidController;
  let service: AidService;

  const mockPaginatedResult = {
    data: [
      { id: 'pkg-1', status: 'Active', totalAmount: 1000 },
      { id: 'pkg-2', status: 'Claimed', totalAmount: 2000 },
    ],
    total: 2,
    page: 1,
    size: 10,
    totalPages: 1,
  };

  const mockRecipientPaginatedResult = {
    data: [
      { id: 'pkg-1', status: 'Active', totalAmount: 1000 },
      { id: 'pkg-3', status: 'Active', totalAmount: 500 },
    ],
    total: 2,
    page: 1,
    size: 10,
    totalPages: 1,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AidController],
      providers: [
        {
          provide: AidService,
          useValue: {
            listAidPackages: jest.fn().mockResolvedValue(mockPaginatedResult),
            listRecipientPackages: jest
              .fn()
              .mockResolvedValue(mockRecipientPaginatedResult),
            getRecipientPackageCount: jest.fn().mockResolvedValue(2),
            createCampaign: jest.fn(),
            updateCampaign: jest.fn(),
            archiveCampaign: jest.fn(),
            transitionClaim: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AidController>(AidController);
    service = module.get<AidService>(AidService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /aid/packages', () => {
    it('returns paginated results with default params', async () => {
      const result = await controller.listPackages({});

      expect(result).toEqual(mockPaginatedResult);
      expect(service.listAidPackages).toHaveBeenCalledWith({});
    });

    it('passes all query params to the service', async () => {
      const query: ListAidPackagesDto = {
        page: 2,
        size: 5,
        sortBy: 'status',
        sortDirection: 'desc',
        search: 'food',
        status: 'Active',
        token: 'USDC',
      };

      await controller.listPackages(query);

      expect(service.listAidPackages).toHaveBeenCalledWith(query);
    });

    it('returns empty results correctly', async () => {
      const emptyResult = {
        data: [],
        total: 0,
        page: 1,
        size: 10,
        totalPages: 0,
      };
      (service.listAidPackages as jest.Mock).mockResolvedValueOnce(emptyResult);

      const result = await controller.listPackages({ status: 'Nonexistent' });

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('returns correct pagination metadata', async () => {
      const multiPageResult = {
        data: [{ id: 'pkg-1' }],
        total: 50,
        page: 3,
        size: 10,
        totalPages: 5,
      };
      (service.listAidPackages as jest.Mock).mockResolvedValueOnce(
        multiPageResult,
      );

      const result = await controller.listPackages({ page: 3, size: 10 });

      expect(result.page).toBe(3);
      expect(result.total).toBe(50);
      expect(result.totalPages).toBe(5);
    });

    it('handles service errors gracefully', async () => {
      (service.listAidPackages as jest.Mock).mockRejectedValueOnce(
        new Error('Database connection failed'),
      );

      await expect(controller.listPackages({})).rejects.toThrow(
        'Database connection failed',
      );
    });
  });

  describe('GET /aid/recipients/:recipient/packages', () => {
    it('returns paginated packages for a recipient with default params', async () => {
      const result = await controller.listRecipientPackages('recipient-1', {});

      expect(result).toEqual(mockRecipientPaginatedResult);
      expect(service.listRecipientPackages).toHaveBeenCalledWith(
        'recipient-1',
        {},
      );
    });

    it('passes all query params to the service', async () => {
      const query: ListRecipientPackagesDto = {
        page: 2,
        size: 5,
        sortBy: 'status',
        sortDirection: 'desc',
        status: 'Active',
        token: 'USDC',
      };

      await controller.listRecipientPackages('recipient-1', query);

      expect(service.listRecipientPackages).toHaveBeenCalledWith(
        'recipient-1',
        query,
      );
    });

    it('returns empty results for a recipient with no packages', async () => {
      const emptyResult = {
        data: [],
        total: 0,
        page: 1,
        size: 10,
        totalPages: 0,
      };
      (service.listRecipientPackages as jest.Mock).mockResolvedValueOnce(
        emptyResult,
      );

      const result = await controller.listRecipientPackages(
        'recipient-empty',
        {},
      );

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
    });

    it('returns correct pagination metadata for multi-page recipients', async () => {
      const multiPageResult = {
        data: [{ id: 'pkg-1' }],
        total: 50,
        page: 3,
        size: 10,
        totalPages: 5,
      };
      (service.listRecipientPackages as jest.Mock).mockResolvedValueOnce(
        multiPageResult,
      );

      const result = await controller.listRecipientPackages(
        'recipient-1',
        { page: 3, size: 10 },
      );

      expect(result.page).toBe(3);
      expect(result.total).toBe(50);
      expect(result.totalPages).toBe(5);
    });

    it('handles service errors gracefully', async () => {
      (service.listRecipientPackages as jest.Mock).mockRejectedValueOnce(
        new Error('Database connection failed'),
      );

      await expect(
        controller.listRecipientPackages('recipient-1', {}),
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('GET /aid/recipients/:recipient/packages/count', () => {
    it('returns the package count for a recipient', async () => {
      const result = await controller.getRecipientPackageCount('recipient-1');

      expect(result).toEqual({ count: 2 });
      expect(service.getRecipientPackageCount).toHaveBeenCalledWith(
        'recipient-1',
      );
    });

    it('returns zero for a recipient with no packages', async () => {
      (service.getRecipientPackageCount as jest.Mock).mockResolvedValueOnce(0);

      const result = await controller.getRecipientPackageCount(
        'recipient-empty',
      );

      expect(result).toEqual({ count: 0 });
    });

    it('handles service errors gracefully', async () => {
      (service.getRecipientPackageCount as jest.Mock).mockRejectedValueOnce(
        new Error('Database connection failed'),
      );

      await expect(
        controller.getRecipientPackageCount('recipient-1'),
      ).rejects.toThrow('Database connection failed');
    });
  });
});

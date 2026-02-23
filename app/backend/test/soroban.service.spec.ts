import { Test, TestingModule } from '@nestjs/testing';
import { SorobanService } from '../src/soroban/soroban.service';

describe('SorobanService', () => {
  let service: SorobanService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SorobanService],
    }).compile();

    service = module.get<SorobanService>(SorobanService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create an aid package', async () => {
    const result = await service.createAidPackage({
      recipient: 'test-recipient',
      amount: 100,
      expiresAt: Date.now() + 1000,
    });
    expect(result).toHaveProperty('packageId');
  });

  it('should claim an aid package', async () => {
    await expect(service.claimAidPackage('test-package-id')).resolves.not.toThrow();
  });

  it('should get an aid package', async () => {
    const result = await service.getAidPackage('test-package-id');
    expect(result).toBeDefined();
  });

  it('should get aid package count', async () => {
    const count = await service.getAidPackageCount();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
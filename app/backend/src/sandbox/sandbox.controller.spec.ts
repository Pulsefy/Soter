import { Test, TestingModule } from '@nestjs/testing';
import { SandboxController } from './sandbox.controller';
import { SandboxService } from './sandbox.service';

describe('SandboxController', () => {
  let controller: SandboxController;
  let _service: SandboxService;

  const mockSandboxService = {
    resetDemoState: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SandboxController],
      providers: [
        {
          provide: SandboxService,
          useValue: mockSandboxService,
        },
      ],
    }).compile();

    controller = module.get<SandboxController>(SandboxController);
    _service = module.get<SandboxService>(SandboxService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('resetDemoSeed', () => {
    it('should call sandboxService.resetDemoState and return a success message', async () => {
      mockSandboxService.resetDemoState.mockResolvedValue(undefined);
      await expect(controller.resetDemoSeed()).resolves.toEqual({
        message: 'Demo seed data reset successfully.',
      });
      expect(mockSandboxService.resetDemoState).toHaveBeenCalledTimes(1);
    });
  });
});

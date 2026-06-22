import { Test, TestingModule } from '@nestjs/testing';
import { ObservabilityController } from './observability.controller';
import { ObservabilityService } from './observability.service';

describe('ObservabilityController', () => {
  let controller: ObservabilityController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ObservabilityController],
      providers: [ObservabilityService],
    }).compile();

    controller = module.get<ObservabilityController>(ObservabilityController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

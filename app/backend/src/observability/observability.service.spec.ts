import { Test, TestingModule } from '@nestjs/testing';
import { ObservabilityService } from './observability.service';

describe('ObservabilityService', () => {
  let service: ObservabilityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ObservabilityService],
    }).compile();

    service = module.get<ObservabilityService>(ObservabilityService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

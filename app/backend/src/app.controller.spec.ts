import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return welcome message', () => {
      expect(appController.getHello()).toEqual({
        message: 'Welcome to Pulsefy/Soter API',
        version: 'v1',
        docs: '/api/docs',
        endpoints: {
          health: '/api/v1/health',
          aid: '/api/v1/aid',
          verification: '/api/v1/verification',
        },
      });
    });
  });
});

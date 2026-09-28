import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

const createdModules: TestingModule[] = [];
const createdApps: INestApplication[] = [];

const originalCreateTestingModule = Test.createTestingModule;

Test.createTestingModule = function (metadata: any) {
  const testingModuleBuilder = originalCreateTestingModule.call(Test, metadata);
  const originalCompile = testingModuleBuilder.compile;

  testingModuleBuilder.compile = async function () {
    const module = await originalCompile.call(testingModuleBuilder);
    createdModules.push(module);

    const originalCreateNestApplication = module.createNestApplication;

    module.createNestApplication = function (...args: any[]) {
      const app = originalCreateNestApplication.apply(this, args);
      createdApps.push(app);
      return app;
    };

    return module;
  };

  return testingModuleBuilder;
};

afterAll(async () => {
  while (createdApps.length > 0) {
    const app = createdApps.pop();
    if (app) {
      try {
        await app.close();
      } catch {
        // ignore
      }
    }
  }

  while (createdModules.length > 0) {
    const module = createdModules.pop();
    if (module) {
      try {
        await module.close();
      } catch {
        // ignore
      }
    }
  }
});

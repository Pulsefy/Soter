import { Module } from '@nestjs/common';
import { TestErrorController } from './test-error.controller';

@Module({
  controllers: [TestErrorController],
})
export class TestErrorModule {}

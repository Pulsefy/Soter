import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SandboxController } from './sandbox.controller';
import { SandboxGuard } from './sandbox.guard';
import { SeedService } from './seed.service';

@Module({
  imports: [PrismaModule],
  controllers: [SandboxController],
  providers: [SeedService, SandboxGuard],
})
export class SandboxModule {}

import { Module } from '@nestjs/common';
import { ResumableUploadService } from './resumable-upload.service';
import { ResumableUploadController } from './resumable-upload.controller';
import { UploadRepository } from './upload.repository';
import { ChunkStorageService } from './chunk-storage.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { EncryptionModule } from '../../common/encryption/encryption.module';
import { AuditModule } from '../../audit/audit.module';

@Module({
  imports: [PrismaModule, EncryptionModule, AuditModule],
  controllers: [ResumableUploadController],
  providers: [ResumableUploadService, UploadRepository, ChunkStorageService],
  exports: [ResumableUploadService, UploadRepository, ChunkStorageService],
})
export class ResumableUploadModule {}

/**
 * WebAuthn module — provides biometric / passkey authentication for the Soter platform.
 *
 * Registers the WebAuthnController and WebAuthnService.
 * Depends on PrismaModule for database access and ConfigModule for environment configuration.
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WebAuthnController } from './webauthn.controller';
import { WebAuthnService } from './webauthn.service';

@Module({
  imports: [PrismaModule],
  controllers: [WebAuthnController],
  providers: [WebAuthnService],
  exports: [WebAuthnService],
})
export class WebAuthnModule {}

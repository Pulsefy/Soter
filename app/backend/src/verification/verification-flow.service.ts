import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationChannel } from '@prisma/client';
import {
  StartVerificationDto,
  VerificationChannelDto,
} from './dto/start-verification.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { CompleteVerificationDto } from './dto/complete-verification.dto';

const DEFAULT_CODE_LENGTH = 6;
const DEFAULT_TTL_MINUTES = 10;
const DEFAULT_MAX_STARTS_PER_IDENTIFIER_PER_HOUR = 5;
const DEFAULT_MAX_RESENDS_PER_SESSION = 3;
const DEFAULT_MAX_ATTEMPTS_PER_SESSION = 5;

@Injectable()
export class VerificationFlowService {
  private readonly logger = new Logger(VerificationFlowService.name);
  private readonly codeLength: number;
  private readonly ttlMinutes: number;
  private readonly maxStartsPerIdentifierPerHour: number;
  private readonly maxResendsPerSession: number;
  private readonly maxAttemptsPerSession: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.codeLength =
      this.configService.get<number>('VERIFICATION_OTP_LENGTH') ??
      DEFAULT_CODE_LENGTH;
    this.ttlMinutes =
      this.configService.get<number>('VERIFICATION_OTP_TTL_MINUTES') ??
      DEFAULT_TTL_MINUTES;
    this.maxStartsPerIdentifierPerHour =
      this.configService.get<number>(
        'VERIFICATION_MAX_STARTS_PER_IDENTIFIER_PER_HOUR',
      ) ?? DEFAULT_MAX_STARTS_PER_IDENTIFIER_PER_HOUR;
    this.maxResendsPerSession =
      this.configService.get<number>('VERIFICATION_MAX_RESENDS_PER_SESSION') ??
      DEFAULT_MAX_RESENDS_PER_SESSION;
    this.maxAttemptsPerSession =
      this.configService.get<number>('VERIFICATION_MAX_ATTEMPTS_PER_SESSION') ??
      DEFAULT_MAX_ATTEMPTS_PER_SESSION;
  }

  async start(dto: StartVerificationDto): Promise<{
    sessionId: string;
    channel: string;
    expiresAt: string;
    message: string;
  }> {
    const identifier = this.getIdentifier(dto);
    if (!identifier) {
      throw new BadRequestException(
        'email is required when channel is email, phone is required when channel is phone',
      );
    }

    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await this.prisma.verificationSession.count({
      where: {
        identifier,
        createdAt: { gte: since },
      },
    });
    if (recentCount >= this.maxStartsPerIdentifierPerHour) {
      this.logger.warn(
        `Rate limit: too many verification starts for identifier (${recentCount} in last hour)`,
      );
      throw new BadRequestException(
        `Too many verification requests. Try again after some time.`,
      );
    }

    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + this.ttlMinutes * 60 * 1000);

    const session = await this.prisma.verificationSession.create({
      data: {
        channel: dto.channel as VerificationChannel,
        identifier,
        code,
        expiresAt,
      },
    });

    this.sendCode(dto.channel, identifier, code);

    this.logger.log(
      `Verification session started: ${session.id} for ${dto.channel}:${identifier}`,
    );

    return {
      sessionId: session.id,
      channel: dto.channel,
      expiresAt: expiresAt.toISOString(),
      message: `Verification code sent to ${dto.channel}. Code expires in ${this.ttlMinutes} minutes.`,
    };
  }

  async resend(dto: ResendVerificationDto): Promise<{
    sessionId: string;
    expiresAt: string;
    message: string;
  }> {
    const session = await this.prisma.verificationSession.findUnique({
      where: { id: dto.sessionId },
    });

    if (!session) {
      throw new NotFoundException('Verification session not found');
    }
    if (session.status !== 'pending') {
      throw new BadRequestException(
        'Session is no longer active. Start a new verification.',
      );
    }
    if (session.expiresAt < new Date()) {
      await this.prisma.verificationSession.update({
        where: { id: session.id },
        data: { status: 'expired' },
      });
      throw new BadRequestException(
        'Session expired. Start a new verification.',
      );
    }
    if (session.resendCount >= this.maxResendsPerSession) {
      throw new BadRequestException(
        `Maximum resend limit (${this.maxResendsPerSession}) reached. Request a new code by starting verification again.`,
      );
    }

    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + this.ttlMinutes * 60 * 1000);

    await this.prisma.verificationSession.update({
      where: { id: session.id },
      data: {
        code,
        resendCount: session.resendCount + 1,
        expiresAt,
      },
    });

    this.sendCode(session.channel, session.identifier, code);

    this.logger.log(`Verification code resent for session ${session.id}`);

    return {
      sessionId: session.id,
      expiresAt: expiresAt.toISOString(),
      message: 'New verification code sent.',
    };
  }

  async complete(dto: CompleteVerificationDto): Promise<{
    sessionId: string;
    verified: boolean;
    message: string;
  }> {
    const session = await this.prisma.verificationSession.findUnique({
      where: { id: dto.sessionId },
    });

    if (!session) {
      throw new NotFoundException('Verification session not found');
    }
    if (session.status !== 'pending') {
      throw new BadRequestException(
        'Session is no longer active. Start a new verification.',
      );
    }
    if (session.expiresAt < new Date()) {
      await this.prisma.verificationSession.update({
        where: { id: session.id },
        data: { status: 'expired' },
      });
      throw new BadRequestException(
        'Session expired. Start a new verification.',
      );
    }
    if (session.attempts >= this.maxAttemptsPerSession) {
      throw new BadRequestException(
        'Too many failed attempts. Start a new verification.',
      );
    }

    if (session.code !== dto.code) {
      await this.prisma.verificationSession.update({
        where: { id: session.id },
        data: { attempts: session.attempts + 1 },
      });
      throw new BadRequestException('Invalid verification code.');
    }

    await this.prisma.verificationSession.update({
      where: { id: session.id },
      data: { status: 'completed' },
    });

    this.logger.log(`Verification completed for session ${session.id}`);

    return {
      sessionId: session.id,
      verified: true,
      message: 'Verification completed successfully.',
    };
  }

  private getIdentifier(dto: StartVerificationDto): string | null {
    if (dto.channel === VerificationChannelDto.email && dto.email) {
      return dto.email.trim().toLowerCase();
    }
    if (dto.channel === VerificationChannelDto.phone && dto.phone) {
      return dto.phone.trim();
    }
    return null;
  }

  private generateCode(): string {
    const max = Math.pow(10, this.codeLength) - 1;
    const min = Math.pow(10, this.codeLength - 1);
    const code = Math.floor(min + Math.random() * (max - min + 1));
    return String(code);
  }

  private sendCode(channel: string, identifier: string, code: string): void {
    // Mock: in production, integrate with email/SMS provider
    this.logger.debug(
      `[Mock] Sending ${channel} verification code to ${identifier}: ${code}`,
    );
  }
}

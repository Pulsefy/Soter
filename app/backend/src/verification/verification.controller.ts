import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Version,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
  ApiConsumes,
  ApiSecurity,
} from '@nestjs/swagger';
import { VerificationService } from './verification.service';
import { VerificationFlowService } from './verification-flow.service';
import { CreateVerificationDto } from './dto/create-verification.dto';
import { API_VERSIONS } from '../common/constants/api-version.constants';
import { StartVerificationDto } from './dto/start-verification.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { CompleteVerificationDto } from './dto/complete-verification.dto';

@ApiTags('verification')
@ApiSecurity('x-api-key')
@Controller('verification')
export class VerificationController {
  constructor(
    private readonly verificationService: VerificationService,
    private readonly verificationFlowService: VerificationFlowService,
  ) {}

  @Post('claims/:id/enqueue')
  @Version('1')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Enqueue claim verification job',
    description:
      'Add a claim to the verification queue for async processing. Returns immediately with job ID.',
  })
  @ApiParam({
    name: 'id',
    description: 'Unique identifier of the claim to verify',
    example: 'clv789xyz123',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Verification job enqueued successfully',
    schema: {
      example: {
        jobId: '12345',
        claimId: 'clv789xyz123',
        status: 'queued',
        message: 'Verification job enqueued successfully',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Claim not found',
  })
  async enqueueVerification(@Param('id') id: string) {
    const { jobId } = await this.verificationService.enqueueVerification(id);
    return {
      jobId,
      claimId: id,
      status: 'queued',
      message: 'Verification job enqueued successfully',
    };
  }

  @Get('metrics')
  @Version('1')
  @ApiOperation({
    summary: 'Get verification queue metrics',
    description:
      'Retrieve current queue statistics including waiting, active, completed, and failed job counts',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Queue metrics retrieved successfully',
    schema: {
      example: {
        waiting: 5,
        active: 2,
        completed: 150,
        failed: 3,
        total: 160,
      },
    },
  })
  async getMetrics() {
    return this.verificationService.getQueueMetrics();
  }

  @Post('start')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start verification flow (OTP/email/phone)',
    description:
      'Start a verification session. Sends an OTP to the given email or phone. Rate-limited per identifier.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Verification started; code sent to channel',
    schema: {
      example: {
        sessionId: 'clv789xyz123',
        channel: 'email',
        expiresAt: '2025-02-19T12:10:00.000Z',
        message: 'Verification code sent to email. Code expires in 10 minutes.',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input or rate limit exceeded',
  })
  async startVerification(@Body() dto: StartVerificationDto) {
    return this.verificationFlowService.start(dto);
  }

  @Post('resend')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resend verification code',
    description:
      'Resend OTP for an existing pending session. Limited resends per session.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'New code sent',
    schema: {
      example: {
        sessionId: 'clv789xyz123',
        expiresAt: '2025-02-19T12:10:00.000Z',
        message: 'New verification code sent.',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Session inactive, expired, or resend limit exceeded',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Verification session not found',
  })
  async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.verificationFlowService.resend(dto);
  }

  @Post('complete')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete verification with OTP',
    description:
      'Submit the OTP code to complete the verification. Attempts are rate-limited per session.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Verification completed successfully',
    schema: {
      example: {
        sessionId: 'clv789xyz123',
        verified: true,
        message: 'Verification completed successfully.',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid code, session expired, or too many attempts',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Verification session not found',
  })
  async completeVerification(@Body() dto: CompleteVerificationDto) {
    return this.verificationFlowService.complete(dto);
  }

  @Post()
  @Version(API_VERSIONS.V1)
  @ApiOperation({
    summary: 'Submit identity verification request (v1)',
    description:
      'Submit identity documents and information for verification. Supports document uploads and biometric data. Part of v1 API.',
  })
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Verification request submitted successfully',
    schema: {
      example: {
        id: 'clv789xyz123',
        userId: 'clu456def789',
        documentType: 'NATIONAL_ID',
        status: 'PENDING',
        submittedAt: '2025-01-23T11:00:00.000Z',
        verificationCode: 'VER-2025-0123',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid verification data or document format',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Authentication required',
  })
  create(@Body() createVerificationDto: CreateVerificationDto) {
    return this.verificationService.create(createVerificationDto);
  }

  @Get('claims/:id')
  @Version('1')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get claim verification status',
    description:
      'Retrieve the current verification status and details of a claim',
  })
  @ApiParam({
    name: 'id',
    description: 'Unique identifier of the claim',
    example: 'clv789xyz123',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Claim verification status retrieved successfully',
    schema: {
      example: {
        id: 'clv789xyz123',
        status: 'verified',
        verificationScore: 0.85,
        verificationResult: {
          score: 0.85,
          confidence: 0.92,
          details: {
            factors: [
              'Document authenticity verified',
              'Identity cross-reference passed',
            ],
            riskLevel: 'low',
          },
          processedAt: '2025-01-23T14:30:00.000Z',
        },
        verifiedAt: '2025-01-23T14:30:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Claim not found',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized - authentication required',
  })
  findClaim(@Param('id') id: string) {
    return this.verificationService.findOne(id);
  }

  @Get(':id')
  @Version(API_VERSIONS.V1)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get verification status (v1)',
    description:
      'Retrieve the current status and details of a verification request. Part of v1 API.',
  })
  @ApiParam({
    name: 'id',
    description: 'Unique identifier of the verification request',
    example: 'clv789xyz123',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Verification status retrieved successfully',
    schema: {
      example: {
        id: 'clv789xyz123',
        userId: 'clu456def789',
        documentType: 'NATIONAL_ID',
        status: 'APPROVED',
        submittedAt: '2025-01-23T11:00:00.000Z',
        reviewedAt: '2025-01-23T14:30:00.000Z',
        verificationCode: 'VER-2025-0123',
        notes: 'All documents verified successfully',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Verification request not found',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized - authentication required',
  })
  findOne(@Param('id') id: string) {
    return this.verificationService.findOne(id);
  }

  @Get('user/:userId')
  @Version(API_VERSIONS.V1)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get user verification history (v1)',
    description: 'Retrieve all verification requests for a specific user. Part of v1 API.',
  })
  @ApiParam({
    name: 'userId',
    description: 'Unique identifier of the user',
    example: 'clu456def789',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User verification history retrieved successfully',
    schema: {
      example: [
        {
          id: 'clv789xyz123',
          documentType: 'NATIONAL_ID',
          status: 'APPROVED',
          submittedAt: '2025-01-23T11:00:00.000Z',
          reviewedAt: '2025-01-23T14:30:00.000Z',
        },
      ],
    },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized - authentication required',
  })
  findByUser(@Param('userId') userId: string) {
    return this.verificationService.findByUser(userId);
  }

  @Post(':id/complete')
  @Version('1')
  @ApiOperation({
    summary: 'Mark verification as complete',
    description:
      'Updates the status of a verification request to complete and logs the action.',
  })
  @ApiParam({
    name: 'id',
    description: 'Unique identifier of the verification request',
  })
  update(@Param('id') id: string, @Body() data: Record<string, unknown>) {
    return this.verificationService.update(id, data);
  }
}

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
} from '@nestjs/swagger';
import { VerificationService } from './verification.service';
import { CreateVerificationDto } from './dto/create-verification.dto';

@ApiTags('verification')
@Controller('verification')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

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

  @Post()
  @Version('1')
  @ApiOperation({
    summary: 'Submit identity verification request',
    description:
      'Submit identity documents and information for verification. Supports document uploads and biometric data.',
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
  @Version('1')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get verification status',
    description:
      'Retrieve the current status and details of a verification request',
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
  @Version('1')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get user verification history',
    description: 'Retrieve all verification requests for a specific user',
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

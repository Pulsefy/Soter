import {
  Controller,
  Get,
  Query,
  Param,
  Post,
  Body,
  Version,
  HttpStatus,
  HttpCode,
  Request,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { VerificationInboxService } from './verification-inbox.service';
import { Roles } from 'src/auth/roles.decorator';
import { AppRole } from 'src/auth/app-role.enum';

@ApiTags('Verification Inbox')
@ApiBearerAuth('JWT-auth')
@Controller('verification-inbox')
export class VerificationInboxController {
  constructor(
    private readonly verificationInboxService: VerificationInboxService,
  ) {}

  @Get()
  @Version('1')
  @ApiOperation({
    summary: 'Get verification inbox',
    description:
      'Retrieve verification requests with filtering and pagination. Shows pending_review, approved, rejected, and needs_resubmission states.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending_review', 'approved', 'rejected', 'needs_resubmission'],
    description: 'Filter by verification status',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 20)',
  })
  @ApiOkResponse({
    description: 'Verification inbox retrieved successfully.',
    schema: {
      example: {
        items: [
          {
            id: 'clv789xyz123',
            status: 'pending_review',
            createdAt: '2025-01-23T11:00:00.000Z',
            reviewedAt: null,
            nextStepMessage: 'Review identity documents for authenticity',
            deepLink: '/verification/clv789xyz123',
          },
        ],
        total: 45,
        page: 1,
        limit: 20,
        totalPages: 3,
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - valid JWT token required.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - operator or admin role required.',
  })
  async getInbox(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Request() req?: ExpressRequest,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    const userId = (req?.user as any)?.sub || (req?.user as any)?.apiKeyId;

    return this.verificationInboxService.getInbox(
      status,
      pageNum,
      limitNum,
      userId,
    );
  }

  @Get('stats')
  @Version('1')
  @ApiOperation({
    summary: 'Get verification inbox statistics',
    description:
      'Retrieve counts of verification requests by status for dashboard display.',
  })
  @ApiOkResponse({
    description: 'Statistics retrieved successfully.',
    schema: {
      example: {
        pending_review: 15,
        approved: 120,
        rejected: 8,
        needs_resubmission: 5,
        total: 148,
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - valid JWT token required.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - operator or admin role required.',
  })
  async getStats() {
    return this.verificationInboxService.getStats();
  }

  @Post(':id/approve')
  @Version('1')
  @Roles(AppRole.operator, AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve verification request',
    description:
      'Mark a verification request as approved and set next step messaging.',
  })
  @ApiParam({
    name: 'id',
    description: 'Unique identifier of the verification request',
  })
  @ApiOkResponse({
    description: 'Verification approved successfully.',
    schema: {
      example: {
        id: 'clv789xyz123',
        status: 'approved',
        reviewedAt: '2025-01-23T14:30:00.000Z',
        nextStepMessage: 'Verification approved. Proceed to disbursement.',
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'The specified verification request was not found.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid request or verification already processed.',
  })
  async approve(
    @Param('id') id: string,
    @Body() body: { nextStepMessage?: string },
    @Request() req: ExpressRequest,
  ) {
    const reviewerId =
      (req.user as any)?.sub || (req.user as any)?.apiKeyId || 'system';
    return this.verificationInboxService.updateStatus(
      id,
      'approved',
      reviewerId,
      body.nextStepMessage,
      undefined,
    );
  }

  @Post(':id/reject')
  @Version('1')
  @Roles(AppRole.operator, AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject verification request',
    description:
      'Mark a verification request as rejected with reason and next step messaging.',
  })
  @ApiParam({
    name: 'id',
    description: 'Unique identifier of the verification request',
  })
  @ApiOkResponse({
    description: 'Verification rejected successfully.',
    schema: {
      example: {
        id: 'clv789xyz123',
        status: 'rejected',
        reviewedAt: '2025-01-23T14:30:00.000Z',
        rejectionReason: 'Document appears fraudulent',
        nextStepMessage: 'Please resubmit with valid documentation',
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'The specified verification request was not found.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid request or verification already processed.',
  })
  async reject(
    @Param('id') id: string,
    @Body() body: { rejectionReason: string; nextStepMessage?: string },
    @Request() req: ExpressRequest,
  ) {
    const reviewerId =
      (req.user as any)?.sub || (req.user as any)?.apiKeyId || 'system';
    return this.verificationInboxService.updateStatus(
      id,
      'rejected',
      reviewerId,
      body.nextStepMessage,
      body.rejectionReason,
    );
  }

  @Post(':id/request-resubmission')
  @Version('1')
  @Roles(AppRole.operator, AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request resubmission for verification',
    description:
      'Mark a verification request as needing resubmission with specific requirements.',
  })
  @ApiParam({
    name: 'id',
    description: 'Unique identifier of the verification request',
  })
  @ApiOkResponse({
    description: 'Resubmission requested successfully.',
    schema: {
      example: {
        id: 'clv789xyz123',
        status: 'needs_resubmission',
        reviewedAt: '2025-01-23T14:30:00.000Z',
        rejectionReason: 'Document expired',
        nextStepMessage: 'Please submit a current government-issued ID',
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'The specified verification request was not found.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid request or verification already processed.',
  })
  async requestResubmission(
    @Param('id') id: string,
    @Body() body: { rejectionReason: string; nextStepMessage: string },
    @Request() req: ExpressRequest,
  ) {
    const reviewerId =
      (req.user as any)?.sub || (req.user as any)?.apiKeyId || 'system';
    return this.verificationInboxService.updateStatus(
      id,
      'needs_resubmission',
      reviewerId,
      body.nextStepMessage,
      body.rejectionReason,
    );
  }

  @Get(':id')
  @Version('1')
  @ApiOperation({
    summary: 'Get verification request details',
    description:
      'Retrieve detailed information about a specific verification request including review history.',
  })
  @ApiParam({
    name: 'id',
    description: 'Unique identifier of the verification request',
  })
  @ApiOkResponse({
    description: 'Verification details retrieved successfully.',
    schema: {
      example: {
        id: 'clv789xyz123',
        status: 'pending_review',
        createdAt: '2025-01-23T11:00:00.000Z',
        reviewedAt: null,
        reviewedBy: null,
        rejectionReason: null,
        nextStepMessage: 'Review identity documents for authenticity',
        deepLink: '/verification/clv789xyz123',
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'The specified verification request was not found.',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - valid JWT token required.',
  })
  async getDetails(@Param('id') id: string) {
    return this.verificationInboxService.getDetails(id);
  }
}

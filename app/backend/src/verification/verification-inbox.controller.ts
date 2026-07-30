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
  ApiConflictResponse,
} from '@nestjs/swagger';
import { VerificationInboxService } from './verification-inbox.service';
import { ReviewLockService } from './review-lock.service';
import { Roles } from 'src/auth/roles.decorator';
import { AppRole } from 'src/auth/app-role.enum';
import {
  ReleaseLockDto,
  RefreshLockDto,
  LockEntityType,
} from './dto/review-lock.dto';

interface InboxUser {
  sub?: string;
  apiKeyId?: string;
}

@ApiTags('Verification Inbox')
@ApiBearerAuth('JWT-auth')
@Controller('verification-inbox')
export class VerificationInboxController {
  constructor(
    private readonly verificationInboxService: VerificationInboxService,
    private readonly reviewLockService: ReviewLockService,
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
    const user = req?.user as InboxUser | undefined;
    const userId: string | undefined = user?.apiKeyId;

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
      'Mark a verification request as approved and set next step messaging. Requires holding the review lock.',
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
  @ApiConflictResponse({
    description: 'You do not hold the lock for this verification request.',
  })
  async approve(
    @Param('id') id: string,
    @Body() body: { nextStepMessage?: string; internalNote?: string },
    @Request() req: ExpressRequest,
  ) {
    const user = req.user as InboxUser | undefined;
    const reviewerId: string = user?.apiKeyId ?? 'system';

    // Verify lock ownership before allowing the action
    const lockResult = await this.reviewLockService.verifyLockOwnership(
      LockEntityType.VERIFICATION,
      id,
      reviewerId,
    );

    if (!lockResult.success) {
      return {
        success: false,
        code: lockResult.code,
        message: lockResult.message,
        conflict: lockResult.conflict,
        requiresLock: true,
      };
    }

    const result = await this.verificationInboxService.updateStatus(
      id,
      'approved',
      reviewerId,
      body.nextStepMessage,
      undefined,
      body.internalNote,
    );

    // Release the lock after successful review
    await this.reviewLockService.releaseLockForReview(
      LockEntityType.VERIFICATION,
      id,
      reviewerId,
    );

    return {
      ...result,
      lockReleased: true,
    };
  }

  @Post(':id/reject')
  @Version('1')
  @Roles(AppRole.operator, AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject verification request',
    description:
      'Mark a verification request as rejected with reason and next step messaging. Requires holding the review lock.',
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
  @ApiConflictResponse({
    description: 'You do not hold the lock for this verification request.',
  })
  async reject(
    @Param('id') id: string,
    @Body()
    body: {
      rejectionReason: string;
      nextStepMessage?: string;
      internalNote?: string;
    },
    @Request() req: ExpressRequest,
  ) {
    const user = req.user as InboxUser | undefined;
    const reviewerId: string = user?.apiKeyId ?? 'system';

    // Verify lock ownership before allowing the action
    const lockResult = await this.reviewLockService.verifyLockOwnership(
      LockEntityType.VERIFICATION,
      id,
      reviewerId,
    );

    if (!lockResult.success) {
      return {
        success: false,
        code: lockResult.code,
        message: lockResult.message,
        conflict: lockResult.conflict,
        requiresLock: true,
      };
    }

    const result = await this.verificationInboxService.updateStatus(
      id,
      'rejected',
      reviewerId,
      body.nextStepMessage,
      body.rejectionReason,
      body.internalNote,
    );

    // Release the lock after successful review
    await this.reviewLockService.releaseLockForReview(
      LockEntityType.VERIFICATION,
      id,
      reviewerId,
    );

    return {
      ...result,
      lockReleased: true,
    };
  }

  @Post(':id/request-resubmission')
  @Version('1')
  @Roles(AppRole.operator, AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request resubmission for verification',
    description:
      'Mark a verification request as needing resubmission with specific requirements. Requires holding the review lock.',
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
  @ApiConflictResponse({
    description: 'You do not hold the lock for this verification request.',
  })
  async requestResubmission(
    @Param('id') id: string,
    @Body()
    body: {
      rejectionReason: string;
      nextStepMessage: string;
      internalNote?: string;
    },
    @Request() req: ExpressRequest,
  ) {
    const user = req.user as InboxUser | undefined;
    const reviewerId: string = user?.apiKeyId ?? 'system';

    // Verify lock ownership before allowing the action
    const lockResult = await this.reviewLockService.verifyLockOwnership(
      LockEntityType.VERIFICATION,
      id,
      reviewerId,
    );

    if (!lockResult.success) {
      return {
        success: false,
        code: lockResult.code,
        message: lockResult.message,
        conflict: lockResult.conflict,
        requiresLock: true,
      };
    }

    const result = await this.verificationInboxService.updateStatus(
      id,
      'needs_resubmission',
      reviewerId,
      body.nextStepMessage,
      body.rejectionReason,
      body.internalNote,
    );

    // Release the lock after successful review
    await this.reviewLockService.releaseLockForReview(
      LockEntityType.VERIFICATION,
      id,
      reviewerId,
    );

    return {
      ...result,
      lockReleased: true,
    };
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

  @Post(':id/notes')
  @Version('1')
  @Roles(AppRole.operator, AppRole.admin)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add internal note to verification request',
    description:
      'Add an internal note visible only to reviewers. The action is recorded in the audit trail.',
  })
  @ApiParam({
    name: 'id',
    description: 'Unique identifier of the verification request',
  })
  @ApiOkResponse({
    description: 'Internal note added successfully.',
    schema: {
      example: {
        id: 'note-abc123',
        entityType: 'verification',
        entityId: 'clv789xyz123',
        content: 'Contacted applicant for additional documents.',
        authorId: 'reviewer-001',
        category: 'follow_up',
        createdAt: '2025-01-23T15:00:00.000Z',
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'The specified verification request was not found.',
  })
  async addInternalNote(
    @Param('id') id: string,
    @Body() body: { content: string; category?: string },
    @Request() req: ExpressRequest,
  ) {
    const user = req.user as InboxUser | undefined;
    const authorId: string = user?.apiKeyId ?? 'system';
    return this.verificationInboxService.addInternalNote(
      id,
      body.content,
      authorId,
      body.category,
    );
  }

  @Get(':id/notes')
  @Version('1')
  @ApiOperation({
    summary: 'List internal notes for a verification request',
    description:
      'Retrieve all internal notes attached to a verification request.',
  })
  @ApiParam({
    name: 'id',
    description: 'Unique identifier of the verification request',
  })
  @ApiOkResponse({
    description: 'Internal notes retrieved successfully.',
  })
  @ApiNotFoundResponse({
    description: 'The specified verification request was not found.',
  })
  async getInternalNotes(@Param('id') id: string) {
    return this.verificationInboxService.getInternalNotes(id);
  }

  // ========================================================================
  // Lock Management Endpoints
  // ========================================================================

  @Post(':id/lock')
  @Version('1')
  @Roles(AppRole.operator, AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Acquire lock on verification request',
    description:
      'Acquire an exclusive lock on a verification request before reviewing. Locks expire after 5 minutes by default.',
  })
  @ApiParam({
    name: 'id',
    description: 'Unique identifier of the verification request',
  })
  @ApiOkResponse({
    description: 'Lock acquired successfully.',
    schema: {
      example: {
        lockId: 'lkabc123xyz',
        entityType: 'verification',
        entityId: 'clv789xyz123',
        lockedBy: 'reviewer-001',
        lockedAt: '2025-01-23T14:00:00.000Z',
        expiresAt: '2025-01-23T14:05:00.000Z',
        code: 'LOCK_ACQUIRED',
        message: 'Lock acquired successfully',
        remainingSeconds: 300,
      },
    },
  })
  @ApiConflictResponse({
    description: 'Verification request is locked by another reviewer.',
    schema: {
      example: {
        code: 'LOCK_ALREADY_LOCKED',
        message: 'Entity is currently locked by another reviewer',
        lockedBy: 'reviewer-002',
        lockedAt: '2025-01-23T14:00:00.000Z',
        expiresAt: '2025-01-23T14:05:00.000Z',
        remainingSeconds: 285,
        suggestedAction: 'try_again_later',
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'The specified verification request was not found.',
  })
  async acquireLock(
    @Param('id') id: string,
    @Body() body: { durationSeconds?: number },
    @Request() req: ExpressRequest,
  ) {
    const user = req.user as InboxUser | undefined;
    const reviewerId: string = user?.apiKeyId ?? 'system';

    // Verify the verification request exists
    const verification = await this.verificationInboxService.getDetails(id);

    const result = await this.reviewLockService.acquireLock(
      {
        entityType: LockEntityType.VERIFICATION,
        entityId: id,
        durationSeconds: body.durationSeconds,
      },
      reviewerId,
    );

    if (!result.success && result.conflict) {
      return {
        ...result.conflict,
        verificationStatus: verification.status,
        deepLink: `/verification/${id}`,
      };
    }

    return {
      ...result.lockInfo,
      verificationStatus: verification.status,
      deepLink: `/verification/${id}`,
    };
  }

  @Post('lock/release')
  @Version('1')
  @Roles(AppRole.operator, AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Release a lock',
    description: 'Release a lock that the reviewer holds.',
  })
  @ApiOkResponse({
    description: 'Lock released successfully.',
    schema: {
      example: {
        lockId: 'lkabc123xyz',
        code: 'LOCK_RELEASED',
        message: 'Lock released successfully',
      },
    },
  })
  @ApiConflictResponse({
    description: 'You do not own this lock.',
  })
  async releaseLock(
    @Body() body: ReleaseLockDto,
    @Request() req: ExpressRequest,
  ) {
    const user = req.user as InboxUser | undefined;
    const reviewerId: string = user?.apiKeyId ?? 'system';

    return this.reviewLockService.releaseLock(body, reviewerId);
  }

  @Post('lock/refresh')
  @Version('1')
  @Roles(AppRole.operator, AppRole.admin)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh a lock',
    description: 'Extend the duration of a lock the reviewer holds.',
  })
  @ApiOkResponse({
    description: 'Lock refreshed successfully.',
    schema: {
      example: {
        lockId: 'lkabc123xyz',
        expiresAt: '2025-01-23T14:10:00.000Z',
        code: 'LOCK_ACQUIRED',
        message: 'Lock refreshed successfully',
        remainingSeconds: 300,
      },
    },
  })
  @ApiConflictResponse({
    description: 'You do not own this lock or lock has expired.',
  })
  async refreshLock(
    @Body() body: RefreshLockDto,
    @Request() req: ExpressRequest,
  ) {
    const user = req.user as InboxUser | undefined;
    const reviewerId: string = user?.apiKeyId ?? 'system';

    return this.reviewLockService.refreshLock(body, reviewerId);
  }

  @Get(':id/lock')
  @Version('1')
  @ApiOperation({
    summary: 'Get lock status for verification request',
    description: 'Check if a verification request is currently locked.',
  })
  @ApiParam({
    name: 'id',
    description: 'Unique identifier of the verification request',
  })
  @ApiOkResponse({
    description: 'Lock status retrieved.',
    schema: {
      example: {
        lockId: 'lkabc123xyz',
        entityType: 'verification',
        entityId: 'clv789xyz123',
        lockedBy: 'reviewer-002',
        lockedAt: '2025-01-23T14:00:00.000Z',
        expiresAt: '2025-01-23T14:05:00.000Z',
        remainingSeconds: 285,
      },
    },
  })
  async getLockStatus(@Param('id') id: string) {
    const lockStatus = await this.reviewLockService.getLockStatus(
      LockEntityType.VERIFICATION,
      id,
    );

    if (!lockStatus) {
      return {
        locked: false,
        entityType: LockEntityType.VERIFICATION,
        entityId: id,
      };
    }

    return {
      locked: true,
      ...lockStatus,
    };
  }

  @Get('locks/my')
  @Version('1')
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({
    summary: 'Get locks held by current reviewer',
    description: 'Retrieve all active locks held by the current reviewer.',
  })
  @ApiOkResponse({
    description: 'Active locks retrieved.',
    schema: {
      example: [
        {
          lockId: 'lkabc123xyz',
          entityType: 'verification',
          entityId: 'clv789xyz123',
          lockedAt: '2025-01-23T14:00:00.000Z',
          expiresAt: '2025-01-23T14:05:00.000Z',
          remainingSeconds: 285,
        },
      ],
    },
  })
  async getMyLocks(@Request() req: ExpressRequest) {
    const user = req.user as InboxUser | undefined;
    const reviewerId: string = user?.apiKeyId ?? 'system';

    return this.reviewLockService.getLocksByReviewer(reviewerId);
  }

  @Get('locks/stats')
  @Version('1')
  @ApiOperation({
    summary: 'Get lock statistics',
    description: 'Get aggregated lock statistics for monitoring.',
  })
  @ApiOkResponse({
    description: 'Lock statistics retrieved.',
    schema: {
      example: {
        activeLocks: 15,
        staleLocks: 2,
        totalLocks: 150,
        locksByEntityType: {
          verification: 12,
          claim: 3,
        },
      },
    },
  })
  async getLockStats() {
    return this.reviewLockService.getLockStats();
  }
}

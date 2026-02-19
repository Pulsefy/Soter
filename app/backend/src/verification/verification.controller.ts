import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Version,
  HttpStatus,
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
import { CreateVerificationDto } from './dto/create-verification.dto';

@ApiTags('verification')
@ApiSecurity('x-api-key')
@Controller('verification')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

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

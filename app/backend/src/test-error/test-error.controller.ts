import {
  Controller,
  Get,
  Post,
  Body,
  ValidationPipe,
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  UsePipes,
} from '@nestjs/common';
import { CreateVerificationDto } from '../verification/dto/create-verification.dto';

import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';

@ApiTags('Test Error')
@Controller('test-error')
export class TestErrorController {
  @ApiOperation({ summary: 'Trigger a generic Error' })
  @ApiInternalServerErrorResponse({ description: 'Generic error triggered.' })
  getGenericError() {
    throw new Error('This is a generic error');
  }

  @ApiOperation({ summary: 'Trigger a BadRequestException' })
  @ApiBadRequestResponse({ description: 'Bad request triggered.' })
  getBadRequest() {
    throw new BadRequestException('This is a bad request error');
  }

  @ApiOperation({ summary: 'Trigger an InternalServerErrorException' })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error triggered.',
  })
  getInternalServerError() {
    throw new InternalServerErrorException('This is an internal server error');
  }

  @ApiOperation({ summary: 'Trigger an UnauthorizedException' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized error triggered.' })
  getUnauthorized() {
    throw new UnauthorizedException('Authentication required');
  }

  @ApiOperation({ summary: 'Trigger a ForbiddenException' })
  @ApiForbiddenResponse({ description: 'Forbidden error triggered.' })
  getForbidden() {
    throw new ForbiddenException('Access denied');
  }

  @ApiOperation({ summary: 'Trigger a NotFoundException' })
  @ApiNotFoundResponse({ description: 'Not found error triggered.' })
  getNotFound() {
    throw new NotFoundException('Resource not found');
  }

  @ApiOperation({ summary: 'Trigger a validation error via Post body' })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @ApiOkResponse({ description: 'Validation passed.' })
  @Post('validation-error')
  @UsePipes(new ValidationPipe())
  postValidationError(@Body() body: CreateVerificationDto) {
    return {
      message: 'This endpoint is for testing validation errors',
      data: body,
    };
  }

  @ApiOperation({ summary: 'Simulate a Prisma database error' })
  @ApiInternalServerErrorResponse({ description: 'Database error simulated.' })
  @Get('prisma-error-simulation')
  getPrismaErrorSimulation() {
    // Simulate a Prisma error
    const prismaError = new Error('Database error');
    Object.assign(prismaError, {
      code: 'P2002',
      clientVersion: '5.0.0',
      meta: {
        target: ['email'],
      },
    });
    throw prismaError;
  }
}

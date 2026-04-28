import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Version,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { SessionService } from './session.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { SubmitStepDto } from './dto/submit-step.dto';
import {
  SessionResponseDto,
  SubmissionResponseDto,
} from './dto/session-response.dto';

@ApiTags('sessions')
@Controller('sessions')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post()
  @Version('1')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new session',
    description:
      'Create a new verification session with optional multi-step flow definition',
  })
  @ApiResponse({
    status: 201,
    description: 'Session created successfully',
    type: SessionResponseDto,
  })
  async createSession(
    @Body() createSessionDto: CreateSessionDto,
  ): Promise<SessionResponseDto> {
    return this.sessionService.createSession(createSessionDto);
  }

  @Get(':id')
  @Version('1')
  @ApiOperation({
    summary: 'Get session by ID',
    description: 'Retrieve session details including steps and current status',
  })
  @ApiParam({
    name: 'id',
    description: 'Session ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Session retrieved successfully',
    type: SessionResponseDto,
  })
  async getSession(@Param('id') id: string): Promise<SessionResponseDto> {
    return this.sessionService.getSession(id);
  }

  @Post(':sessionId/steps/:stepId/submit')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit data to a session step',
    description:
      'Submit data to a specific step with idempotent handling using submission key',
  })
  @ApiParam({
    name: 'sessionId',
    description: 'Session ID',
  })
  @ApiParam({
    name: 'stepId',
    description: 'Step ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Step submission processed successfully',
    type: SubmissionResponseDto,
  })
  async submitToStep(
    @Param('sessionId') sessionId: string,
    @Param('stepId') stepId: string,
    @Body() submitStepDto: SubmitStepDto,
  ): Promise<SubmissionResponseDto> {
    return this.sessionService.submitToStep(sessionId, stepId, submitStepDto);
  }

  @Post(':id/resume')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resume a session',
    description: 'Resume an expired or paused session',
  })
  @ApiParam({
    name: 'id',
    description: 'Session ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Session resumed successfully',
    type: SessionResponseDto,
  })
  async resumeSession(@Param('id') id: string): Promise<SessionResponseDto> {
    return this.sessionService.resumeSession(id);
  }

  @Get()
  @Version('1')
  @ApiOperation({
    summary: 'Get sessions by context',
    description: 'Retrieve sessions filtered by context ID',
  })
  @ApiQuery({
    name: 'contextId',
    description: 'Context ID to filter sessions',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Sessions retrieved successfully',
    type: [SessionResponseDto],
  })
  async getSessions(
    @Query('contextId') contextId?: string,
  ): Promise<SessionResponseDto[]> {
    if (contextId) {
      return this.sessionService.getSessionsByContext(contextId);
    }

    // For now, return empty array if no contextId provided
    // In a real implementation, you might want to add pagination and other filters
    return [];
  }
}

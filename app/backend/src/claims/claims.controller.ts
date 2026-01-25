import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ClaimsService } from './claims.service';
import { CreateClaimDto } from './dto/create-claim.dto';

@ApiTags('claims')
@Controller('claims')
export class ClaimsController {
  constructor(private readonly claimsService: ClaimsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new claim' })
  @ApiResponse({ status: 201, description: 'Claim created successfully' })
  create(@Body() createClaimDto: CreateClaimDto) {
    return this.claimsService.create(createClaimDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all claims' })
  @ApiResponse({ status: 200, description: 'List of claims' })
  findAll() {
    return this.claimsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a claim by ID' })
  @ApiResponse({ status: 200, description: 'Claim details' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  findOne(@Param('id') id: string) {
    return this.claimsService.findOne(id);
  }

  @Post(':id/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify a claim (requested -> verified)' })
  @ApiResponse({ status: 200, description: 'Claim verified' })
  @ApiResponse({ status: 400, description: 'Invalid transition' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  verify(@Param('id') id: string) {
    return this.claimsService.verify(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve a claim (verified -> approved)' })
  @ApiResponse({ status: 200, description: 'Claim approved' })
  @ApiResponse({ status: 400, description: 'Invalid transition' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  approve(@Param('id') id: string) {
    return this.claimsService.approve(id);
  }

  @Post(':id/disburse')
  @HttpCode(200)
  @ApiOperation({ summary: 'Disburse a claim (approved -> disbursed)' })
  @ApiResponse({ status: 200, description: 'Claim disbursed' })
  @ApiResponse({ status: 400, description: 'Invalid transition' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  disburse(@Param('id') id: string) {
    return this.claimsService.disburse(id);
  }

  @Patch(':id/archive')
  @HttpCode(200)
  @ApiOperation({ summary: 'Archive a claim (disbursed -> archived)' })
  @ApiResponse({ status: 200, description: 'Claim archived' })
  @ApiResponse({ status: 400, description: 'Invalid transition' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  archive(@Param('id') id: string) {
    return this.claimsService.archive(id);
  }
}

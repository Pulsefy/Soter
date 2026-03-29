import { Controller, Get, Post, Body, Param, Patch } from '@nestjs/common';
import {
  ApiTags,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ClaimsService } from './claims.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import { Roles } from 'src/auth/roles.decorator';
import { AppRole } from 'src/auth/app-role.enum';

@ApiTags('Onchain Proxy')
@ApiBearerAuth('JWT-auth')
@Controller('claims')
export class ClaimsController {
  constructor(private readonly claimsService: ClaimsService) {}

  @Post()
  @ApiCreatedResponse({
    description: 'Claim created successfully.',
    type: CreateClaimDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid input parameters.',
  })
  @ApiNotFoundResponse({
    description: 'The specified campaign was not found.',
  })
  create(@Body() createClaimDto: CreateClaimDto) {
    return this.claimsService.create(createClaimDto);
  }

  @Get()
  @ApiOkResponse({
    description: 'List of all claims retrieved successfully.',
  })
  findAll() {
    return this.claimsService.findAll();
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Claim details retrieved successfully.',
  })
  @ApiNotFoundResponse({
    description: 'The specified claim was not found.',
  })
  findOne(@Param('id') id: string) {
    return this.claimsService.findOne(id);
  }

  @Post(':id/verify')
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOkResponse({
    description: 'Claim status transitioned to verified successfully.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid status transition.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - insufficient permissions.',
  })
  @ApiNotFoundResponse({
    description: 'The specified claim was not found.',
  })
  verify(@Param('id') id: string) {
    return this.claimsService.verify(id);
  }

  @Post(':id/approve')
  @Roles(AppRole.admin)
  @ApiOkResponse({
    description: 'Claim approved successfully (verified → approved).',
  })
  @ApiBadRequestResponse({
    description: 'Invalid status transition.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  @ApiNotFoundResponse({
    description: 'The specified claim was not found.',
  })
  approve(@Param('id') id: string) {
    return this.claimsService.approve(id);
  }

  @Post(':id/disburse')
  @Roles(AppRole.admin)
  @ApiOkResponse({
    description: 'On-chain disbursement initiated or completed successfully.',
    content: {
      'application/json': {
        examples: {
          success: {
            summary: 'Successful on-chain disbursement',
            value: {
              id: 'claim_123',
              status: 'disbursed',
              transactionHash: '0x123...abc',
              amount: '100.50',
            },
          },
          pending: {
            summary: 'Disbursement pending on-chain',
            value: {
              id: 'claim_123',
              status: 'disbursing',
              message: 'Check back for final transaction hash.',
            },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid status transition or account state.',
  })
  @ApiForbiddenResponse({
    description: 'Access denied - admin role required.',
  })
  @ApiNotFoundResponse({
    description: 'The specified claim was not found.',
  })
  disburse(@Param('id') id: string) {
    return this.claimsService.disburse(id);
  }

  @Patch(':id/archive')
  @ApiOkResponse({
    description: 'Claim archived successfully.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid status transition.',
  })
  @ApiNotFoundResponse({
    description: 'The specified claim was not found.',
  })
  archive(@Param('id') id: string) {
    return this.claimsService.archive(id);
  }
}

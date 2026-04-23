import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Request,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ClaimsService } from './claims.service';
import { CreateClaimDto } from './dto/create-claim.dto';
import {
  ClaimReceiptDto,
  ClaimShareResponseDto,
  SendReceiptShareDto,
} from './dto/claim-receipt.dto';
import { Roles } from 'src/auth/roles.decorator';
import { AppRole } from 'src/auth/app-role.enum';
import { InternalNotesService } from 'src/common/services/internal-notes.service';
import { CreateInternalNoteDto } from 'src/common/dto/create-internal-note.dto';
import { InternalNoteResponseDto } from 'src/common/dto/internal-note-response.dto';
import { CsvUtil } from '../common/utils/csv.util';
import { ExportFiltersDto } from '../common/dto/export-filters.dto';
import { Response } from 'express';
import { Res, Query } from '@nestjs/common';

@ApiTags('Onchain Proxy')
@ApiBearerAuth('JWT-auth')
@Controller('claims')
export class ClaimsController {
  constructor(
    private readonly claimsService: ClaimsService,
    private readonly internalNotesService: InternalNotesService,
  ) {}

  @Get('export')
  @Roles(AppRole.admin, AppRole.operator)
  @ApiOperation({ summary: 'Export claims to CSV' })
  @ApiOkResponse({ description: 'CSV file containing claim data.' })
  async export(
    @Query() filters: ExportFiltersDto,
    @Request() req: ExpressRequest,
    @Res() res: Response,
  ) {
    const ngoId = req.user?.role === AppRole.ngo ? req.user.ngoId : filters.ngoId;
    const data = await this.claimsService.exportToCsv({ ...filters, ngoId });
    const csv = CsvUtil.generateCsv(data);

    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="claims-export-${Date.now()}.csv"`,
    });

    return res.send(csv);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a claim',
    description: 'Initializes a new claim for a specific campaign.',
  })
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
  @ApiOperation({
    summary: 'List all claims',
    description: 'Retrieves a list of all claims across all campaigns.',
  })
  @ApiOkResponse({
    description: 'List of all claims retrieved successfully.',
  })
  findAll() {
    return this.claimsService.findAll();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get claim details',
    description:
      'Retrieves the current details and status of a specific claim.',
  })
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
  @ApiOperation({
    summary: 'Verify a claim',
    description: 'Marks a claim as verified. Requires operator or admin role.',
  })
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
  @ApiOperation({
    summary: 'Approve a claim',
    description: 'Approves a verified claim. Requires admin role.',
  })
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
  @ApiOperation({
    summary: 'Disburse funds for a claim',
    description:
      'Initiates on-chain disbursement for an approved claim. Requires admin role.',
  })
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
  @ApiOperation({
    summary: 'Archive a claim',
    description: 'Soft-archives a claim, hiding it from general listings.',
  })
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

  @Get(':id/receipt')
  @ApiOperation({
    summary: 'Get claim receipt',
    description: 'Generates a shareable receipt for the specified claim.',
  })
  @ApiOkResponse({
    description: 'Claim receipt generated successfully.',
    type: ClaimReceiptDto,
  })
  @ApiNotFoundResponse({
    description: 'The specified claim was not found.',
  })
  getReceipt(@Param('id') id: string): Promise<ClaimReceiptDto> {
    return this.claimsService.getReceipt(id);
  }

  @Post(':id/receipt/share')
  @ApiOperation({
    summary: 'Share claim receipt',
    description:
      'Generates and optionally sends the claim receipt via email or SMS.',
  })
  @ApiOkResponse({
    description: 'Receipt generated and sharing initiated successfully.',
    type: ClaimShareResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid share parameters.',
  })
  @ApiNotFoundResponse({
    description: 'The specified claim was not found.',
  })
  shareReceipt(
    @Param('id') id: string,
    @Body() shareDto: SendReceiptShareDto,
  ): Promise<ClaimShareResponseDto> {
    return this.claimsService.shareReceipt(id, shareDto);
  }

  @Post(':id/notes')
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({
    summary: 'Add an internal note to a claim',
    description: 'Adds a secure internal note for staff review only.',
  })
  @ApiCreatedResponse({
    description: 'Internal note added successfully.',
    type: InternalNoteResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Access denied - staff role required.',
  })
  addNote(
    @Param('id') id: string,
    @Body() dto: CreateInternalNoteDto,
    @Request() req: ExpressRequest,
  ) {
    const authorId = req.user?.apiKeyId || req.user?.authType || 'system';
    return this.internalNotesService.createNote('claim', id, authorId, dto);
  }

  @Get(':id/notes')
  @Roles(AppRole.operator, AppRole.admin)
  @ApiOperation({
    summary: 'List internal notes for a claim',
    description: 'Retrieves all internal notes for a specific claim.',
  })
  @ApiOkResponse({
    description: 'Internal notes retrieved successfully.',
    type: [InternalNoteResponseDto],
  })
  @ApiForbiddenResponse({
    description: 'Access denied - staff role required.',
  })
  getNotes(@Param('id') id: string) {
    return this.internalNotesService.findNotesByEntity('claim', id);
  }
}

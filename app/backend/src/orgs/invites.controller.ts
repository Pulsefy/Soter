import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { InvitesService } from './invites.service';
import { AppRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@Controller()
@UseGuards(ApiKeyGuard, RolesGuard)
export class InvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  @Post('orgs/:id/invites')
  @Roles(AppRole.admin)
  async createInvite(
    @Param('id') orgId: string,
    @Body() body: { email: string; role: AppRole },
    @Request() req: any,
  ) {
    return this.invitesService.createInvite({
      orgId,
      email: body.email,
      role: body.role,
      createdBy: req.user.id || req.user.apiKeyId || 'system',
    });
  }

  @Post('invites/:id/accept')
  async acceptInvite(
    @Param('id') inviteId: string,
    @Body('email') email: string,
    @Request() req: any,
  ) {
    const userEmail = req.user?.email || email;
    return this.invitesService.acceptInvite(inviteId, userEmail);
  }

  @Delete('invites/:id')
  @Roles(AppRole.admin)
  async revokeInvite(@Param('id') inviteId: string, @Request() req: any) {
    return this.invitesService.revokeInvite(
      inviteId,
      req.user.id || req.user.apiKeyId || 'system',
    );
  }

  @Get('orgs/:id/invites')
  @Roles(AppRole.admin, AppRole.ngo)
  async listInvites(@Param('id') orgId: string) {
    return this.invitesService.listInvites(orgId);
  }
}

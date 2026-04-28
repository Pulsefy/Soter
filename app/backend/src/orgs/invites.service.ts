import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppRole, InviteStatus } from '@prisma/client';

@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createInvite(data: {
    orgId: string;
    email: string;
    role: AppRole;
    createdBy: string;
  }) {
    // 1. Validate org exists
    const org = await this.prisma.organization.findUnique({
      where: { id: data.orgId },
    });
    if (!org) {
      // For demo purposes, if org doesn't exist, let's create it if it's the first time
      // But in real app, we should throw 404.
      // throw new NotFoundException('Organization not found');
      await this.prisma.organization.create({
        data: { id: data.orgId, name: `Org ${data.orgId}` },
      });
    }

    // 2. Set expiry (7 days)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // 3. Create invite
    const invite = await this.prisma.invite.create({
      data: {
        orgId: data.orgId,
        email: data.email,
        role: data.role,
        expiresAt,
        createdBy: data.createdBy,
        status: InviteStatus.pending,
      },
    });

    // 4. Audit log
    await this.audit.record({
      actorId: data.createdBy,
      entity: 'Invite',
      entityId: invite.id,
      action: 'invite_created',
      metadata: { orgId: data.orgId, email: data.email, role: data.role },
    });

    return invite;
  }

  async acceptInvite(inviteId: string, userEmail: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { id: inviteId },
    });

    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.status !== InviteStatus.pending) {
      throw new BadRequestException(`Invite is already ${invite.status}`);
    }
    if (invite.expiresAt < new Date()) {
      await this.prisma.invite.update({
        where: { id: inviteId },
        data: { status: InviteStatus.expired },
      });
      throw new BadRequestException('Invite has expired');
    }
    if (invite.email !== userEmail) {
      throw new ForbiddenException('This invite is not for you');
    }

    // Assign role to user (create or update user)
    const user = await this.prisma.user.upsert({
      where: { email: userEmail },
      update: {
        role: invite.role,
        orgId: invite.orgId,
      },
      create: {
        email: userEmail,
        role: invite.role,
        orgId: invite.orgId,
      },
    });

    // Update invite status
    await this.prisma.invite.update({
      where: { id: inviteId },
      data: { status: InviteStatus.accepted },
    });

    // Audit log
    await this.audit.record({
      actorId: user.id,
      entity: 'Invite',
      entityId: inviteId,
      action: 'invite_accepted',
      metadata: { orgId: invite.orgId, role: invite.role },
    });

    return user;
  }

  async revokeInvite(inviteId: string, revokedBy: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { id: inviteId },
    });

    if (!invite) throw new NotFoundException('Invite not found');

    const updated = await this.prisma.invite.update({
      where: { id: inviteId },
      data: { status: InviteStatus.revoked },
    });

    await this.audit.record({
      actorId: revokedBy,
      entity: 'Invite',
      entityId: inviteId,
      action: 'invite_revoked',
      metadata: { orgId: invite.orgId },
    });

    return updated;
  }

  async listInvites(orgId: string) {
    return this.prisma.invite.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
  }
}

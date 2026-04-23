import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { CreateInternalNoteDto } from '../dto/create-internal-note.dto';
import { InternalNoteResponseDto } from '../dto/internal-note-response.dto';

@Injectable()
export class InternalNotesService {
  private readonly logger = new Logger(InternalNotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async createNote(
    entityType: string,
    entityId: string,
    authorId: string,
    dto: CreateInternalNoteDto,
  ): Promise<InternalNoteResponseDto> {
    this.logger.log(`Creating internal note for ${entityType} ${entityId} by ${authorId}`);

    const note = await this.prisma.internalNote.create({
      data: {
        entityType,
        entityId,
        authorId,
        content: dto.content,
        category: dto.category,
      },
    });

    await this.auditService.record({
      actorId: authorId,
      entity: `internal_note_${entityType}`,
      entityId: entityId,
      action: 'create_note',
      metadata: {
        noteId: note.id,
        category: dto.category,
      },
    });

    return note;
  }

  async findNotesByEntity(
    entityType: string,
    entityId: string,
  ): Promise<InternalNoteResponseDto[]> {
    return this.prisma.internalNote.findMany({
      where: {
        entityType,
        entityId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}

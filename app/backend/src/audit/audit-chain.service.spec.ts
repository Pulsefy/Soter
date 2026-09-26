import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from './metrics.service';
import { AuditChainService } from './audit-chain.service';
import {
  GENESIS_PREV_HASH,
  computeEntryHash,
  canonicalMetadata,
  jsonDeepEqual,
} from './audit-chain.util';

/**
 * Deterministic stand-in for the cuid generator so recorded hashes can be
 * recomputed in tests: the "sequence" of generated ids is hex-encoded.
 */
let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `cjld2cjuz0000${idCounter.toString(16).padStart(8, '0')}`;
}

/**
 * In-memory AuditLog table emulating the constraints the chain relies on:
 * unique `sequence`, and a `deletedAt` stamp used by retention anonymization.
 */
interface Row {
  id: string;
  actorId: string;
  entity: string;
  entityId: string;
  action: string;
  timestamp: Date;
  metadata: Record<string, unknown> | null;
  deletedAt: Date | null;
  sequence: bigint | null;
  prevHash: string | null;
  entryHash: string | null;
  metadataCanonical: string | null;
}

function makeRow(
  partial: Partial<Row> &
    Pick<Row, 'actorId' | 'entity' | 'entityId' | 'action'>,
): Row {
  return {
    id: partial.id ?? nextId(),
    timestamp: partial.timestamp ?? new Date('2026-09-24T00:00:00.000Z'),
    metadata: partial.metadata ?? {},
    deletedAt: partial.deletedAt ?? null,
    sequence: partial.sequence ?? null,
    prevHash: partial.prevHash ?? null,
    entryHash: partial.entryHash ?? null,
    metadataCanonical: partial.metadataCanonical ?? null,
    actorId: partial.actorId,
    entity: partial.entity,
    entityId: partial.entityId,
    action: partial.action,
  };
}

describe('AuditChainService', () => {
  let service: AuditChainService;
  let rows: Row[];

  /** Hash a row exactly the way the service does at write time. */
  function hashOf(row: Row, sequence: bigint, prevHash: string | null) {
    return computeEntryHash({
      id: row.id,
      sequence,
      prevHash,
      actorId: row.actorId,
      entity: row.entity,
      entityId: row.entityId,
      action: row.action,
      timestamp: row.timestamp,
      metadataCanonical: row.metadataCanonical ?? '',
    });
  }

  const mockPrisma = {
    auditLog: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn(mockPrisma),
    ),
  };

  /**
   * Production appends are serialized by `pg_advisory_xact_lock` inside the
   * append transaction. Emulate that here by running each interactive
   * transaction to completion before the next one starts; without this, the
   * mock's microtask interleaving would let concurrent appends observe the
   * same chain head — a state the real lock makes impossible.
   */
  let txQueue: Promise<unknown> = Promise.resolve();

  const mockMetricsService = {
    dbQueryDuration: {
      startTimer: jest.fn(() => jest.fn()),
    },
    dbErrorsTotal: {
      inc: jest.fn(),
    },
  };

  beforeEach(async () => {
    rows = [];
    idCounter = 0;
    txQueue = Promise.resolve();

    jest.clearAllMocks();

    mockPrisma.$transaction.mockImplementation(
      (fn: (tx: unknown) => Promise<unknown>) => {
        const run = txQueue.then(() => fn(mockPrisma));
        txQueue = run.catch(() => undefined);
        return run;
      },
    );

    // ---- in-memory auditLog emulation -------------------------------
    // create: assign id/timestamp; caller persists hash fields after.
    mockPrisma.auditLog.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => {
        const row = makeRow({
          id: nextId(),
          actorId: data.actorId as string,
          entity: data.entity as string,
          entityId: data.entityId as string,
          action: data.action as string,
          metadata: (data.metadata as Record<string, unknown>) ?? null,
          sequence: (data.sequence as bigint) ?? null,
          prevHash: (data.prevHash as string) ?? null,
          metadataCanonical: (data.metadataCanonical as string) ?? null,
        });
        rows.push(row);
        return Promise.resolve({ ...row });
      },
    );

    mockPrisma.auditLog.update.mockImplementation(
      ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = rows.find(r => r.id === where.id);
        if (!row) return Promise.reject(new Error('not found'));
        Object.assign(row, data);
        return Promise.resolve({ ...row });
      },
    );

    // findFirst: chain head lookup (orderBy sequence desc).
    mockPrisma.auditLog.findFirst.mockImplementation(
      ({ orderBy }: { orderBy?: { sequence: string } }) => {
        if (orderBy?.sequence === 'desc') {
          const sealed = rows
            .filter(r => r.entryHash !== null && r.sequence !== null)
            .sort((a, b) =>
              (b.sequence as bigint) < (a.sequence as bigint) ? -1 : 1,
            );
          const head = sealed[0];
          return Promise.resolve(
            head
              ? { ...head, sequence: head.sequence, entryHash: head.entryHash }
              : null,
          );
        }
        return Promise.resolve(null);
      },
    );

    // findMany: paged walk in sequence order, or legacy batch fetch.
    mockPrisma.auditLog.findMany.mockImplementation(
      (args: {
        where?: { entryHash?: { not: null } | null };
        orderBy?: object | object[];
        cursor?: { sequence: bigint };
        skip?: number;
        take?: number;
      }) => {
        const take = args.take ?? 1000;
        const wantSealed =
          args.where?.entryHash !== null &&
          typeof args.where?.entryHash === 'object' &&
          'not' in args.where.entryHash;
        let pool = rows.filter(r =>
          wantSealed ? r.entryHash !== null : r.entryHash === null,
        );

        pool = pool.sort((a, b) => {
          const sa = a.sequence ?? 0n;
          const sb = b.sequence ?? 0n;
          if (sa !== sb) return sa < sb ? -1 : 1;
          return a.timestamp < b.timestamp ? -1 : 1;
        });

        if (args.cursor?.sequence) {
          const idx = pool.findIndex(r => r.sequence === args.cursor!.sequence);
          if (idx >= 0) pool = pool.slice(idx + (args.skip ? 1 : 0));
        }
        return Promise.resolve(pool.slice(0, take).map(r => ({ ...r })));
      },
    );

    mockPrisma.auditLog.count.mockImplementation(
      ({ where }: { where?: { entryHash?: { not: null } | null } }) => {
        if (where?.entryHash === null) {
          return Promise.resolve(rows.filter(r => r.entryHash === null).length);
        }
        if (where?.entryHash && typeof where.entryHash === 'object') {
          return Promise.resolve(rows.filter(r => r.entryHash !== null).length);
        }
        return Promise.resolve(rows.length);
      },
    );

    mockPrisma.$queryRaw.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditChainService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MetricsService, useValue: mockMetricsService },
      ],
    }).compile();

    service = module.get<AuditChainService>(AuditChainService);
  });

  describe('appendToChain', () => {
    it('creates the first entry linked to genesis', async () => {
      const result = await service.appendToChain({
        actorId: 'user-1',
        entity: 'campaign',
        entityId: 'c-1',
        action: 'create',
        metadata: { name: 'test' },
      });

      expect(result.sequence).toBe('1');
      expect(result.prevHash).toBe(GENESIS_PREV_HASH);

      const row = rows[0];
      expect(row.entryHash).toBe(
        computeEntryHash({
          id: row.id,
          sequence: 1n,
          prevHash: GENESIS_PREV_HASH,
          actorId: 'user-1',
          entity: 'campaign',
          entityId: 'c-1',
          action: 'create',
          timestamp: row.timestamp,
          metadataCanonical: canonicalMetadata({ name: 'test' }),
        }),
      );
    });

    it('links each subsequent entry to the previous hash', async () => {
      const first = await service.appendToChain({
        actorId: 'user-1',
        entity: 'campaign',
        entityId: 'c-1',
        action: 'create',
      });
      const second = await service.appendToChain({
        actorId: 'user-2',
        entity: 'claim',
        entityId: 'cl-1',
        action: 'approve',
        metadata: { amount: 5 },
      });

      expect(second.sequence).toBe('2');
      expect(second.prevHash).toBe(first.entryHash);
      expect(second.entryHash).not.toBe(first.entryHash);
    });

    it('assigns strictly increasing sequences under concurrency', async () => {
      // The advisory lock serializes appends in production; the mock runs
      // them sequentially, which the unique `sequence` contract depends on.
      await Promise.all([
        service.appendToChain({
          actorId: 'a',
          entity: 'e',
          entityId: '1',
          action: 'x',
        }),
        service.appendToChain({
          actorId: 'b',
          entity: 'e',
          entityId: '2',
          action: 'y',
        }),
        service.appendToChain({
          actorId: 'c',
          entity: 'e',
          entityId: '3',
          action: 'z',
        }),
      ]);

      const sequences = rows
        .map(r => r.sequence as bigint)
        .sort((a, b) => (a < b ? -1 : 1));
      expect(sequences).toEqual([1n, 2n, 3n]);
    });

    it('records canonical metadata alongside the entry', async () => {
      await service.appendToChain({
        actorId: 'user-1',
        entity: 'campaign',
        entityId: 'c-1',
        action: 'create',
        metadata: { b: 2, a: { d: 4, c: 3 } },
      });

      const row = rows[0];
      // Keys sorted recursively, pretty-printed.
      expect(row.metadataCanonical).toBe(
        JSON.stringify({ a: { c: 3, d: 4 }, b: 2 }, null, 2),
      );
    });
  });

  describe('verifyChain', () => {
    async function seedChain(length: number) {
      for (let i = 0; i < length; i++) {
        await service.appendToChain({
          actorId: `user-${i}`,
          entity: 'campaign',
          entityId: `c-${i}`,
          action: 'update',
          metadata: { i },
        });
      }
    }

    it('reports a valid chain with no issues', async () => {
      await seedChain(5);
      const result = await service.verifyChain();

      expect(result.valid).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.sealedCount).toBe(5);
      expect(result.legacyCount).toBe(0);
      expect(result.backfillPending).toBe(false);
      expect(result.headSequence).toBe('5');
      expect(result.headHash).toBe(rows[4].entryHash);
    });

    it('reports an empty chain as valid', async () => {
      const result = await service.verifyChain();
      expect(result).toEqual({
        valid: true,
        backfillPending: false,
        sealedCount: 0,
        legacyCount: 0,
        skippedAnonymized: 0,
        issues: [],
        headSequence: null,
        headHash: null,
      });
    });

    it('detects mutation of a stored entry', async () => {
      await seedChain(4);
      // Deliberate tampering: rewrite an action without recomputing hashes.
      rows[2].action = 'forged-action';

      const result = await service.verifyChain();
      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].id).toBe(rows[2].id);
      expect(result.issues[0].reason).toContain('invalid entryHash');
    });

    it('detects metadata mutation of a stored entry', async () => {
      await seedChain(3);
      rows[1].metadata = { forged: true };
      rows[1].metadataCanonical = canonicalMetadata({ forged: true });

      const result = await service.verifyChain();
      expect(result.valid).toBe(false);
      expect(result.issues[0].reason).toContain('invalid entryHash');
    });

    it('detects when the visible metadata diverges from the canonical form', async () => {
      await seedChain(3);
      // Hash still matches the canonical string, but the visible JSON column
      // was rewritten (e.g. by a raw UPDATE that skipped the canonical field).
      rows[1].metadata = { forged: true };

      const result = await service.verifyChain();
      expect(result.valid).toBe(false);
      expect(result.issues[0].reason).toContain('metadata does not match');
    });

    it('detects deletion of a middle entry (broken link)', async () => {
      await seedChain(5);
      // Remove one entry from the middle of the chain entirely.
      const removed = rows.splice(2, 1)[0];
      void removed;

      const result = await service.verifyChain();
      expect(result.valid).toBe(false);
      // The entry after the removal reports the broken link.
      expect(result.issues.some(i => i.reason.startsWith('broken link'))).toBe(
        true,
      );
    });

    it('detects deletion of the chain head when an anchored head hash is supplied', async () => {
      await seedChain(4);
      const anchoredHead = rows[3].entryHash as string;

      // An attacker deletes the newest entry and keeps the rest.
      rows.splice(3, 1);

      // The surviving chain is internally consistent, so the walk alone
      // cannot see the loss; anchoring the previously published head hash
      // makes truncation detectable.
      const unanchored = await service.verifyChain();
      expect(unanchored.valid).toBe(true);
      expect(unanchored.headSequence).toBe('3');

      const anchored = await service.verifyChain({
        expectedHeadHash: anchoredHead,
      });
      expect(anchored.valid).toBe(false);
      expect(anchored.issues[0].reason).toContain('chain head mismatch');
    });

    it('detects insertion of a forged entry via broken link', async () => {
      await seedChain(4);
      // Attacker inserts a fake entry that is internally self-consistent
      // (its stored hash matches its content) but links to a predecessor
      // hash that no legitimate entry produced.
      const forged = makeRow({
        actorId: 'attacker',
        entity: 'campaign',
        entityId: 'c-fake',
        action: 'forge',
        sequence: 5n,
        prevHash: 'f'.repeat(64),
        metadataCanonical: '{}',
      });
      forged.entryHash = computeEntryHash({
        id: forged.id,
        sequence: 5n,
        prevHash: 'f'.repeat(64),
        actorId: 'attacker',
        entity: 'campaign',
        entityId: 'c-fake',
        action: 'forge',
        timestamp: forged.timestamp,
        metadataCanonical: '{}',
      });
      rows.push(forged);

      const result = await service.verifyChain();
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.reason.startsWith('broken link'))).toBe(
        true,
      );
    });

    it('reports multiple damaged regions', async () => {
      await seedChain(5);
      rows[0].actorId = 'someone-else';
      rows[3].entityId = 'rewritten';

      const result = await service.verifyChain();
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(2);
    });

    it('skips content checks for anonymized (soft-deleted) entries but keeps linking', async () => {
      await seedChain(3);
      // Retention policy anonymization rewrites content and stamps deletedAt.
      rows[1].actorId = '[REDACTED]';
      rows[1].entityId = '[REDACTED]';
      rows[1].metadata = {};
      rows[1].metadataCanonical = '{}';
      rows[1].deletedAt = new Date('2026-09-24T02:00:00.000Z');

      const result = await service.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.skippedAnonymized).toBe(1);
      expect(result.issues).toEqual([]);
    });

    it('reports legacy rows as backfillPending', async () => {
      rows.push(
        makeRow({
          actorId: 'old-user',
          entity: 'campaign',
          entityId: 'c-old',
          action: 'create',
        }),
      );

      const result = await service.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.backfillPending).toBe(true);
      expect(result.legacyCount).toBe(1);
      expect(result.sealedCount).toBe(0);
    });
  });

  describe('backfillChain', () => {
    it('seals legacy rows onto an empty chain', async () => {
      rows.push(
        makeRow({
          actorId: 'old-user',
          entity: 'campaign',
          entityId: 'c-old',
          action: 'create',
          metadata: { legacy: true },
        }),
      );

      const result = await service.backfillChain();
      expect(result.sealed).toBe(1);
      expect(result.remaining).toBe(0);
      expect(result.headSequence).toBe('1');

      const sealed = rows[0];
      expect(sealed.prevHash).toBe(GENESIS_PREV_HASH);
      expect(sealed.entryHash).toBe(hashOf(sealed, 1n, GENESIS_PREV_HASH));
    });

    it('appends legacy rows after the existing chain head', async () => {
      await service.appendToChain({
        actorId: 'user-1',
        entity: 'campaign',
        entityId: 'c-1',
        action: 'create',
      });
      rows.push(
        makeRow({
          actorId: 'old-user',
          entity: 'campaign',
          entityId: 'c-old',
          action: 'create',
        }),
      );

      const headBefore = rows[0].entryHash as string;
      const result = await service.backfillChain();

      expect(result.sealed).toBe(1);
      expect(rows[1].sequence).toBe(2n);
      expect(rows[1].prevHash).toBe(headBefore);
      expect(rows[1].entryHash).toBe(hashOf(rows[1], 2n, headBefore));
    });

    it('produces a verifiable chain after sealing', async () => {
      rows.push(
        makeRow({ actorId: 'a', entity: 'e', entityId: '1', action: 'x' }),
        makeRow({ actorId: 'b', entity: 'e', entityId: '2', action: 'y' }),
      );
      await service.backfillChain();
      await service.appendToChain({
        actorId: 'new',
        entity: 'e',
        entityId: '3',
        action: 'z',
      });

      const result = await service.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.sealedCount).toBe(3);
      expect(result.backfillPending).toBe(false);
    });

    it('is idempotent when nothing remains to seal', async () => {
      await service.appendToChain({
        actorId: 'user-1',
        entity: 'campaign',
        entityId: 'c-1',
        action: 'create',
      });

      const result = await service.backfillChain();
      expect(result.sealed).toBe(0);
      expect(result.remaining).toBe(0);
      expect(result.headSequence).toBe('1');
    });
  });

  describe('chain util invariants', () => {
    it('genesis prev hash is 64 zeros', () => {
      expect(GENESIS_PREV_HASH).toMatch(/^[0]{64}$/);
    });

    it('canonical metadata is key-order independent', () => {
      expect(canonicalMetadata({ a: 1, b: { y: 2, x: 3 } })).toBe(
        canonicalMetadata({ b: { x: 3, y: 2 }, a: 1 }),
      );
    });

    it('jsonDeepEqual ignores object key order', () => {
      expect(
        jsonDeepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }),
      ).toBe(true);
      expect(jsonDeepEqual({ a: 1 }, { a: 2 })).toBe(false);
      expect(jsonDeepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
      expect(jsonDeepEqual([1, 2], [2, 1])).toBe(false);
    });

    it('entry hash changes when any covered field changes', () => {
      const base = {
        id: 'id-1',
        sequence: 1n,
        prevHash: GENESIS_PREV_HASH,
        actorId: 'a',
        entity: 'e',
        entityId: '1',
        action: 'x',
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
        metadataCanonical: '{}',
      };
      const baseHash = computeEntryHash(base);

      expect(computeEntryHash({ ...base })).toBe(baseHash);
      expect(computeEntryHash({ ...base, id: 'id-2' })).not.toBe(baseHash);
      expect(computeEntryHash({ ...base, sequence: 2n })).not.toBe(baseHash);
      expect(computeEntryHash({ ...base, actorId: 'b' })).not.toBe(baseHash);
      expect(computeEntryHash({ ...base, action: 'y' })).not.toBe(baseHash);
      expect(
        computeEntryHash({
          ...base,
          timestamp: new Date('2026-01-02T00:00:00.000Z'),
        }),
      ).not.toBe(baseHash);
      expect(
        computeEntryHash({ ...base, metadataCanonical: '{"z":1}' }),
      ).not.toBe(baseHash);
      expect(computeEntryHash({ ...base, prevHash: 'a'.repeat(64) })).not.toBe(
        baseHash,
      );
    });
  });
});

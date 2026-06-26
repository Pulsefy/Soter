import { Injectable, Logger } from '@nestjs/common';
import { scValToNative } from '@stellar/stellar-sdk';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Subset of the raw Soroban RPC event response used by the mapper.
 * topic and value are typed as any[] / any because the actual xdr.ScVal types
 * are opaque at this boundary; scValToNative handles decoding.
 */
export interface RawSorobanEvent {
  id: string;
  type: string;
  ledger: number;
  txHash: string;
  contractId: string;
  topic: any[];
  value: any;
}

/**
 * Mapped payload ready for persistence into the OnChainEvent table.
 */
export interface OnChainEventPayload {
  txHash: string;
  ledger: number;
  topic: string;
  contractId: string;
  packageId: string | null;
  claimId: string | null;
  rawPayload: object;
  correlatedAt: Date;
}

/**
 * Topics that carry a package identifier in their additional topic entries or value.
 */
const PACKAGE_TOPICS = new Set(['package_created', 'package_claimed', 'package_disbursed']);

/**
 * Transforms a raw Soroban RPC event into an OnChainEventPayload.
 * DB lookups for packageId / claimId are performed via the injected PrismaService.
 * All exceptions are caught internally — the method never throws.
 */
@Injectable()
export class EventMapper {
  private readonly logger = new Logger(EventMapper.name);

  constructor(private readonly prisma: PrismaService) {}

  async map(event: RawSorobanEvent): Promise<OnChainEventPayload> {
    try {
      return await this.mapInternal(event);
    } catch (err) {
      const id = event?.id ?? 'unknown';
      this.logger.warn(
        `EventMapper: failed to map event id=${id}, returning payload with null FKs. Error: ${String(err)}`,
      );
      return {
        txHash: event?.txHash ?? '',
        ledger: event?.ledger ?? 0,
        topic: 'unknown',
        contractId: event?.contractId ?? '',
        packageId: null,
        claimId: null,
        rawPayload: {},
        correlatedAt: new Date(),
      };
    }
  }

  private async mapInternal(event: RawSorobanEvent): Promise<OnChainEventPayload> {
    // --- Decode topic string from topic[0] ---
    let topic = 'unknown';
    if (Array.isArray(event.topic) && event.topic.length > 0) {
      try {
        topic = String(scValToNative(event.topic[0]));
      } catch {
        // fallback stays "unknown"
      }
    }

    // --- Decode raw payload from event.value ---
    let rawPayload: object = {};
    let decodedValue: any = null;
    try {
      decodedValue = scValToNative(event.value);
      rawPayload = (decodedValue !== null && typeof decodedValue === 'object')
        ? (decodedValue as object)
        : {};
    } catch {
      // rawPayload stays {}
    }

    // --- Extract package_id and claim_id ---
    let packageIdRaw: string | null = null;
    let claimIdRaw: string | null = null;

    // Scan topic[1..n]
    if (Array.isArray(event.topic) && event.topic.length > 1) {
      for (let i = 1; i < event.topic.length; i++) {
        try {
          const decoded = scValToNative(event.topic[i]);
          this.extractIds(decoded, topic, { packageIdRaw, claimIdRaw }, (p, c) => {
            if (p !== null) packageIdRaw = p;
            if (c !== null) claimIdRaw = c;
          });
        } catch {
          // skip malformed topic entries
        }
      }
    }

    // Scan decoded value object
    if (decodedValue !== null && typeof decodedValue === 'object') {
      this.extractIds(decodedValue, topic, { packageIdRaw, claimIdRaw }, (p, c) => {
        if (packageIdRaw === null && p !== null) packageIdRaw = p;
        if (claimIdRaw === null && c !== null) claimIdRaw = c;
      });
    }

    // --- DB lookups ---
    let packageId: string | null = null;
    let claimId: string | null = null;

    if (packageIdRaw !== null) {
      const pkg = await this.prisma.aidPackage.findFirst({
        where: { id: packageIdRaw },
        select: { id: true },
      });
      packageId = pkg?.id ?? null;
    }

    if (claimIdRaw !== null) {
      const claim = await this.prisma.claim.findUnique({
        where: { id: claimIdRaw },
        select: { id: true },
      });
      claimId = claim?.id ?? null;
    }

    return {
      txHash: event.txHash,
      ledger: event.ledger,
      topic,
      contractId: event.contractId,
      packageId,
      claimId,
      rawPayload,
      correlatedAt: new Date(),
    };
  }

  /**
   * Given a decoded ScVal object, scans it for known ID keys and invokes the
   * callback with any found values.
   */
  private extractIds(
    decoded: any,
    topic: string,
    current: { packageIdRaw: string | null; claimIdRaw: string | null },
    update: (packageId: string | null, claimId: string | null) => void,
  ): void {
    if (decoded === null || typeof decoded !== 'object') return;

    let foundPackageId: string | null = null;
    let foundClaimId: string | null = null;

    // Handle Map-like structures (arrays of {key, value} pairs from scValToNative maps)
    if (Array.isArray(decoded)) {
      for (const entry of decoded) {
        if (entry && typeof entry === 'object' && 'key' in entry && 'value' in entry) {
          const key = String(entry.key);
          const val = String(entry.value);
          if (key === 'claim_id') {
            foundClaimId = val;
          } else if (PACKAGE_TOPICS.has(topic) && (key === 'package_id' || key === 'id')) {
            foundPackageId = val;
          }
        }
      }
    } else {
      // Handle plain JS objects (scValToNative may decode maps to plain objects)
      for (const [key, val] of Object.entries(decoded)) {
        if (key === 'claim_id') {
          foundClaimId = String(val);
        } else if (PACKAGE_TOPICS.has(topic) && (key === 'package_id' || key === 'id')) {
          foundPackageId = String(val);
        }
      }
    }

    update(foundPackageId, foundClaimId);
  }
}

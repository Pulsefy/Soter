import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { rpc as SorobanRpc, xdr, scValToNative } from '@stellar/stellar-sdk';
import { MetricsService } from '../observability/metrics/metrics.service';
import { withRetryTimeout } from './utils/retry-with-timeout';

export interface EventCorrelationResult {
  correlated: number;
  skipped: number;
  errors: number;
  details: Array<{
    txHash: string;
    eventIndex: number;
    eventTopic: string;
    claimId?: string;
    packageId?: string;
    success: boolean;
    error?: string;
  }>;
}

export interface CorrelationJobData {
  startLedger?: number;
  endLedger?: number;
  contractId?: string;
  correlationSource: 'scheduled' | 'on_demand' | 'manual';
}

export interface SorobanEvent {
  topic: string;
  payload: unknown;
  txHash: string;
  ledger: number;
  eventIndex: number;
}

interface ExtractedContractEvent {
  topic: xdr.ScVal[];
  value: xdr.ScVal;
  contractId: string;
}

@Injectable()
export class SorobanEventCorrelationService {
  private readonly logger = new Logger(SorobanEventCorrelationService.name);
  private readonly contractId: string;
  private readonly rpcUrl: string;
  private readonly networkPassphrase: string;
  private server: SorobanRpc.Server | null = null;

  // Event topics that we correlate
  private readonly CORRELATED_TOPICS = new Set([
    'package_created',
    'package_claimed',
    'package_disbursed',
    'package_cancelled',
    'package_expired',
    'package_refunded',
    'package_revoked',
    'claim_created',
    'claim_verified',
    'claim_approved',
    'claim_disbursed',
    'claim_cancelled',
    'claim_archived',
    'escrow_initialized',
    'config_updated',
    'admin_updated',
    'tokens_allowed',
    'tokens_removed',
  ]);

  // Mapping from contract event topics to our internal enum
  private readonly TOPIC_MAP: Record<string, string> = {
    package_created: 'package_created',
    package_claimed: 'package_claimed',
    package_disbursed: 'package_disbursed',
    package_cancelled: 'package_cancelled',
    package_expired: 'package_expired',
    package_refunded: 'package_refunded',
    package_revoked: 'package_revoked',
    claim_created: 'claim_created',
    claim_verified: 'claim_verified',
    claim_approved: 'claim_approved',
    claim_disbursed: 'claim_disbursed',
    claim_cancelled: 'claim_cancelled',
    claim_archived: 'claim_archived',
    escrow_initialized: 'escrow_initialized',
    config_updated: 'config_updated',
    admin_updated: 'admin_updated',
    tokens_allowed: 'tokens_allowed',
    tokens_removed: 'tokens_removed',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
  ) {
    this.contractId = this.configService.get<string>(
      'AID_ESCROW_CONTRACT_ID',
      '',
    );
    this.rpcUrl = this.configService.get<string>(
      'STELLAR_RPC_URL',
      'https://soroban-testnet.stellar.org',
    );
    this.networkPassphrase = this.configService.get<string>(
      'STELLAR_NETWORK_PASSPHRASE',
      'Test SDF Network ; September 2015',
    );
  }

  private getServer(): SorobanRpc.Server {
    if (!this.server) {
      this.server = new SorobanRpc.Server(this.rpcUrl, {
        allowHttp: this.rpcUrl.startsWith('http://'),
      });
    }
    return this.server;
  }

  /**
   * Main entry point for event correlation
   * Fetches events from Soroban RPC and correlates them to internal records
   */
  async correlateEvents(
    data: CorrelationJobData,
  ): Promise<EventCorrelationResult> {
    const { startLedger, endLedger, contractId, correlationSource } = data;
    const targetContractId = contractId || this.contractId;

    this.logger.log(`Starting event correlation`, {
      startLedger,
      endLedger,
      contractId: targetContractId,
      correlationSource,
    });

    const startTime = Date.now();

    try {
      // Fetch events from Soroban RPC
      const events = await this.fetchEvents(
        targetContractId,
        startLedger,
        endLedger,
      );

      this.logger.log(`Fetched ${events.length} events from Soroban RPC`);

      // Filter to only correlated topics
      const relevantEvents = events.filter(e =>
        this.CORRELATED_TOPICS.has(e.topic),
      );

      this.logger.log(
        `${relevantEvents.length} events match correlated topics`,
      );

      // Process each event
      const result = await this.processEvents(
        relevantEvents,
        correlationSource,
      );

      const duration = (Date.now() - startTime) / 1000;

      // Emit metrics
      this.metricsService.recordHistogram(
        'soroban_event_correlation_duration',
        duration,
        { source: correlationSource },
      );
      this.metricsService.incrementCounter('soroban_events_correlated', {
        count: result.correlated.toString(),
        source: correlationSource,
      });

      this.logger.log(`Event correlation completed`, {
        ...result,
        duration,
        source: correlationSource,
      });

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Event correlation failed: ${errorMessage}`, {
        error: errorMessage,
      });
      this.metricsService.incrementCounter('soroban_event_correlation_failed', {
        source: correlationSource,
        error: errorMessage.substring(0, 100),
      });
      throw error;
    }
  }

  /**
   * Fetch events from Soroban RPC for a contract within a ledger range
   */
  private async fetchEvents(
    contractId: string,
    startLedger?: number,
    endLedger?: number,
  ): Promise<SorobanEvent[]> {
    const server = this.getServer();

    const contractFilter: SorobanRpc.Api.EventFilter = {
      type: 'contract',
      contractIds: [contractId],
    };

    const response = await withRetryTimeout(
      () => {
        if (startLedger !== undefined) {
          return server.getEvents({
            filters: [contractFilter],
            startLedger,
            endLedger: endLedger || startLedger + 1000,
            limit: 1000,
          });
        }
        return server.getEvents({
          filters: [contractFilter],
          cursor: '0',
          limit: 1000,
        });
      },
      'getEvents',
      `correlation-${Date.now()}`,
      { maxRetries: 3, baseDelayMs: 1000 },
      this.logger,
    );

    const events: SorobanEvent[] = [];

    if (response.events) {
      for (const event of response.events) {
        const topic = this.extractEventTopic(event);
        if (!topic) continue;

        const payload = this.parseEventPayload(event);

        events.push({
          topic,
          payload,
          txHash: event.txHash || '',
          ledger: event.ledger || 0,
          eventIndex: event.transactionIndex || 0,
        });
      }
    }

    return events;
  }

  /**
   * Extract event topic from Soroban event
   */
  private extractEventTopic(event: { topic?: xdr.ScVal[] }): string | null {
    if (event.topic && event.topic.length > 0) {
      const native = scValToNative(event.topic[0]);
      if (typeof native === 'string') {
        return native;
      }
    }
    return null;
  }

  /**
   * Parse event payload from Soroban event
   */
  private parseEventPayload(event: { value?: xdr.ScVal }): unknown {
    if (event.value) {
      try {
        return scValToNative(event.value);
      } catch {
        return event.value.toXDR().toString('base64');
      }
    }
    return null;
  }

  /**
   * Process events and create correlation records
   */
  private async processEvents(
    events: SorobanEvent[],
    correlationSource: 'scheduled' | 'on_demand' | 'manual',
  ): Promise<EventCorrelationResult> {
    const result: EventCorrelationResult = {
      correlated: 0,
      skipped: 0,
      errors: 0,
      details: [],
    };

    for (const event of events) {
      try {
        const detail = await this.correlateSingleEvent(
          event,
          correlationSource,
        );
        result.details.push(detail);

        if (detail.success) {
          result.correlated++;
        } else {
          result.errors++;
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        result.errors++;
        result.details.push({
          txHash: event.txHash,
          eventIndex: event.eventIndex,
          eventTopic: event.topic,
          success: false,
          error: errorMessage,
        });
      }
    }

    return result;
  }

  /**
   * Correlate a single event to internal records
   */
  private async correlateSingleEvent(
    event: SorobanEvent,
    correlationSource: 'scheduled' | 'on_demand' | 'manual',
  ): Promise<EventCorrelationResult['details'][0]> {
    // Check if already correlated (idempotency)
    const existing = await this.prisma.sorobanEventCorrelation.findUnique({
      where: {
        txHash_eventIndex: {
          txHash: event.txHash,
          eventIndex: event.eventIndex,
        },
      },
    });

    if (existing) {
      return {
        txHash: event.txHash,
        eventIndex: event.eventIndex,
        eventTopic: event.topic,
        success: true,
        error: 'Already correlated',
      };
    }

    // Extract claimId and packageId from event payload
    const { claimId, packageId } = this.extractIdentifiers(event);

    // Map event topic to our enum
    const eventTopic = this.TOPIC_MAP[event.topic] || event.topic;

    // Create correlation record
    await this.prisma.sorobanEventCorrelation.create({
      data: {
        eventTopic: eventTopic as any,
        txHash: event.txHash,
        ledger: event.ledger,
        eventIndex: event.eventIndex,
        claimId,
        packageId,
        payload: event.payload as any,
        correlationSource,
      },
    });

    return {
      txHash: event.txHash,
      eventIndex: event.eventIndex,
      eventTopic,
      claimId: claimId || undefined,
      packageId: packageId || undefined,
      success: true,
    };
  }

  /**
   * Extract claimId and packageId from event payload
   * This is the core mapper logic that maps on-chain events to internal records
   */
  extractIdentifiers(event: SorobanEvent): {
    claimId?: string;
    packageId?: string;
  } {
    const payload = event.payload as Record<string, unknown> | null;
    if (!payload) return {};

    // Try to extract package_id from various possible payload structures
    const packageId = this.extractPackageId(payload);
    if (packageId) {
      // Try to find the internal claim associated with this package
      // We'll store the on-chain package ID and let the read endpoints resolve it
      return { packageId };
    }

    // Try to extract claim_id directly
    const claimId = this.extractClaimId(payload);
    if (claimId) {
      return { claimId };
    }

    return {};
  }

  /**
   * Extract package ID from event payload
   */
  private extractPackageId(payload: Record<string, unknown>): string | null {
    // Common payload structures from Soroban contracts
    const paths = [
      'package_id',
      'packageId',
      'id',
      'package',
      'data.package_id',
      'data.id',
    ];

    for (const path of paths) {
      const value = this.getNestedValue(payload, path);
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'bigint') {
        return String(value);
      }
    }

    return null;
  }

  /**
   * Extract claim ID from event payload
   */
  private extractClaimId(payload: Record<string, unknown>): string | null {
    const paths = [
      'claim_id',
      'claimId',
      'claim',
      'data.claim_id',
      'data.claimId',
      'metadata.claim_ref',
    ];

    for (const path of paths) {
      const value = this.getNestedValue(payload, path);
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'bigint') {
        return String(value);
      }
    }

    return null;
  }

  /**
   * Get nested value from object using dot notation path
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const keys = path.split('.');
    let current: unknown = obj;

    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = (current as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * On-demand correlation for a specific transaction hash
   */
  async correlateTransaction(
    txHash: string,
    correlationSource: 'on_demand' | 'manual' = 'on_demand',
  ): Promise<EventCorrelationResult> {
    this.logger.log(`Correlating transaction ${txHash} on-demand`);

    const server = this.getServer();

    try {
      const result = await withRetryTimeout(
        () => server.getTransaction(txHash),
        'getTransaction',
        `correlation-${txHash}`,
        { maxRetries: 3, baseDelayMs: 1000 },
        this.logger,
      );

      if (result.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        throw new Error(
          `Transaction ${txHash} not successful: ${result.status}`,
        );
      }

      // Get events from transaction
      const events = this.getEventsFromTransaction(result);

      // Filter to our contract
      const contractEvents = events.filter(
        e => e.contractId === this.contractId,
      );

      const sorobanEvents: SorobanEvent[] = contractEvents
        .map((e, idx) => ({
          topic: this.extractEventTopic(e) || '',
          payload: this.parseEventPayload(e),
          txHash,
          ledger: result.ledger || 0,
          eventIndex: idx,
        }))
        .filter(e => e.topic);

      return this.processEvents(sorobanEvents, correlationSource);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to correlate transaction ${txHash}: ${errorMessage}`,
      );
      throw error;
    }
  }

  /**
   * Extract events from transaction result
   */
  private getEventsFromTransaction(
    result: SorobanRpc.Api.GetSuccessfulTransactionResponse,
  ): ExtractedContractEvent[] {
    if (result.resultMetaXdr) {
      try {
        const meta = result.resultMetaXdr;
        const sorobanMeta = meta.v3().sorobanMeta();
        if (!sorobanMeta) return [];
        const contractEvents = sorobanMeta.events();
        return contractEvents.map(e => {
          const v0 = e.body().v0();
          const contractIdHash = e.contractId();
          const contractIdStr = contractIdHash
            ? Buffer.from(contractIdHash as unknown as Buffer).toString('hex')
            : '';
          return {
            topic: v0.topics(),
            value: v0.data(),
            contractId: contractIdStr,
          };
        });
      } catch {
        return [];
      }
    }
    return [];
  }

  /**
   * Get correlation records for a claim
   */
  async getCorrelationsForClaim(claimId: string) {
    return this.prisma.sorobanEventCorrelation.findMany({
      where: { claimId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get correlation records for a package (on-chain package ID)
   */
  async getCorrelationsForPackage(packageId: string) {
    return this.prisma.sorobanEventCorrelation.findMany({
      where: { packageId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get correlation records for an internal AidPackage
   */
  async getCorrelationsForAidPackage(aidPackageId: string) {
    return this.prisma.sorobanEventCorrelation.findMany({
      where: { aidPackageId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get all correlations with pagination
   */
  async getAllCorrelations(params: {
    page?: number;
    limit?: number;
    eventTopic?: string;
    claimId?: string;
    packageId?: string;
    startLedger?: number;
    endLedger?: number;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (params.eventTopic) where.eventTopic = params.eventTopic;
    if (params.claimId) where.claimId = params.claimId;
    if (params.packageId) where.packageId = params.packageId;
    if (params.startLedger || params.endLedger) {
      where.ledger = {};
      if (params.startLedger) where.ledger.gte = params.startLedger;
      if (params.endLedger) where.ledger.lte = params.endLedger;
    }

    const [data, total] = await Promise.all([
      this.prisma.sorobanEventCorrelation.findMany({
        where,
        orderBy: { ledger: 'desc' },
        skip,
        take: limit,
        include: {
          claim: { select: { id: true, status: true, amount: true } },
          aidPackage: { select: { id: true, status: true, totalAmount: true } },
        },
      }),
      this.prisma.sorobanEventCorrelation.count({ where }),
    ]);

    return { data, total, page, limit };
  }
}

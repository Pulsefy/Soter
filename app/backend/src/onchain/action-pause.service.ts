import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import {
  ActionPauseResult,
  isPausableAction,
  ONCHAIN_ADAPTER_TOKEN,
  OnchainAdapter,
  PAUSABLE_ACTIONS,
  PausableAction,
} from './onchain.adapter';

/** Audit actions recorded for per-action pause controls. */
export const ACTION_PAUSE_AUDIT_ACTIONS = {
  paused: 'contract_action_paused',
  unpaused: 'contract_action_unpaused',
} as const;

export interface ActionPauseActor {
  actorId: string;
}

export interface ActionPauseOutcome extends ActionPauseResult {
  /**
   * Whether the whole contract is paused. When `true`, `isPaused` stays `true`
   * for every action regardless of its own flag.
   */
  globallyPaused: boolean;
}

export interface ActionPauseStatus {
  globallyPaused: boolean;
  actions: Record<PausableAction, boolean>;
  timestamp: Date;
}

/**
 * Drives the contract's per-action pause controls (`pause_action`,
 * `unpause_action`, `is_action_paused`) and records every change in the
 * tamper-evident audit chain.
 *
 * Lets an operator stop a single action path (e.g. `claim`) during an incident
 * without pausing the whole contract. The global pause still takes precedence:
 * unpausing an action while the contract is globally paused succeeds, but the
 * action remains blocked until the global pause is lifted.
 */
@Injectable()
export class ActionPauseService {
  private readonly logger = new Logger(ActionPauseService.name);

  constructor(
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
    private readonly auditService: AuditService,
  ) {}

  async getStatus(): Promise<ActionPauseStatus> {
    const [{ isPaused: globallyPaused }, flags] = await Promise.all([
      this.onchainAdapter.getPauseState(),
      Promise.all(
        PAUSABLE_ACTIONS.map(action =>
          this.onchainAdapter.isActionPaused(action),
        ),
      ),
    ]);

    const actions = Object.fromEntries(
      PAUSABLE_ACTIONS.map((action, i) => [action, flags[i]]),
    ) as Record<PausableAction, boolean>;

    return { globallyPaused, actions, timestamp: new Date() };
  }

  async pause(
    actor: ActionPauseActor,
    action: string,
  ): Promise<ActionPauseOutcome> {
    const pausable = this.parseAction(action);
    const result = await this.onchainAdapter.pauseAction(pausable);

    if (!result.isPaused) {
      throw new ConflictException(
        `Contract did not record the "${pausable}" action as paused`,
      );
    }

    return this.recordChange(actor, ACTION_PAUSE_AUDIT_ACTIONS.paused, result);
  }

  async unpause(
    actor: ActionPauseActor,
    action: string,
  ): Promise<ActionPauseOutcome> {
    const pausable = this.parseAction(action);
    const result = await this.onchainAdapter.unpauseAction(pausable);
    const { isPaused: globallyPaused } =
      await this.onchainAdapter.getPauseState();

    // A global pause legitimately keeps the action blocked; anything else
    // means the contract ignored the unpause.
    if (result.isPaused && !globallyPaused) {
      throw new ConflictException(
        `Contract still reports the "${pausable}" action as paused after unpausing`,
      );
    }

    return this.recordChange(
      actor,
      ACTION_PAUSE_AUDIT_ACTIONS.unpaused,
      result,
      globallyPaused,
    );
  }

  private parseAction(action: string): PausableAction {
    if (!isPausableAction(action)) {
      throw new BadRequestException(
        `Unknown pausable action "${action}". Expected one of: ${PAUSABLE_ACTIONS.join(', ')}`,
      );
    }
    return action;
  }

  private async recordChange(
    actor: ActionPauseActor,
    auditAction: string,
    result: ActionPauseResult,
    globallyPaused?: boolean,
  ): Promise<ActionPauseOutcome> {
    const isGloballyPaused =
      globallyPaused ?? (await this.onchainAdapter.getPauseState()).isPaused;

    await this.auditService.record({
      actorId: actor.actorId,
      entity: 'ContractActionPause',
      entityId: result.action,
      action: auditAction,
      metadata: {
        action: result.action,
        effectivelyPaused: result.isPaused,
        globallyPaused: isGloballyPaused,
        transactionHash: result.transactionHash,
        onChainTimestamp: result.timestamp.toISOString(),
      },
    });

    this.logger.log(
      `${auditAction} action=${result.action} effectivelyPaused=${result.isPaused} globallyPaused=${isGloballyPaused} (actor=${actor.actorId})`,
    );

    return { ...result, globallyPaused: isGloballyPaused };
  }
}

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  AdminActionLogger,
  AdminActionState,
} from '../audit/admin-action-logger.service';
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
  correlationId?: string | null;
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
  constructor(
    @Inject(ONCHAIN_ADAPTER_TOKEN)
    private readonly onchainAdapter: OnchainAdapter,
    private readonly adminActionLogger: AdminActionLogger,
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
    let pausable: PausableAction | null = null;
    let before: AdminActionState | null = null;
    let transactionHash: string | null = null;
    return this.adminActionLogger.execute(
      {
        actor: actor.actorId,
        action: ACTION_PAUSE_AUDIT_ACTIONS.paused,
        target: () =>
          pausable ? { type: 'ContractActionPause', id: pausable } : null,
        before: () => before,
        details: () => (transactionHash ? { transactionHash } : null),
        correlationId: actor.correlationId ?? null,
      },
      async () => {
        pausable = this.parseAction(action);
        const [{ isPaused: globallyPaused }, isPaused] = await Promise.all([
          this.onchainAdapter.getPauseState(),
          this.onchainAdapter.isActionPaused(pausable),
        ]);
        before = { isPaused, globallyPaused };

        const result = await this.onchainAdapter.pauseAction(pausable);
        if (!result.isPaused) {
          throw new ConflictException(
            `Contract did not record the "${pausable}" action as paused`,
          );
        }
        transactionHash = result.transactionHash;

        const { isPaused: nextGloballyPaused } =
          await this.onchainAdapter.getPauseState();
        return { ...result, globallyPaused: nextGloballyPaused };
      },
      result => ({
        isPaused: result.isPaused,
        globallyPaused: result.globallyPaused,
      }),
    );
  }

  async unpause(
    actor: ActionPauseActor,
    action: string,
  ): Promise<ActionPauseOutcome> {
    let pausable: PausableAction | null = null;
    let before: AdminActionState | null = null;
    let transactionHash: string | null = null;
    return this.adminActionLogger.execute(
      {
        actor: actor.actorId,
        action: ACTION_PAUSE_AUDIT_ACTIONS.unpaused,
        target: () =>
          pausable ? { type: 'ContractActionPause', id: pausable } : null,
        before: () => before,
        details: () => (transactionHash ? { transactionHash } : null),
        correlationId: actor.correlationId ?? null,
      },
      async () => {
        pausable = this.parseAction(action);
        const [{ isPaused: globallyPaused }, isPaused] = await Promise.all([
          this.onchainAdapter.getPauseState(),
          this.onchainAdapter.isActionPaused(pausable),
        ]);
        before = { isPaused, globallyPaused };

        const result = await this.onchainAdapter.unpauseAction(pausable);
        transactionHash = result.transactionHash;
        const { isPaused: nextGloballyPaused } =
          await this.onchainAdapter.getPauseState();

        if (result.isPaused && !nextGloballyPaused) {
          throw new ConflictException(
            `Contract still reports the "${pausable}" action as paused after unpausing`,
          );
        }

        return { ...result, globallyPaused: nextGloballyPaused };
      },
      result => ({
        isPaused: result.isPaused,
        globallyPaused: result.globallyPaused,
      }),
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

}

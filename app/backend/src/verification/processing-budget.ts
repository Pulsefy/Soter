/**
 * Per-claim processing time budget with partial-result fallback.
 *
 * The verification pipeline chains several external calls (OCR, humanitarian
 * verification, fraud scoring).  Each individual call has its own timeout,
 * but without an overall budget the cumulative wall-clock time for a single
 * claim can drift far beyond any single step's configured timeout — retries
 * compound, and there is no point at which the system decides to return a
 * partial result and flag the remainder for manual follow-up.
 *
 * `ProcessingBudget` tracks elapsed time across the full pipeline and lets
 * each step ask "do I still have time to run?" before executing.  When the
 * budget is exhausted the caller stops, records which steps were left
 * incomplete, and surfaces a partial result instead of silently dropping the
 * unprocessed steps.
 */

/** Logical stages of the claim verification pipeline. */
export type PipelineStepName =
  | 'ocr'
  | 'humanitarian_verification'
  | 'fraud_scoring';

/** Status of a single pipeline step. */
export type StepStatus = 'completed' | 'skipped' | 'incomplete';

/** Outcome record for one pipeline step. */
export interface StepOutcome {
  step: PipelineStepName;
  status: StepStatus;
  durationMs: number;
  reason?: string;
}

/**
 * Summary attached to a `VerificationResult` when the pipeline could not
 * complete every step within the budget.
 */
export interface PartialResultInfo {
  /** True when the total budget was exhausted before all steps finished. */
  budgetExhausted: boolean;
  /** Configured budget in milliseconds. */
  budgetMs: number;
  /** Wall-clock milliseconds elapsed when the pipeline stopped. */
  elapsedMs: number;
  /** Steps that finished before the budget ran out. */
  completedSteps: PipelineStepName[];
  /** Steps that were never started or did not finish. */
  incompleteSteps: PipelineStepName[];
  /** Always true when the result is partial — claim needs manual review. */
  manualReviewRequired: boolean;
}

/**
 * Tracks elapsed time across the full claim verification pipeline and signals
 * when the per-claim budget is exhausted.
 *
 * The class is deliberately side-effect free apart from reading `Date.now()`,
 * which makes it trivial to unit-test by injecting a clock or, in integration
 * tests, by setting a tiny budget and adding real delays to mocked steps.
 */
export class ProcessingBudget {
  private readonly startedAt: number;
  private readonly budgetMs: number;
  private readonly outcomes: StepOutcome[] = [];

  constructor(budgetMs: number) {
    this.startedAt = Date.now();
    this.budgetMs = budgetMs > 0 ? budgetMs : 0;
  }

  /** Milliseconds elapsed since the budget was created. */
  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  /** Milliseconds remaining before the budget is exhausted (≥ 0). */
  remainingMs(): number {
    return Math.max(0, this.budgetMs - this.elapsedMs());
  }

  /** True when the elapsed time has reached or exceeded the budget. */
  isExhausted(): boolean {
    return this.elapsedMs() >= this.budgetMs;
  }

  /**
   * Record that a step completed successfully.
   * @param step    - Logical step name.
   * @param durationMs - How long the step took.
   */
  recordCompleted(step: PipelineStepName, durationMs: number): void {
    this.outcomes.push({ step, status: 'completed', durationMs });
  }

  /**
   * Record that a step was intentionally skipped (e.g. no evidence URL so OCR
   * was not needed).  Skipped steps are not failures.
   */
  recordSkipped(step: PipelineStepName, reason: string): void {
    this.outcomes.push({ step, status: 'skipped', durationMs: 0, reason });
  }

  /**
   * Record that a step was never started or did not finish because the budget
   * was exhausted.  Incomplete steps are surfaced explicitly so the caller
   * can flag them for manual review rather than silently dropping them.
   */
  recordIncomplete(step: PipelineStepName, reason: string): void {
    this.outcomes.push({ step, status: 'incomplete', durationMs: 0, reason });
  }

  /** Steps that finished. */
  getCompletedSteps(): PipelineStepName[] {
    return this.outcomes
      .filter((o) => o.status === 'completed')
      .map((o) => o.step);
  }

  /** Steps that were never started or did not finish. */
  getIncompleteSteps(): PipelineStepName[] {
    return this.outcomes
      .filter((o) => o.status === 'incomplete')
      .map((o) => o.step);
  }

  /** All recorded step outcomes. */
  getOutcomes(): StepOutcome[] {
    return [...this.outcomes];
  }

  /**
   * Build a `PartialResultInfo` snapshot suitable for attaching to a
   * `VerificationResult`.  `manualReviewRequired` is always true because this
   * is only called when the pipeline produced a partial result.
   */
  toPartialResultInfo(): PartialResultInfo {
    return {
      budgetExhausted: this.isExhausted(),
      budgetMs: this.budgetMs,
      elapsedMs: this.elapsedMs(),
      completedSteps: this.getCompletedSteps(),
      incompleteSteps: this.getIncompleteSteps(),
      manualReviewRequired: true,
    };
  }
}

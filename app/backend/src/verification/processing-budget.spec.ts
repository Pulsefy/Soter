import {
  ProcessingBudget,
  PartialResultInfo,
} from './processing-budget';

describe('ProcessingBudget', () => {
  let originalDateNow: () => number;
  let currentTime: number;

  beforeEach(() => {
    originalDateNow = Date.now;
    currentTime = 1000000;
    Date.now = () => currentTime;
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  const advance = (ms: number) => {
    currentTime += ms;
  };

  describe('basic timing', () => {
    it('should report zero elapsed at creation', () => {
      const budget = new ProcessingBudget(60000);
      expect(budget.elapsedMs()).toBe(0);
      expect(budget.remainingMs()).toBe(60000);
      expect(budget.isExhausted()).toBe(false);
    });

    it('should track elapsed time', () => {
      const budget = new ProcessingBudget(60000);
      advance(5000);
      expect(budget.elapsedMs()).toBe(5000);
      expect(budget.remainingMs()).toBe(55000);
      expect(budget.isExhausted()).toBe(false);
    });

    it('should detect budget exhaustion', () => {
      const budget = new ProcessingBudget(1000);
      advance(999);
      expect(budget.isExhausted()).toBe(false);
      advance(1);
      expect(budget.isExhausted()).toBe(true);
      expect(budget.remainingMs()).toBe(0);
    });

    it('should clamp remaining to zero when over budget', () => {
      const budget = new ProcessingBudget(100);
      advance(500);
      expect(budget.remainingMs()).toBe(0);
      expect(budget.isExhausted()).toBe(true);
    });

    it('should treat zero or negative budget as already exhausted', () => {
      const zero = new ProcessingBudget(0);
      expect(zero.isExhausted()).toBe(true);
      expect(zero.remainingMs()).toBe(0);

      const negative = new ProcessingBudget(-100);
      expect(negative.isExhausted()).toBe(true);
    });
  });

  describe('step recording', () => {
    it('should record completed steps', () => {
      const budget = new ProcessingBudget(60000);
      budget.recordCompleted('ocr', 1200);
      budget.recordCompleted('humanitarian_verification', 3000);
      budget.recordCompleted('fraud_scoring', 50);

      expect(budget.getCompletedSteps()).toEqual([
        'ocr',
        'humanitarian_verification',
        'fraud_scoring',
      ]);
      expect(budget.getIncompleteSteps()).toEqual([]);
    });

    it('should record skipped steps separately from completed', () => {
      const budget = new ProcessingBudget(60000);
      budget.recordSkipped('ocr', 'evidenceRef is not a URL');
      budget.recordCompleted('humanitarian_verification', 3000);
      budget.recordCompleted('fraud_scoring', 50);

      expect(budget.getCompletedSteps()).toEqual([
        'humanitarian_verification',
        'fraud_scoring',
      ]);
      expect(budget.getIncompleteSteps()).toEqual([]);
    });

    it('should record incomplete steps', () => {
      const budget = new ProcessingBudget(1000);
      budget.recordCompleted('ocr', 1200);
      budget.recordIncomplete('humanitarian_verification', 'budget exhausted');
      budget.recordIncomplete('fraud_scoring', 'budget exhausted');

      expect(budget.getCompletedSteps()).toEqual(['ocr']);
      expect(budget.getIncompleteSteps()).toEqual([
        'humanitarian_verification',
        'fraud_scoring',
      ]);
    });

    it('should expose all outcomes', () => {
      const budget = new ProcessingBudget(60000);
      budget.recordCompleted('ocr', 1200);
      budget.recordSkipped('humanitarian_verification', 'not needed');
      budget.recordIncomplete('fraud_scoring', 'budget exhausted');

      const outcomes = budget.getOutcomes();
      expect(outcomes).toHaveLength(3);
      expect(outcomes[0]).toEqual({
        step: 'ocr',
        status: 'completed',
        durationMs: 1200,
      });
      expect(outcomes[1]).toEqual({
        step: 'humanitarian_verification',
        status: 'skipped',
        durationMs: 0,
        reason: 'not needed',
      });
      expect(outcomes[2]).toEqual({
        step: 'fraud_scoring',
        status: 'incomplete',
        durationMs: 0,
        reason: 'budget exhausted',
      });
    });
  });

  describe('toPartialResultInfo', () => {
    it('should build partial result info with manual review flag', () => {
      const budget = new ProcessingBudget(5000);
      budget.recordCompleted('ocr', 3000);
      advance(5500); // budget now exhausted
      budget.recordIncomplete('humanitarian_verification', 'budget exhausted');
      budget.recordIncomplete('fraud_scoring', 'budget exhausted');

      const info: PartialResultInfo = budget.toPartialResultInfo();

      expect(info.budgetExhausted).toBe(true);
      expect(info.budgetMs).toBe(5000);
      expect(info.elapsedMs).toBe(5500);
      expect(info.completedSteps).toEqual(['ocr']);
      expect(info.incompleteSteps).toEqual([
        'humanitarian_verification',
        'fraud_scoring',
      ]);
      expect(info.manualReviewRequired).toBe(true);
    });

    it('should report budgetExhausted false when not yet exceeded', () => {
      const budget = new ProcessingBudget(60000);
      budget.recordCompleted('ocr', 1000);
      advance(2000);

      const info = budget.toPartialResultInfo();
      expect(info.budgetExhausted).toBe(false);
      expect(info.manualReviewRequired).toBe(true);
    });
  });
});

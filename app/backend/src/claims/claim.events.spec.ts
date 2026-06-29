import { CLAIM_EVENT, ClaimCancelledEvent, ClaimReissuedEvent } from './claim.events';

describe('ClaimEvents Schema', () => {
  describe('CLAIM_EVENT constants', () => {
    it('should have CANCELLED = claim.cancelled', () => {
      expect(CLAIM_EVENT.CANCELLED).toBe('claim.cancelled');
    });

    it('should have REISSUED = claim.reissued', () => {
      expect(CLAIM_EVENT.REISSUED).toBe('claim.reissued');
    });
  });

  describe('ClaimCancelledEvent', () => {
    const validEvent: ClaimCancelledEvent = {
      type: CLAIM_EVENT.CANCELLED,
      claimId: 'claim-123',
      campaignId: 'campaign-1',
      operatorId: 'operator-1',
      reason: 'Duplicate entry',
      unlockedAmount: 100,
      timestamp: new Date('2025-01-01T00:00:00Z'),
    };

    it('should have all required fields', () => {
      expect(validEvent).toHaveProperty('type');
      expect(validEvent).toHaveProperty('claimId');
      expect(validEvent).toHaveProperty('campaignId');
      expect(validEvent).toHaveProperty('operatorId');
      expect(validEvent).toHaveProperty('unlockedAmount');
      expect(validEvent).toHaveProperty('timestamp');
    });

    it('should have correct type value', () => {
      expect(validEvent.type).toBe('claim.cancelled');
    });

    it('should have a claimId as string', () => {
      expect(typeof validEvent.claimId).toBe('string');
    });

    it('should have a campaignId as string', () => {
      expect(typeof validEvent.campaignId).toBe('string');
    });

    it('should have an operatorId as string', () => {
      expect(typeof validEvent.operatorId).toBe('string');
    });

    it('should have unlockedAmount as number', () => {
      expect(typeof validEvent.unlockedAmount).toBe('number');
    });

    it('should have timestamp as Date', () => {
      expect(validEvent.timestamp).toBeInstanceOf(Date);
    });

    it('should allow optional reason field', () => {
      const withoutReason: ClaimCancelledEvent = {
        type: CLAIM_EVENT.CANCELLED,
        claimId: 'claim-123',
        campaignId: 'campaign-1',
        operatorId: 'operator-1',
        unlockedAmount: 50,
        timestamp: new Date(),
      };
      expect(withoutReason.reason).toBeUndefined();
    });
  });

  describe('ClaimReissuedEvent', () => {
    const validEvent: ClaimReissuedEvent = {
      type: CLAIM_EVENT.REISSUED,
      newClaimId: 'claim-456',
      originalClaimId: 'claim-123',
      campaignId: 'campaign-1',
      operatorId: 'operator-1',
      amount: 100,
      reason: 'Amount adjustment',
      timestamp: new Date('2025-01-01T00:00:00Z'),
    };

    it('should have all required fields', () => {
      expect(validEvent).toHaveProperty('type');
      expect(validEvent).toHaveProperty('newClaimId');
      expect(validEvent).toHaveProperty('originalClaimId');
      expect(validEvent).toHaveProperty('campaignId');
      expect(validEvent).toHaveProperty('operatorId');
      expect(validEvent).toHaveProperty('amount');
      expect(validEvent).toHaveProperty('timestamp');
    });

    it('should have correct type value', () => {
      expect(validEvent.type).toBe('claim.reissued');
    });

    it('should have newClaimId as string', () => {
      expect(typeof validEvent.newClaimId).toBe('string');
    });

    it('should have originalClaimId as string', () => {
      expect(typeof validEvent.originalClaimId).toBe('string');
    });

    it('should have campaignId as string', () => {
      expect(typeof validEvent.campaignId).toBe('string');
    });

    it('should have operatorId as string', () => {
      expect(typeof validEvent.operatorId).toBe('string');
    });

    it('should have amount as number', () => {
      expect(typeof validEvent.amount).toBe('number');
    });

    it('should have timestamp as Date', () => {
      expect(validEvent.timestamp).toBeInstanceOf(Date);
    });

    it('should allow optional reason field', () => {
      const withoutReason: ClaimReissuedEvent = {
        type: CLAIM_EVENT.REISSUED,
        newClaimId: 'claim-456',
        originalClaimId: 'claim-123',
        campaignId: 'campaign-1',
        operatorId: 'operator-1',
        amount: 50,
        timestamp: new Date(),
      };
      expect(withoutReason.reason).toBeUndefined();
    });
  });

  describe('ClaimCancelledEvent invariants', () => {
    it('should use the same type constant for CANCELLED', () => {
      const event: ClaimCancelledEvent = {
        type: 'claim.cancelled',
        claimId: 'c-1',
        campaignId: 'camp-1',
        operatorId: 'op-1',
        unlockedAmount: 0,
        timestamp: new Date(),
      };
      expect(event.type).toBe(CLAIM_EVENT.CANCELLED);
    });
  });

  describe('ClaimReissuedEvent invariants', () => {
    it('should use the same type constant for REISSUED', () => {
      const event: ClaimReissuedEvent = {
        type: 'claim.reissued',
        newClaimId: 'c-2',
        originalClaimId: 'c-1',
        campaignId: 'camp-1',
        operatorId: 'op-1',
        amount: 0,
        timestamp: new Date(),
      };
      expect(event.type).toBe(CLAIM_EVENT.REISSUED);
    });
  });
});

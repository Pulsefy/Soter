import {
  ENTITY_LINK_CONFIDENCE_CONFIG,
  getConfidenceBand,
} from './entity-link-confidence.config';

describe('entity-link-confidence.config', () => {
  it('defaults AUTO_ACCEPT_THRESHOLD to 0.9 when no env var is set', () => {
    expect(ENTITY_LINK_CONFIDENCE_CONFIG.AUTO_ACCEPT_THRESHOLD).toBe(0.9);
  });

  describe('getConfidenceBand', () => {
    it('bands a score at or above the threshold as auto_accept', () => {
      expect(getConfidenceBand(0.9, 0.9)).toBe('auto_accept');
      expect(getConfidenceBand(0.95, 0.9)).toBe('auto_accept');
      expect(getConfidenceBand(1.0, 0.9)).toBe('auto_accept');
    });

    it('bands a score below the threshold as needs_review', () => {
      expect(getConfidenceBand(0.89, 0.9)).toBe('needs_review');
      expect(getConfidenceBand(0, 0.9)).toBe('needs_review');
    });

    it('uses the configured default threshold when none is passed', () => {
      const threshold = ENTITY_LINK_CONFIDENCE_CONFIG.AUTO_ACCEPT_THRESHOLD;
      expect(getConfidenceBand(threshold)).toBe('auto_accept');
      expect(getConfidenceBand(threshold - 0.01)).toBe('needs_review');
    });
  });
});

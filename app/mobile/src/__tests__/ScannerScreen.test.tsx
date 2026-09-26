import { parseAidIdFromQRCode } from '../screens/ScannerScreen';
import { createScanDeduper } from '../screens/scanDeduper';

describe('ScannerScreen QR parsing', () => {
  it('extracts aidId from app deep link', () => {
    expect(parseAidIdFromQRCode('soter://package/aid-123')).toBe('aid-123');
  });

  it('extracts aidId from testnet URL', () => {
    expect(parseAidIdFromQRCode('https://testnet.soter.app/package/aid-456')).toBe('aid-456');
  });

  it('returns null for invalid QR content', () => {
    expect(parseAidIdFromQRCode('https://example.com')).toBeNull();
  });
});

describe('scan deduplication', () => {
  it('suppresses the same scan during the debounce window', () => {
    let now = 1000;
    const isDuplicate = createScanDeduper(1500, () => now);

    expect(isDuplicate('aid-123')).toBe(false);
    now += 500;
    expect(isDuplicate('aid-123')).toBe(true);
    now += 1500;
    expect(isDuplicate('aid-123')).toBe(false);
  });

  it('allows different packages without waiting', () => {
    const isDuplicate = createScanDeduper(1500, () => 1000);

    expect(isDuplicate('aid-123')).toBe(false);
    expect(isDuplicate('aid-456')).toBe(false);
  });
});

import { parseAidIdFromQRCode } from '../screens/ScannerScreen';

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

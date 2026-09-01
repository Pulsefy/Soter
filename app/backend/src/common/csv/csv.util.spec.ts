import { escapeCsvField, toCsvRow } from './csv.util';

describe('escapeCsvField', () => {
  it('wraps plain values in quotes', () => {
    expect(escapeCsvField('hello')).toBe('"hello"');
    expect(escapeCsvField(42)).toBe('"42"');
  });

  it('doubles embedded quote characters', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('does not treat commas or newlines specially beyond quoting', () => {
    expect(escapeCsvField('a,b\nc')).toBe('"a,b\nc"');
  });

  it('renders null/undefined as an empty quoted field', () => {
    expect(escapeCsvField(null)).toBe('""');
    expect(escapeCsvField(undefined)).toBe('""');
  });
});

describe('toCsvRow', () => {
  it('joins fields with commas and terminates with CRLF', () => {
    expect(toCsvRow(['"a"', '"b"', '"c"'])).toBe('"a","b","c"\r\n');
  });
});

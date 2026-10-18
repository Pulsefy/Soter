import { sha256, toHex } from '../services/sha256';

const hex = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('sha256', () => {
  it('matches the published NIST/FIPS vectors', () => {
    expect(toHex(sha256(hex('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(toHex(sha256(hex('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(
      toHex(sha256(hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('hashes the evidence chunk checksum input used by the sync queue', () => {
    expect(toHex(sha256(hex('Hello World')))).toBe(
      'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e',
    );
  });

  it('handles inputs that cross a block boundary', () => {
    // 55, 56 and 64 bytes exercise the "length spills into an extra block"
    // padding cases; 1 MB exercises the multi-block loop.
    const expectations: [number, string][] = [
      [55, '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318'],
      [56, 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a'],
      [64, 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb'],
    ];

    for (const [length, expected] of expectations) {
      expect(toHex(sha256(new Uint8Array(length).fill(0x61)))).toBe(expected);
    }

    const megabyte = new Uint8Array(1024 * 1024).fill(0x61);
    expect(toHex(sha256(megabyte))).toBe(
      '9bc1b2a288b26af7257a36277ae3816a7d4f16e89c1e7e77d0a5c48bad62b360',
    );
  });
});

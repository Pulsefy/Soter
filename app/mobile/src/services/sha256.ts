/**
 * Dependency-free SHA-256 (FIPS 180-4).
 *
 * React Native has no `crypto.subtle`: `react-native-get-random-values`
 * polyfills `getRandomValues` only, and the `crypto` shim Metro resolves has
 * no `webcrypto`. That was invisible until the evidence-upload chunk path
 * (which digests every chunk) ran on a real device — the release build threw
 * `WebCrypto subtle is not available` and every upload failed
 * (`sync.dispatch.failed` in logcat). `syncQueue.sha256Hex` prefers the
 * platform `crypto.subtle` when it exists and falls back to this.
 *
 * Pure TypeScript with no platform dependency, so it is unit tested against
 * the NIST vectors without a device (see `__tests__/sha256.test.ts`).
 */

/** Round constants: first 32 bits of the fractional parts of the cube roots
 *  of the first 64 primes. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Initial hash values: first 32 bits of the fractional parts of the square
 *  roots of the first 8 primes. */
const H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
]);

const rotr = (value: number, bits: number): number =>
  (value >>> bits) | (value << (32 - bits));

/**
 * Computes the SHA-256 digest of `input`.
 *
 * @param input Raw bytes to hash.
 * @returns The 32-byte digest.
 */
export function sha256(input: Uint8Array): Uint8Array {
  const bitLength = input.length * 8;

  // Pad: 0x80, then zeros, then the 64-bit big-endian message length, so the
  // total is a multiple of 64 bytes.
  const padded = new Uint8Array((((input.length + 8) >> 6) + 1) << 6);
  padded.set(input);
  padded[input.length] = 0x80;
  const paddedView = new DataView(padded.buffer);
  paddedView.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);
  paddedView.setUint32(padded.length - 4, bitLength >>> 0, false);

  const hash = Uint32Array.from(H0);
  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      schedule[i] = paddedView.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const w15 = schedule[i - 15];
      const w2 = schedule[i - 2];
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      schedule[i] = (schedule[i - 16] + s0 + schedule[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;

    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + schedule[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let i = 0; i < 8; i += 1) {
    digestView.setUint32(i * 4, hash[i], false);
  }
  return digest;
}

/** Lowercase hex encoding of a byte array. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

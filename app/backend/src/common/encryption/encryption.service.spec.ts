import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

describe('EncryptionService', () => {
  let service: EncryptionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncryptionService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string): string | undefined => {
              if (key === 'ENCRYPTION_MASTER_KEY')
                return 'test-master-key-that-is-long-enough-32b!';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<EncryptionService>(EncryptionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('encrypt / decrypt', () => {
    it('should encrypt and decrypt a string correctly', () => {
      const plaintext = 'recipient@example.com';
      const encrypted = service.encrypt(plaintext);
      expect(encrypted).not.toBe(plaintext);
      expect(service.decrypt(encrypted)).toBe(plaintext);
    });

    it('should produce different ciphertext on each call (non-deterministic)', () => {
      const plaintext = 'same-input';
      const enc1 = service.encrypt(plaintext);
      const enc2 = service.encrypt(plaintext);
      expect(enc1).not.toBe(enc2);
    });

    it('should encrypt and decrypt an empty string', () => {
      expect(service.decrypt(service.encrypt(''))).toBe('');
    });

    it('should throw on invalid ciphertext format', () => {
      expect(() => service.decrypt('notavalidformat')).toThrow(
        'Invalid encrypted value',
      );
    });

    it('should throw on tampered ciphertext (GCM auth tag check)', () => {
      const encrypted = service.encrypt('sensitive-data');
      const parts = encrypted.split(':');
      // flip last byte of ciphertext
      const tampered = parts[0] + ':' + parts[1] + ':' + 'ff' + parts[2];
      expect(() => service.decrypt(tampered)).toThrow();
    });
  });

  describe('encryptDeterministic / decryptDeterministic', () => {
    it('should encrypt and decrypt a string correctly', () => {
      const plaintext = '+15551234567';
      const encrypted = service.encryptDeterministic(plaintext);
      expect(encrypted).not.toBe(plaintext);
      expect(service.decryptDeterministic(encrypted)).toBe(plaintext);
    });

    it('should produce the same ciphertext for the same input', () => {
      const plaintext = 'user@example.com';
      expect(service.encryptDeterministic(plaintext)).toBe(
        service.encryptDeterministic(plaintext),
      );
    });

    it('should produce different ciphertexts for different inputs', () => {
      expect(service.encryptDeterministic('foo')).not.toBe(
        service.encryptDeterministic('bar'),
      );
    });

    it('should encrypt and decrypt special characters', () => {
      const plaintext = 'user+tag@example.co.uk';
      expect(
        service.decryptDeterministic(service.encryptDeterministic(plaintext)),
      ).toBe(plaintext);
    });
  });
});

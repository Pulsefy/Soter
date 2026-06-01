import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TextIntakeService } from './text-intake.service';

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    })),
  };
});

describe('TextIntakeService', () => {
  let service: TextIntakeService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        OPENAI_API_KEY: undefined,
        OPENAI_MODEL: 'gpt-4o-mini',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TextIntakeService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<TextIntakeService>(TextIntakeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processTextIntake', () => {
    it('should throw error for empty text', async () => {
      await expect(service.processTextIntake('')).rejects.toThrow('Text input cannot be empty');
      await expect(service.processTextIntake('   ')).rejects.toThrow('Text input cannot be empty');
    });

    it('should process English text and return canonical analysis', async () => {
      const result = await service.processTextIntake(
        'We need emergency food assistance for our family of five. The situation is critical.',
      );

      expect(result).toHaveProperty('originalText');
      expect(result).toHaveProperty('normalizedText');
      expect(result).toHaveProperty('language');
      expect(result).toHaveProperty('languageConfidence');
      expect(result).toHaveProperty('translations');
      expect(result).toHaveProperty('extractedEntities');
      expect(result).toHaveProperty('keyThemes');
      expect(result).toHaveProperty('sentiment');
      expect(result).toHaveProperty('processedAt');
      expect(result.language).toBe('en');
    });

    it('should normalize text by collapsing whitespace', async () => {
      const result = await service.processTextIntake(
        'We   need     emergency     \n\n food    assistance.',
      );

      expect(result.normalizedText).toBe('We need emergency food assistance.');
    });

    it('should extract themes from English text', async () => {
      const result = await service.processTextIntake(
        'We need medical assistance for the children at the local clinic.',
      );

      expect(result.keyThemes).toContain('medical');
    });

    it('should detect negative sentiment in aid requests', async () => {
      const result = await service.processTextIntake(
        'We urgently need emergency shelter after losing our home.',
      );

      expect(result.sentiment).toBe('negative');
    });

    it('should extract dates from text', async () => {
      const result = await service.processTextIntake(
        'The incident occurred on 2024-01-15 and we need help.',
      );

      expect(result.extractedEntities.dates).toContain('2024-01-15');
    });

    it('should extract amounts with dollar signs', async () => {
      const result = await service.processTextIntake(
        'We need $500 USD for medical supplies.',
      );

      expect(result.extractedEntities.amounts.length).toBeGreaterThan(0);
      expect(result.extractedEntities.amounts.some(a => a.includes('$500'))).toBe(true);
    });
  });

  describe('detectLanguage', () => {
    it('should detect English text', async () => {
      const result = await service.detectLanguage(
        'This is a simple English text for testing.',
      );

      expect(result.language).toBe('en');
    });

    it('should detect Spanish text', async () => {
      const result = await service.detectLanguage(
        'Esta es una texto en español para probar la detección.',
      );

      expect(result.language).toBe('es');
    });

    it('should detect French text with accented characters', async () => {
      const result = await service.detectLanguage(
        "C'est un texte en français avec des caractères spéciaux: éèêë",
      );

      expect(result.language).toBe('fr');
    });

    it('should detect Arabic text', async () => {
      const result = await service.detectLanguage(
        'هذا نص باللغة العربية للتحقق من الكشف عن اللغة',
      );

      expect(result.language).toBe('ar');
    });

    it('should detect Russian text', async () => {
      const result = await service.detectLanguage(
        'Это текст на русском языке для проверки определения языка',
      );

      expect(result.language).toBe('ru');
    });

    it('should detect Chinese text', async () => {
      const result = await service.detectLanguage('这是中文文本用于测试语言检测');

      expect(result.language).toBe('zh');
    });

    it('should detect Japanese text', async () => {
      const result = await service.detectLanguage('これは言語検出をテストする日本語テキストです');

      expect(result.language).toBe('ja');
    });

    it('should default to English for unknown languages', async () => {
      const result = await service.detectLanguage('xyz123 abc random text');

      expect(result.language).toBe('en');
    });
  });

  describe('translateToEnglish', () => {
    it('should return high confidence for English input', async () => {
      const result = await service.translateToEnglish(
        'This is already in English.',
        'en',
      );

      expect(result.english).toBeUndefined();
      expect(result.confidence).toBe(1);
    });
  });
});
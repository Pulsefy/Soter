import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export type SupportedLanguage = 'en' | 'es' | 'fr' | 'ar' | 'ru' | 'zh' | 'pt' | 'de' | 'ja' | 'ko' | 'hi' | 'id';

export interface DetectedLanguage {
  language: SupportedLanguage;
  confidence: number;
}

export interface NormalizedText {
  originalText: string;
  normalizedText: string;
  detectedLanguage: DetectedLanguage;
  translatedToEnglish?: string;
  translationConfidence?: number;
}

export interface CanonicalAnalysis {
  originalText: string;
  normalizedText: string;
  language: SupportedLanguage;
  languageConfidence: number;
  translations: {
    english?: string;
    confidence: number;
  };
  extractedEntities: {
    names: string[];
    locations: string[];
    dates: string[];
    amounts: string[];
  };
  keyThemes: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  processedAt: Date;
}

@Injectable()
export class TextIntakeService {
  private readonly logger = new Logger(TextIntakeService.name);
  private readonly openai: OpenAI | null;
  private readonly targetLanguage: SupportedLanguage = 'en';

  private readonly LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    ar: 'Arabic',
    ru: 'Russian',
    zh: 'Chinese',
    pt: 'Portuguese',
    de: 'German',
    ja: 'Japanese',
    ko: 'Korean',
    hi: 'Hindi',
    id: 'Indonesian',
  };

  constructor(private readonly configService: ConfigService) {
    const openAIKey = this.configService.get<string>('OPENAI_API_KEY');
    if (openAIKey) {
      const model = this.configService.get<string>('OPENAI_MODEL') || 'gpt-4o-mini';
      this.openai = new OpenAI({ apiKey: openAIKey });
      this.logger.log(`TextIntakeService initialized with OpenAI model: ${model}`);
    } else {
      this.openai = null;
      this.logger.warn('OPENAI_API_KEY not set – text intake will use fallback detection');
    }
  }

  async processTextIntake(text: string): Promise<CanonicalAnalysis> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text input cannot be empty');
    }

    const detectedLanguage = await this.detectLanguage(text);
    const normalizedText = this.normalizeText(text);
    const translation = await this.translateToEnglish(text, detectedLanguage.language);

    const analysis = await this.analyzeTextForEntities(
      translation.english ?? normalizedText,
      normalizedText,
    );

    return {
      originalText: text,
      normalizedText,
      language: detectedLanguage.language,
      languageConfidence: detectedLanguage.confidence,
      translations: {
        english: translation.english,
        confidence: translation.confidence ?? 0,
      },
      extractedEntities: analysis.entities,
      keyThemes: analysis.themes,
      sentiment: analysis.sentiment,
      processedAt: new Date(),
    };
  }

  async detectLanguage(text: string): Promise<DetectedLanguage> {
    if (!this.openai) {
      return this.fallbackLanguageDetection(text);
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 128,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are a language detection service. Detect the language of the given text and return ONLY a JSON object with:
{
  "language": "<iso-639-1 code>",
  "confidence": <0-1>
}
Only detect from these languages: en, es, fr, ar, ru, zh, pt, de, ja, ko, hi, id. If unsure, default to "en".`,
          },
          {
            role: 'user',
            content: text.slice(0, 2000),
          },
        ],
      });

      const rawContent = response.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(rawContent) as { language: string; confidence: number };

      if (parsed.language && this.isValidLanguage(parsed.language)) {
        return {
          language: parsed.language as SupportedLanguage,
          confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.5)),
        };
      }
    } catch (err) {
      this.logger.warn(`Language detection failed: ${(err as Error).message}`);
    }

    return this.fallbackLanguageDetection(text);
}

  private fallbackLanguageDetection(text: string): DetectedLanguage {
    const languagePatterns: Record<SupportedLanguage, RegExp[]> = {
      en: [/^[a-zA-Z\s.,!?'"-:]+$/],
      es: [/\b(el|la|los|las|de|del|que|y|en|un|una)\b/i, /ñ/i, /[áéíóú]/i],
      fr: [/\b(le|la|les|du|des|que|et|en|un|une)\b/i, /[àâäéèêëïîôöùûüÿç]/i],
      ar: [/[\u0600-\u06FF]/],
      ru: [/[\u0400-\u04FF]/],
      zh: [/[\u4e00-\u9fa5]/],
      pt: [/\b(o|a|os|as|de|do|da|que|e|em|um|uma)\b/i, /[ãõáéíóúç]/i],
      de: [/\b(der|die|das|und|in|von|zu|mit|für)\b/i, /[äöüß]/i],
      ja: [/[\u3040-\u309f\u30a0-\u30ff]/],
      ko: [/[\uac00-\ud7af\u1100-\u11ff]/],
      hi: [/[\u0900-\u097f]/],
      id: [/\b(yang|dan|dari|untuk|dengan|ini|itu|tidak|ada)\b/i],
    };

    let bestMatch: { language: SupportedLanguage; score: number } | null = null;

    for (const [lang, patterns] of Object.entries(languagePatterns)) {
      let matches = 0;
      for (const pattern of patterns) {
        if (pattern.test(text)) matches++;
      }
      const score = matches / patterns.length;
      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { language: lang as SupportedLanguage, score };
      }
    }

    return {
      language: bestMatch?.language ?? 'en',
      confidence: bestMatch?.score ?? 0.5,
    };
  }

  private isValidLanguage(lang: string): boolean {
    return lang in this.LANGUAGE_NAMES;
  }

  private normalizeText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/[ \t]+$/gm, '')
      .replace(/^[ \t]+/gm, '')
      .trim();
  }

  async translateToEnglish(
    text: string,
    sourceLanguage: SupportedLanguage,
  ): Promise<{ english?: string; confidence: number }> {
    if (!this.openai || sourceLanguage === 'en') {
      return { confidence: sourceLanguage === 'en' ? 1 : 0 };
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 2048,
        messages: [
          {
            role: 'system',
            content: `Translate the following ${this.LANGUAGE_NAMES[sourceLanguage]} text to English. Return ONLY the translated text, no markdown or formatting. If translation is not possible, return empty string.`,
          },
          {
            role: 'user',
            content: text,
          },
        ],
      });

      const translated = response.choices[0]?.message?.content?.trim();
      if (translated && translated.length > 0) {
        return { english: translated, confidence: 0.9 };
      }
    } catch (err) {
      this.logger.warn(`Translation failed: ${(err as Error).message}`);
    }

    return { confidence: 0 };
  }

  private async analyzeTextForEntities(
    text: string,
    normalizedText: string,
  ): Promise<{
    entities: { names: string[]; locations: string[]; dates: string[]; amounts: string[] };
    themes: string[];
    sentiment: 'positive' | 'neutral' | 'negative';
  }> {
    if (!this.openai) {
      return this.fallbackEntityExtraction(normalizedText);
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 512,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `Analyze the text and extract entities/themes/sentiment. Return ONLY JSON:
{
  "entities": { "names": [], "locations": [], "dates": [], "amounts": [] },
  "themes": [],
  "sentiment": "positive" | "neutral" | "negative"
}`,
          },
          {
            role: 'user',
            content: text.slice(0, 2000),
          },
        ],
      });

      const rawContent = response.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(rawContent);

      return {
        entities: {
          names: Array.isArray(parsed.entities?.names) ? parsed.entities.names : [],
          locations: Array.isArray(parsed.entities?.locations) ? parsed.entities.locations : [],
          dates: Array.isArray(parsed.entities?.dates) ? parsed.entities.dates : [],
          amounts: Array.isArray(parsed.entities?.amounts) ? parsed.entities.amounts : [],
        },
        themes: Array.isArray(parsed.themes) ? parsed.themes : [],
        sentiment: ['positive', 'neutral', 'negative'].includes(parsed.sentiment)
          ? (parsed.sentiment as 'positive' | 'neutral' | 'negative')
          : 'neutral',
      };
    } catch (err) {
      this.logger.warn(`Entity extraction failed: ${(err as Error).message}`);
    }

    return this.fallbackEntityExtraction(normalizedText);
  }

  private fallbackEntityExtraction(text: string): {
    entities: { names: string[]; locations: string[]; dates: string[]; amounts: string[] };
    themes: string[];
    sentiment: 'positive' | 'neutral' | 'negative';
  } {
    const datePatterns = [
      /\b\d{4}-\d{2}-\d{2}\b/,
      /\b\d{2}\/\d{2}\/\d{4}\b/,
      /\b\d{2}\.\d{2}\.\d{4}\b/,
      /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}\b/i,
    ];

    const amountPatterns = [
      /\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g,
      /\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s*(?:USD|EUR|GBP| dollars| euros)?/gi,
    ];

    const dates: string[] = [];
    for (const pattern of datePatterns) {
      const matches = text.match(pattern);
      if (matches) dates.push(...matches);
    }

    const amounts: string[] = [];
    for (const pattern of amountPatterns) {
      const matches = text.match(pattern);
      if (matches) amounts.push(...matches);
    }

    const themes = this.extractThemes(text);

    return {
      entities: { names: [], locations: [], dates, amounts },
      themes,
      sentiment: this.detectSentiment(text),
    };
  }

  private extractThemes(text: string): string[] {
    const themeKeywords: Record<string, string[]> = {
      aid: ['aid', 'assistance', 'help', 'support', 'relief'],
      medical: ['medical', 'health', 'hospital', 'clinic', 'doctor', 'treatment'],
      food: ['food', 'hunger', 'malnutrition', 'feeding', 'ration'],
      shelter: ['shelter', 'housing', 'home', 'displacement', 'refugee'],
      education: ['education', 'school', 'children', 'learning', 'teacher'],
      income: ['income', 'loss', 'unemployment', 'job', 'work', 'salary'],
      family: ['family', 'household', 'children', 'parent', 'care'],
      emergency: ['emergency', 'crisis', 'urgent', 'immediate', 'disaster'],
    };

    const lowerText = text.toLowerCase();
    const themes: string[] = [];

    for (const [theme, keywords] of Object.entries(themeKeywords)) {
      if (keywords.some(k => lowerText.includes(k))) {
        themes.push(theme);
      }
    }

    return themes.length > 0 ? themes : ['general'];
  }

  private detectSentiment(text: string): 'positive' | 'neutral' | 'negative' {
    const positiveWords = ['thank', 'grateful', 'success', 'improved', 'recovered', 'safe'];
    const negativeWords = ['need', 'require', 'urgent', 'critical', 'emergency', 'crisis', 'hunger', 'homeless'];

    const lowerText = text.toLowerCase();
    const positiveCount = positiveWords.filter(w => lowerText.includes(w)).length;
    const negativeCount = negativeWords.filter(w => lowerText.includes(w)).length;

    if (negativeCount > positiveCount) return 'negative';
    if (positiveCount > negativeCount) return 'positive';
    return 'neutral';
  }
}
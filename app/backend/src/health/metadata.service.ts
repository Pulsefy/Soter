import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface OnchainProviderMeta {
  adapter: string;
  network: string;
}

export interface AiProviderMeta {
  active: string;
  models: {
    openai: string;
    groq: string;
  };
}

export interface ProviderMeta {
  onchain: OnchainProviderMeta;
  ai: AiProviderMeta;
}

export interface CapabilityFlags {
  caching: boolean;
  rateLimiting: boolean;
  verification: boolean;
  onchainEscrow: boolean;
  deterministicMode: boolean;
  redisEnabled: boolean;
}

export interface ServiceMeta {
  service: string;
  version: string;
  environment: string;
  timestamp: string;
}

export interface MetadataResponse extends ServiceMeta {
  providers: ProviderMeta;
  capabilities: CapabilityFlags;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'secret',
  'authorization',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
  'seed',
  'secretkey',
  'secret_key',
  'adminsecretkey',
  'admin_secret_key',
]);

@Injectable()
export class MetadataService {
  constructor(private readonly configService: ConfigService) {}

  getMetadata(): MetadataResponse {
    return {
      service: 'soter-backend',
      version: process.env.npm_package_version ?? '0.0.0',
      environment: this.configService.get<string>('NODE_ENV') ?? 'development',
      timestamp: new Date().toISOString(),
      providers: this.getProviders(),
      capabilities: this.getCapabilities(),
    };
  }

  private getProviders(): ProviderMeta {
    return {
      onchain: this.getOnchainProvider(),
      ai: this.getAiProvider(),
    };
  }

  private getOnchainProvider(): OnchainProviderMeta {
    const adapter = this.safeGet('ONCHAIN_ADAPTER') ?? 'mock';
    const network = this.safeGet('SOROBAN_NETWORK') ?? 'testnet';

    return { adapter, network };
  }

  private getAiProvider(): AiProviderMeta {
    const testMode = this.safeGet('TEST_PROVIDER_MODE') === 'true';
    const hasOpenai = this.hasConfiguredKey('OPENAI_API_KEY');
    const hasGroq = this.hasConfiguredKey('GROQ_API_KEY');

    let active = 'none';
    if (testMode) {
      active = 'test';
    } else if (hasOpenai) {
      active = 'openai';
    } else if (hasGroq) {
      active = 'groq';
    }

    return {
      active,
      models: {
        openai: this.safeGet('OPENAI_MODEL') ?? 'gpt-4o-mini',
        groq: this.safeGet('GROQ_MODEL') ?? 'llama-3.3-70b-versatile',
      },
    };
  }

  private getCapabilities(): CapabilityFlags {
    return {
      caching: this.safeGet('CACHE_TTL_VERIFICATION_STATUS') !== null,
      rateLimiting: true,
      verification: this.safeGet('VERIFICATION_MODE') !== null,
      onchainEscrow: this.safeGet('AID_ESCROW_CONTRACT_ID') !== null,
      deterministicMode: this.safeGet('AI_DETERMINISTIC_MODE') === 'true',
      redisEnabled: this.safeGet('REDIS_HOST') !== null,
    };
  }

  private safeGet(key: string): string | null {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      return null;
    }
    return this.configService.get<string>(key) ?? null;
  }

  private hasConfiguredKey(key: string): boolean {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      return false;
    }
    const value = this.configService.get<string>(key);
    return !!value && value.trim().length > 0;
  }
}

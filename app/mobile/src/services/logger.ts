export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  scope?: string;
  correlationId?: string;
  data?: Record<string, unknown> | unknown[] | string | number | boolean | null;
}

export interface StructuredLoggerOptions {
  maxEntries?: number;
  maxBytes?: number;
  level?: LogLevel;
}

const DEFAULT_MAX_ENTRIES = 80;
const DEFAULT_MAX_BYTES = 128 * 1024;

const SENSITIVE_KEY_PATTERN = /(authorization|auth|bearer|token|secret|password|passphrase|api[_-]?key|apikey|email|phone|private[_-]?key|mnemonic|seed|jwt|cookie|session)/i;

const redactString = (input: string): string => {
  if (!input) return input;

  let result = input;
  const patterns = [
    /Bearer\s+[A-Za-z0-9._~+/=-]+\.[A-Za-z0-9._~+/=-]+\.[A-Za-z0-9._~+/=-]*/gi,
    /Authorization\s*[:=]\s*['"]?[A-Za-z0-9._~+/=-]+\.[A-Za-z0-9._~+/=-]+\.[A-Za-z0-9._~+/=-]*['"]?/gi,
    /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    /\b\+?\d[\d\s().-]{7,}\d\b/g,
    /\b(?:secret|token|password|passphrase|api[_-]?key|apikey|authorization|cookie|session)\s*[:=]\s*['"]?[^\s,;"']+/gi,
    /\b(?:S[A-Z0-9]{55})\b/g,
  ];

  for (const pattern of patterns) {
    result = result.replace(pattern, (match) => {
      if (match.toLowerCase().includes('bearer')) return 'Bearer [REDACTED]';
      if (match.toLowerCase().includes('authorization')) return 'Authorization: [REDACTED]';
      if (match.includes('@')) return '[REDACTED_EMAIL]';
      if (/\d/.test(match)) return '[REDACTED_PHONE]';
      if (match.includes('=') || match.includes(':')) {
        const label = match.split(/[:=]/)[0];
        return `${label}: [REDACTED]`;
      }
      return '[REDACTED]';
    });
  }

  return result;
};

const redactValue = <T>(value: T, seen = new WeakSet<object>()): T => {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return redactString(value) as T;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen)) as T;
  }

  if (typeof value === 'object') {
    if (seen.has(value as object)) return value;
    seen.add(value as object);

    if (value instanceof Date) {
      return value;
    }

    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactValue(entryValue, seen);
      }
    }

    return result as T;
  }

  return value;
};

const formatLogEntryForDisplay = (entry: StructuredLogEntry): string => {
  const base = `${entry.timestamp} ${entry.level.toUpperCase()} ${entry.message}`;
  if (!entry.data && !entry.correlationId && !entry.scope) return base;

  const parts: string[] = [];
  if (entry.scope) parts.push(`scope=${entry.scope}`);
  if (entry.correlationId) parts.push(`correlationId=${entry.correlationId}`);
  if (entry.data !== undefined) parts.push(`data=${JSON.stringify(entry.data)}`);

  return `${base} ${parts.join(' ')}`;
};

export class StructuredLogger {
  private static instance: StructuredLogger | null = null;

  private readonly entries: StructuredLogEntry[] = [];
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private currentLevel: LogLevel;
  private correlationId?: string;

  constructor(options: StructuredLoggerOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.currentLevel = options.level ?? (process.env.NODE_ENV === 'production' ? 'warn' : 'debug');
  }

  static getInstance(): StructuredLogger {
    if (!StructuredLogger.instance) {
      StructuredLogger.instance = new StructuredLogger();
    }
    return StructuredLogger.instance;
  }

  static resetForTests(): void {
    StructuredLogger.instance = null;
  }

  private shouldLog(level: LogLevel): boolean {
    const levelRank: Record<LogLevel, number> = {
      debug: 10,
      info: 20,
      warn: 30,
      error: 40,
    };

    return levelRank[level] >= levelRank[this.currentLevel];
  }

  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  setCorrelationId(id?: string): void {
    this.correlationId = id ?? this.correlationId ?? `mobile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  getCurrentCorrelationId(): string {
    if (!this.correlationId) {
      this.setCorrelationId();
    }
    return this.correlationId as string;
  }

  private appendEntry(entry: StructuredLogEntry): void {
    this.entries.push(entry);

    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    while (this.getSerializedSize() > this.maxBytes && this.entries.length > 1) {
      this.entries.shift();
    }
  }

  private getSerializedSize(): number {
    try {
      return new TextEncoder().encode(JSON.stringify(this.entries)).length;
    } catch {
      return this.entries.length * 1024;
    }
  }

  private emit(level: LogLevel, message: string, scope?: string, data?: unknown): void {
    if (!this.shouldLog(level)) return;

    const payload = redactValue(data);
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      scope,
      correlationId: this.correlationId ?? this.getCurrentCorrelationId(),
      data: payload,
    };

    this.appendEntry(entry);

    const logArgs = [message];
    if (scope) logArgs.push({ scope, correlationId: entry.correlationId });
    if (data !== undefined) logArgs.push(payload);

    switch (level) {
      case 'debug':
        console.debug(...logArgs);
        break;
      case 'info':
        console.info(...logArgs);
        break;
      case 'warn':
        console.warn(...logArgs);
        break;
      case 'error':
        console.error(...logArgs);
        break;
      default:
        console.log(...logArgs);
        break;
    }
  }

  debug(message: string, data?: unknown, scope?: string): void {
    this.emit('debug', message, scope ?? 'app', data);
  }

  info(message: string, data?: unknown, scope?: string): void {
    this.emit('info', message, scope ?? 'app', data);
  }

  warn(message: string, data?: unknown, scope?: string): void {
    this.emit('warn', message, scope ?? 'app', data);
  }

  error(message: string, data?: unknown, scope?: string): void {
    this.emit('error', message, scope ?? 'app', data);
  }

  getEntries(): StructuredLogEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  getRecentEntries(limit = 12): StructuredLogEntry[] {
    return this.entries.slice(-limit).map((entry) => ({ ...entry }));
  }

  getDiagnosticsText(limit = 12): string {
    const entries = this.getRecentEntries(limit);
    if (!entries.length) return 'No structured logs captured.';
    return entries.map((entry) => formatLogEntryForDisplay(entry)).join('\n');
  }

  getDiagnosticsPayload(limit = 12): Record<string, unknown> {
    return {
      count: this.entries.length,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
      correlationId: this.getCurrentCorrelationId(),
      recentEntries: this.getRecentEntries(limit),
    };
  }
}

export const createStructuredLogger = (options?: StructuredLoggerOptions): StructuredLogger =>
  new StructuredLogger(options);

export const structuredLogger: StructuredLogger = {
  setLevel: (level: LogLevel) => StructuredLogger.getInstance().setLevel(level),
  setCorrelationId: (id?: string) => StructuredLogger.getInstance().setCorrelationId(id),
  getCurrentCorrelationId: () => StructuredLogger.getInstance().getCurrentCorrelationId(),
  debug: (message: string, data?: unknown, scope?: string) =>
    StructuredLogger.getInstance().debug(message, data, scope),
  info: (message: string, data?: unknown, scope?: string) =>
    StructuredLogger.getInstance().info(message, data, scope),
  warn: (message: string, data?: unknown, scope?: string) =>
    StructuredLogger.getInstance().warn(message, data, scope),
  error: (message: string, data?: unknown, scope?: string) =>
    StructuredLogger.getInstance().error(message, data, scope),
  getEntries: () => StructuredLogger.getInstance().getEntries(),
  getRecentEntries: (limit?: number) => StructuredLogger.getInstance().getRecentEntries(limit),
  getDiagnosticsText: (limit?: number) => StructuredLogger.getInstance().getDiagnosticsText(limit),
  getDiagnosticsPayload: (limit?: number) => StructuredLogger.getInstance().getDiagnosticsPayload(limit),
} as StructuredLogger;

export const buildCorrelationHeaders = (correlationId?: string): Record<string, string> => {
  const activeId = correlationId ?? StructuredLogger.getInstance().getCurrentCorrelationId();
  return {
    'x-correlation-id': activeId,
    'x-request-id': activeId,
  };
};

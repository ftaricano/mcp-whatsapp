import { Boom } from '@hapi/boom';

export enum ErrorCategory {
  RATE_LIMIT = 'rate_limit',
  NETWORK = 'network',
  INVALID_REQUEST = 'invalid',
  UNAUTHORIZED = 'auth',
  NOT_FOUND = 'not_found',
  UNKNOWN = 'unknown',
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  shouldRetry: (error: unknown) => boolean;
}

export class RetryHandler {
  private readonly config: RetryConfig;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = {
      maxRetries: config.maxRetries ?? 3,
      baseDelay: config.baseDelay ?? 1000,
      maxDelay: config.maxDelay ?? 30000,
      backoffMultiplier: config.backoffMultiplier ?? 2,
      shouldRetry: config.shouldRetry ?? defaultShouldRetry,
    };
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err) {
        lastError = err;
        if (attempt === this.config.maxRetries || !this.config.shouldRetry(err)) break;
        const delay = this.calculateDelay(attempt, err);
        await sleep(delay);
      }
    }
    throw lastError;
  }

  private calculateDelay(attempt: number, err: unknown): number {
    const category = categorizeError(err);
    const multiplier = category === ErrorCategory.RATE_LIMIT ? 2 : 1;
    const base = this.config.baseDelay * Math.pow(this.config.backoffMultiplier, attempt);
    const capped = Math.min(base * multiplier, this.config.maxDelay);
    return capped + Math.random() * 500;
  }
}

export function categorizeError(err: unknown): ErrorCategory {
  const boom = err as Boom | undefined;
  const status = boom?.output?.statusCode;

  if (status === 429) return ErrorCategory.RATE_LIMIT;
  if (status === 401 || status === 403) return ErrorCategory.UNAUTHORIZED;
  if (status === 404) return ErrorCategory.NOT_FOUND;
  if (typeof status === 'number' && status >= 400 && status < 500) return ErrorCategory.INVALID_REQUEST;

  const msg = (err as Error | undefined)?.message?.toLowerCase() ?? '';
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNABORTED' || code === 'ENOTFOUND') {
    return ErrorCategory.NETWORK;
  }
  if (msg.includes('timed out') || msg.includes('connection closed') || msg.includes('stream errored')) {
    return ErrorCategory.NETWORK;
  }
  return ErrorCategory.UNKNOWN;
}

function defaultShouldRetry(err: unknown): boolean {
  const category = categorizeError(err);
  if (category === ErrorCategory.INVALID_REQUEST) return false;
  if (category === ErrorCategory.UNAUTHORIZED) return false;
  if (category === ErrorCategory.NOT_FOUND) return false;
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

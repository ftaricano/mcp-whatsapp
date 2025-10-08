export enum ErrorCategory {
  RATE_LIMIT = "rate_limit",
  NETWORK = "network", 
  INVALID_REQUEST = "invalid",
  UNAUTHORIZED = "auth",
  MEDIA_ERROR = "media",
  QUOTA_EXCEEDED = "quota",
  UNKNOWN = "unknown"
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  shouldRetry: (error: any) => boolean;
}

export class RetryHandler {
  private readonly config: RetryConfig;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = {
      maxRetries: config.maxRetries || 3,
      baseDelay: config.baseDelay || 1000,
      maxDelay: config.maxDelay || 30000,
      backoffMultiplier: config.backoffMultiplier || 2,
      shouldRetry: config.shouldRetry || this.defaultShouldRetry
    };
  }

  public async execute<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (attempt === this.config.maxRetries || !this.config.shouldRetry(error as any)) {
          break;
        }

        const delay = this.calculateDelay(attempt, error as any);
        console.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, (error as any)?.message);
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private calculateDelay(attempt: number, error: any): number {
    const category = this.categorizeError(error);
    
    // Rate limit errors should use longer delays
    const multiplier = category === ErrorCategory.RATE_LIMIT ? 2 : 1;
    
    const exponentialDelay = this.config.baseDelay * Math.pow(this.config.backoffMultiplier, attempt);
    const delay = Math.min(exponentialDelay * multiplier, this.config.maxDelay);
    
    // Add jitter to prevent thundering herd
    return delay + Math.random() * 1000;
  }

  private categorizeError(error: any): ErrorCategory {
    if (error.response?.status === 429) return ErrorCategory.RATE_LIMIT;
    if (error.response?.status === 401) return ErrorCategory.UNAUTHORIZED;
    if (error.response?.status >= 400 && error.response?.status < 500) return ErrorCategory.INVALID_REQUEST;
    if (error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND') return ErrorCategory.NETWORK;
    if (error.message?.includes('media')) return ErrorCategory.MEDIA_ERROR;
    if (error.response?.status === 429) return ErrorCategory.QUOTA_EXCEEDED;
    
    return ErrorCategory.UNKNOWN;
  }

  private defaultShouldRetry(error: unknown): boolean {
    const category = this.categorizeError(error as any);
    
    // Don't retry client errors (4xx except 429)
    if (category === ErrorCategory.INVALID_REQUEST) return false;
    if (category === ErrorCategory.UNAUTHORIZED) return false;
    
    // Retry these categories
    return [
      ErrorCategory.RATE_LIMIT,
      ErrorCategory.NETWORK,
      ErrorCategory.MEDIA_ERROR,
      ErrorCategory.QUOTA_EXCEEDED,
      ErrorCategory.UNKNOWN
    ].includes(category);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
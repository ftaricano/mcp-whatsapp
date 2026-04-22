export enum CircuitBreakerState {
  CLOSED = 'closed',
  OPEN = 'open', 
  HALF_OPEN = 'half-open'
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
}

export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failures = 0;
  private nextAttempt = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly monitoringPeriod: number;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 30000; // 30 seconds
    this.monitoringPeriod = options.monitoringPeriod || 60000; // 1 minute
  }

  public async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitBreakerState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitBreakerState.HALF_OPEN;
      } else {
        throw new Error(`Circuit breaker is OPEN. Next attempt at ${new Date(this.nextAttempt).toISOString()}`);
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private shouldAttemptReset(): boolean {
    return Date.now() >= this.nextAttempt;
  }

  private onSuccess(): void {
    this.reset();
  }

  private onFailure(): void {
    this.failures++;
    
    if (this.failures >= this.failureThreshold) {
      this.trip();
    }
  }

  private trip(): void {
    this.state = CircuitBreakerState.OPEN;
    this.nextAttempt = Date.now() + this.resetTimeout;
    emitOpsLog('warn', `Circuit breaker TRIPPED. Will attempt reset at ${new Date(this.nextAttempt).toISOString()}`);
  }

  private reset(): void {
    this.failures = 0;
    this.state = CircuitBreakerState.CLOSED;
    this.nextAttempt = 0;
    emitOpsLog('info', 'Circuit breaker RESET - normal operation resumed');
  }

  public getState(): CircuitBreakerState {
    return this.state;
  }

  public getMetrics(): {
    state: CircuitBreakerState;
    failures: number;
    failureThreshold: number;
    nextAttempt: number;
    isHealthy: boolean;
  } {
    return {
      state: this.state,
      failures: this.failures,
      failureThreshold: this.failureThreshold,
      nextAttempt: this.nextAttempt,
      isHealthy: this.state === CircuitBreakerState.CLOSED
    };
  }

  public forceOpen(): void {
    this.state = CircuitBreakerState.OPEN;
    this.nextAttempt = Date.now() + this.resetTimeout;
    emitOpsLog('warn', 'Circuit breaker manually set to OPEN');
  }

  public forceClose(): void {
    this.reset();
    emitOpsLog('info', 'Circuit breaker manually reset to CLOSED');
  }
}

// Ops-level logs always go to stderr (never stdout, so JSON output stays clean)
// and are fully suppressed when the log level is `silent` (respecting --quiet).
function emitOpsLog(level: 'info' | 'warn', msg: string): void {
  if (process.env.WHATSAPP_LOG_LEVEL === 'silent') return;
  const prefix = level === 'warn' ? '[circuit-breaker][warn]' : '[circuit-breaker]';
  process.stderr.write(`${prefix} ${msg}\n`);
}
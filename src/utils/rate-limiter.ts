/**
 * Token-bucket rate limiter with a FIFO waiter queue.
 *
 * Why not recurse on `setTimeout`? The previous implementation did
 * `await this.sleep(waitTime); return this.wait();` which has two problems:
 *  1. N concurrent callers all wake simultaneously and race for the next
 *     token — order is not preserved and starvation is possible under load.
 *  2. Each recursion is a microtask + timer, not a stack frame, so it doesn't
 *     blow the stack — but the lack of fairness is still a real correctness
 *     issue for burst-then-drain scenarios.
 *
 * This version queues waiters and drains them in order whenever tokens are
 * available. A single `setTimeout` keeps the pump alive while the queue is
 * non-empty.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per millisecond
  private readonly waiters: Array<() => void> = [];
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(requestsPerSecond: number, burstCapacity?: number) {
    if (requestsPerSecond <= 0) {
      throw new Error('requestsPerSecond must be > 0');
    }
    this.capacity = burstCapacity && burstCapacity > 0 ? burstCapacity : requestsPerSecond;
    this.refillRate = requestsPerSecond / 1000;
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }

  wait(): Promise<void> {
    this.refill();
    if (this.waiters.length === 0 && this.tokens >= 1) {
      this.tokens--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      this.ensurePump();
    });
  }

  canProcess(): boolean {
    this.refill();
    return this.tokens >= 1 && this.waiters.length === 0;
  }

  getStatus(): { tokens: number; capacity: number; waitTime: number; queued: number } {
    this.refill();
    const waitTime = this.tokens >= 1
      ? 0
      : Math.ceil((1 - this.tokens) / this.refillRate);
    return {
      tokens: this.tokens,
      capacity: this.capacity,
      waitTime,
      queued: this.waiters.length,
    };
  }

  /**
   * Release any pumps so the process can exit cleanly.
   */
  dispose(): void {
    if (this.pumpTimer) {
      clearTimeout(this.pumpTimer);
      this.pumpTimer = null;
    }
    // Don't reject outstanding waiters — just drain them. Callers awaiting
    // `wait()` during shutdown will see the pending promise GC'd with the
    // parent scope; if that becomes a real issue we'll switch to rejection.
    this.waiters.length = 0;
  }

  private ensurePump(): void {
    if (this.pumpTimer) return;
    const delayMs = this.tokens >= 1 ? 0 : Math.ceil((1 - this.tokens) / this.refillRate);
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = null;
      this.drain();
    }, delayMs);
    // Don't keep the event loop alive just to pump an idle rate limiter.
    this.pumpTimer.unref?.();
  }

  private drain(): void {
    this.refill();
    while (this.waiters.length > 0 && this.tokens >= 1) {
      const next = this.waiters.shift();
      if (!next) break;
      this.tokens--;
      next();
    }
    if (this.waiters.length > 0) this.ensurePump();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

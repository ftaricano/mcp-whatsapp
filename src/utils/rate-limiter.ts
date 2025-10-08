export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per millisecond

  constructor(requestsPerSecond: number, burstCapacity?: number) {
    this.capacity = burstCapacity || requestsPerSecond;
    this.refillRate = requestsPerSecond / 1000; // Convert to per millisecond
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }

  public async wait(): Promise<void> {
    this.refill();
    
    if (this.tokens >= 1) {
      this.tokens--;
      return;
    }

    // Calculate wait time for next token
    const waitTime = Math.ceil((1 - this.tokens) / this.refillRate);
    await this.sleep(waitTime);
    return this.wait();
  }

  public canProcess(): boolean {
    this.refill();
    return this.tokens >= 1;
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const tokensToAdd = timePassed * this.refillRate;
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public getStatus(): { tokens: number; capacity: number; waitTime: number } {
    this.refill();
    const waitTime = this.tokens >= 1 ? 0 : Math.ceil((1 - this.tokens) / this.refillRate);
    
    return {
      tokens: this.tokens,
      capacity: this.capacity,
      waitTime
    };
  }
}
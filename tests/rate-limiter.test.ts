import { describe, expect, it, afterEach } from 'vitest';
import { RateLimiter } from '../src/utils/rate-limiter.js';

describe('RateLimiter', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });

  it('allows up to capacity immediately without queueing', async () => {
    const rl = new RateLimiter(2, 3);
    cleanups.push(() => rl.dispose());
    await rl.wait();
    await rl.wait();
    await rl.wait();
    expect(rl.getStatus().tokens).toBeLessThan(1);
  });

  it('rejects invalid rate', () => {
    expect(() => new RateLimiter(0)).toThrow();
    expect(() => new RateLimiter(-1)).toThrow();
  });

  it('queues callers in FIFO order after capacity is exhausted', async () => {
    const rl = new RateLimiter(100, 1); // 10ms per token, 1 token burst
    cleanups.push(() => rl.dispose());
    await rl.wait(); // drains the single burst token

    const order: number[] = [];
    const p1 = rl.wait().then(() => order.push(1));
    const p2 = rl.wait().then(() => order.push(2));
    const p3 = rl.wait().then(() => order.push(3));
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('refills tokens based on elapsed time', async () => {
    const rl = new RateLimiter(1000, 1); // 1 token per ms, burst 1
    cleanups.push(() => rl.dispose());
    await rl.wait();
    // Next token should be ready within a few ms.
    const start = Date.now();
    await rl.wait();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('dispose cancels pending pump timer and empties waiters', async () => {
    const rl = new RateLimiter(1, 1);
    await rl.wait(); // drain
    // These waiters would otherwise hold the pump alive.
    rl.wait();
    rl.wait();
    expect(rl.getStatus().queued).toBe(2);
    rl.dispose();
    expect(rl.getStatus().queued).toBe(0);
  });

  it('canProcess false while queue is non-empty', async () => {
    const rl = new RateLimiter(10, 1);
    cleanups.push(() => rl.dispose());
    await rl.wait();
    rl.wait(); // queued
    expect(rl.canProcess()).toBe(false);
  });
});

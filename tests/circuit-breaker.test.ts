import { describe, expect, it, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitBreakerState } from '../src/utils/circuit-breaker.js';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    process.env.WHATSAPP_LOG_LEVEL = 'silent';
  });

  it('starts CLOSED', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 100 });
    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
    expect(cb.getMetrics().isHealthy).toBe(true);
  });

  it('trips to OPEN after failureThreshold', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 100 });
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(async () => { throw new Error('x'); })).rejects.toThrow('x');
    }
    expect(cb.getState()).toBe(CircuitBreakerState.OPEN);
  });

  it('rejects immediately while OPEN before resetTimeout', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 10_000 });
    await expect(cb.execute(async () => { throw new Error('x'); })).rejects.toThrow('x');
    await expect(cb.execute(async () => 'should-not-run')).rejects.toThrow(/Circuit breaker is OPEN/);
  });

  it('transitions OPEN → HALF_OPEN after resetTimeout and closes on success', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 20 });
    await expect(cb.execute(async () => { throw new Error('x'); })).rejects.toThrow();
    expect(cb.getState()).toBe(CircuitBreakerState.OPEN);
    await new Promise((r) => setTimeout(r, 25));
    const res = await cb.execute(async () => 'ok');
    expect(res).toBe('ok');
    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
    expect(cb.getMetrics().failures).toBe(0);
  });

  it('a single success resets the failure counter', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 5, resetTimeout: 100 });
    await expect(cb.execute(async () => { throw new Error('x'); })).rejects.toThrow();
    await expect(cb.execute(async () => { throw new Error('x'); })).rejects.toThrow();
    expect(cb.getMetrics().failures).toBe(2);
    await cb.execute(async () => 'ok');
    expect(cb.getMetrics().failures).toBe(0);
  });

  it('forceOpen/forceClose manipulate state directly', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 100 });
    cb.forceOpen();
    expect(cb.getState()).toBe(CircuitBreakerState.OPEN);
    cb.forceClose();
    expect(cb.getState()).toBe(CircuitBreakerState.CLOSED);
  });
});

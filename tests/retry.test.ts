import { describe, expect, it } from 'vitest';
import { Boom } from '@hapi/boom';
import { RetryHandler, categorizeError, ErrorCategory } from '../src/utils/retry.js';

describe('categorizeError', () => {
  it('maps HTTP 429 → RATE_LIMIT', () => {
    const err = new Boom('rate', { statusCode: 429 });
    expect(categorizeError(err)).toBe(ErrorCategory.RATE_LIMIT);
  });

  it('maps HTTP 401/403 → UNAUTHORIZED', () => {
    expect(categorizeError(new Boom('x', { statusCode: 401 }))).toBe(ErrorCategory.UNAUTHORIZED);
    expect(categorizeError(new Boom('x', { statusCode: 403 }))).toBe(ErrorCategory.UNAUTHORIZED);
  });

  it('maps HTTP 404 → NOT_FOUND', () => {
    expect(categorizeError(new Boom('x', { statusCode: 404 }))).toBe(ErrorCategory.NOT_FOUND);
  });

  it('maps other 4xx → INVALID_REQUEST', () => {
    expect(categorizeError(new Boom('x', { statusCode: 400 }))).toBe(ErrorCategory.INVALID_REQUEST);
    expect(categorizeError(new Boom('x', { statusCode: 422 }))).toBe(ErrorCategory.INVALID_REQUEST);
  });

  it('maps ECONNRESET/ETIMEDOUT/ENOTFOUND → NETWORK', () => {
    const mk = (code: string) => Object.assign(new Error('x'), { code });
    expect(categorizeError(mk('ECONNRESET'))).toBe(ErrorCategory.NETWORK);
    expect(categorizeError(mk('ETIMEDOUT'))).toBe(ErrorCategory.NETWORK);
    expect(categorizeError(mk('ENOTFOUND'))).toBe(ErrorCategory.NETWORK);
  });

  it('maps network-flavored messages → NETWORK', () => {
    expect(categorizeError(new Error('Request timed out'))).toBe(ErrorCategory.NETWORK);
    expect(categorizeError(new Error('connection closed'))).toBe(ErrorCategory.NETWORK);
    expect(categorizeError(new Error('stream errored out'))).toBe(ErrorCategory.NETWORK);
  });

  it('defaults to UNKNOWN', () => {
    expect(categorizeError(new Error('whatever'))).toBe(ErrorCategory.UNKNOWN);
    expect(categorizeError(undefined)).toBe(ErrorCategory.UNKNOWN);
  });
});

describe('RetryHandler', () => {
  it('returns first success without retry', async () => {
    let calls = 0;
    const r = new RetryHandler({ maxRetries: 3, baseDelay: 1 });
    const res = await r.execute(async () => {
      calls++;
      return 'ok';
    });
    expect(res).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries on retryable errors then succeeds', async () => {
    let calls = 0;
    const r = new RetryHandler({ maxRetries: 3, baseDelay: 1, maxDelay: 5 });
    const res = await r.execute(async () => {
      calls++;
      if (calls < 3) {
        const e: NodeJS.ErrnoException = Object.assign(new Error('flaky'), { code: 'ECONNRESET' });
        throw e;
      }
      return 'ok';
    });
    expect(res).toBe('ok');
    expect(calls).toBe(3);
  });

  it('does NOT retry on INVALID_REQUEST/UNAUTHORIZED/NOT_FOUND', async () => {
    let calls = 0;
    const r = new RetryHandler({ maxRetries: 5, baseDelay: 1, maxDelay: 5 });
    await expect(
      r.execute(async () => {
        calls++;
        throw new Boom('nope', { statusCode: 400 });
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('gives up after maxRetries+1 attempts', async () => {
    let calls = 0;
    const r = new RetryHandler({ maxRetries: 2, baseDelay: 1, maxDelay: 5 });
    await expect(
      r.execute(async () => {
        calls++;
        const e: NodeJS.ErrnoException = Object.assign(new Error('x'), { code: 'ETIMEDOUT' });
        throw e;
      }),
    ).rejects.toThrow();
    expect(calls).toBe(3); // 1 + 2 retries
  });

  it('respects custom shouldRetry', async () => {
    let calls = 0;
    const r = new RetryHandler({
      maxRetries: 3,
      baseDelay: 1,
      shouldRetry: () => false,
    });
    await expect(
      r.execute(async () => {
        calls++;
        throw new Error('retryable-ish');
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

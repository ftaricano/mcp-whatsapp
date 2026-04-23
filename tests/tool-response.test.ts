import { describe, expect, it } from 'vitest';
import { fail, failValidation } from '../src/utils/tool-response.js';

describe('tool-response', () => {
  it('fail() wraps errors with canonical envelope', () => {
    const r = fail('media_error', new Error('boom'), { message_id: 'abc' });
    expect(r.success).toBe(false);
    expect(r.error).toEqual({ type: 'media_error', message: 'boom' });
    expect(r.message_id).toBe('abc');
    expect(typeof r.timestamp).toBe('string');
  });

  it('fail() stringifies non-Error throwables', () => {
    const r = fail('x', 'raw string');
    expect(r.error.message).toBe('raw string');
  });

  it('failValidation() sets type=validation_error', () => {
    const r = failValidation(new Error('bad'));
    expect(r.error.type).toBe('validation_error');
    expect(r.error.message).toBe('bad');
  });
});

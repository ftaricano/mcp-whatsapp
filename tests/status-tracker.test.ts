import { describe, expect, it } from 'vitest';
import { StatusTracker, mapProtoStatus } from '../src/services/status-tracker.js';

describe('mapProtoStatus', () => {
  it('maps proto codes to semantic strings', () => {
    expect(mapProtoStatus(0)).toBe('error');
    expect(mapProtoStatus(1)).toBe('pending');
    expect(mapProtoStatus(2)).toBe('server_ack');
    expect(mapProtoStatus(3)).toBe('delivered');
    expect(mapProtoStatus(4)).toBe('read');
    expect(mapProtoStatus(5)).toBe('played');
  });

  it('returns null for unknown/nullish', () => {
    expect(mapProtoStatus(null)).toBeNull();
    expect(mapProtoStatus(undefined)).toBeNull();
    expect(mapProtoStatus(99)).toBeNull();
  });
});

describe('StatusTracker', () => {
  it('records pending on insert', () => {
    const t = new StatusTracker(100);
    const e = t.record('m1', '5521@s.whatsapp.net');
    expect(e.status).toBe('pending');
    expect(t.get('m1')?.status).toBe('pending');
  });

  it('update() only touches existing entries', () => {
    const t = new StatusTracker(100);
    t.update('ghost', 'delivered');
    expect(t.get('ghost')).toBeUndefined();
    t.record('m1', 'x');
    t.update('m1', 'delivered');
    expect(t.get('m1')?.status).toBe('delivered');
  });

  it('pendingCount counts pending + server_ack', () => {
    const t = new StatusTracker(100);
    t.record('a', 'x');
    t.record('b', 'x');
    t.record('c', 'x');
    t.update('b', 'server_ack');
    t.update('c', 'delivered');
    expect(t.pendingCount()).toBe(2);
  });

  it('evicts oldest entries past maxEntries', () => {
    const t = new StatusTracker(3);
    t.record('a', 'x');
    t.record('b', 'x');
    t.record('c', 'x');
    t.record('d', 'x');
    expect(t.get('a')).toBeUndefined();
    expect(t.get('d')?.status).toBe('pending');
    expect(t.all()).toHaveLength(3);
  });

  it('applyUpdates maps proto codes onto tracked ids', () => {
    const t = new StatusTracker(100);
    t.record('m1', 'x');
    t.applyUpdates([{ key: { id: 'm1' } as unknown as never, update: { status: 3 as never } }]);
    expect(t.get('m1')?.status).toBe('delivered');
  });

  it('clear() empties tracker', () => {
    const t = new StatusTracker(100);
    t.record('a', 'x');
    t.clear();
    expect(t.all()).toEqual([]);
  });
});

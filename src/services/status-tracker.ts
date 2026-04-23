import { proto, WAMessageKey } from '@whiskeysockets/baileys';

export type MessageStatus =
  | 'pending'
  | 'server_ack'
  | 'delivered'
  | 'read'
  | 'played'
  | 'error';

export interface StatusEntry {
  status: MessageStatus;
  updatedAt: string;
  to_jid: string;
}

/**
 * Tracks delivery status for messages sent in this session.
 * Bounded by `maxEntries` (FIFO eviction) to prevent unbounded growth
 * in long-lived processes.
 */
export class StatusTracker {
  private readonly map = new Map<string, StatusEntry>();
  private readonly order: string[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 10_000) {
    this.maxEntries = maxEntries;
  }

  record(messageId: string, to_jid: string): StatusEntry {
    const entry: StatusEntry = {
      status: 'pending',
      updatedAt: new Date().toISOString(),
      to_jid,
    };
    if (!this.map.has(messageId)) this.order.push(messageId);
    this.map.set(messageId, entry);
    while (this.order.length > this.maxEntries) {
      const evicted = this.order.shift();
      if (evicted) this.map.delete(evicted);
    }
    return entry;
  }

  update(messageId: string, status: MessageStatus): void {
    const existing = this.map.get(messageId);
    if (!existing) return;
    this.map.set(messageId, { ...existing, status, updatedAt: new Date().toISOString() });
  }

  get(messageId: string): StatusEntry | undefined {
    return this.map.get(messageId);
  }

  all(): Array<{ message_id: string } & StatusEntry> {
    return [...this.map.entries()].map(([id, e]) => ({ message_id: id, ...e }));
  }

  pendingCount(): number {
    let n = 0;
    for (const s of this.map.values()) {
      if (s.status === 'pending' || s.status === 'server_ack') n++;
    }
    return n;
  }

  clear(): void {
    this.map.clear();
    this.order.length = 0;
  }

  applyUpdates(
    updates: Array<{ key: WAMessageKey; update: Partial<proto.IWebMessageInfo> }>,
  ): void {
    for (const { key, update } of updates) {
      const id = key.id;
      if (!id || !this.map.has(id)) continue;
      const mapped = mapProtoStatus(update.status);
      if (mapped) this.update(id, mapped);
    }
  }
}

export function mapProtoStatus(
  status: proto.WebMessageInfo.Status | number | null | undefined,
): MessageStatus | null {
  if (status === null || status === undefined) return null;
  // 0 ERROR, 1 PENDING, 2 SERVER_ACK, 3 DELIVERY_ACK, 4 READ, 5 PLAYED
  switch (status) {
    case 0: return 'error';
    case 1: return 'pending';
    case 2: return 'server_ack';
    case 3: return 'delivered';
    case 4: return 'read';
    case 5: return 'played';
    default: return null;
  }
}

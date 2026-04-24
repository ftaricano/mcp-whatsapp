import { describe, expect, it } from 'vitest';
import { InboxStore, type InboxMessage } from '../src/services/inbox-store.js';

function mk(over: Partial<InboxMessage> = {}): InboxMessage {
  return {
    id: Math.random().toString(36).slice(2),
    chat_jid: '5521@s.whatsapp.net',
    from_jid: '5521@s.whatsapp.net',
    from_me: false,
    timestamp: new Date().toISOString(),
    type: 'text',
    text: 'hi',
    pushName: null,
    media_filename: null,
    ...over,
  };
}

describe('InboxStore', () => {
  it('appends messages and tracks overview', () => {
    const s = new InboxStore(10, 100);
    s.append(mk({ id: 'a', timestamp: '2026-01-01T00:00:00Z' }));
    s.append(mk({ id: 'b', timestamp: '2026-01-01T00:01:00Z' }));
    const ov = s.overview();
    expect(ov.total_messages).toBe(2);
    expect(ov.chats).toBe(1);
    expect(ov.total_unread).toBe(2);
  });

  it('from_me messages do not increment unread', () => {
    const s = new InboxStore(10, 100);
    s.append(mk({ from_me: true }));
    expect(s.overview().total_unread).toBe(0);
  });

  it('enforces per-chat limit keeping the N most recent messages in order', () => {
    const s = new InboxStore(3, 100);
    for (let i = 0; i < 5; i++) {
      s.append(mk({ id: String(i), timestamp: new Date(2026, 0, 1, 0, i).toISOString() }));
    }
    const msgs = s.getMessages('5521@s.whatsapp.net', 10);
    // After 5 inserts with cap 3, we must see ids 2/3/4 in order — every
    // newly appended message MUST remain in the live window.
    expect(msgs.map((m) => m.id)).toEqual(['2', '3', '4']);
  });

  it('listChats reports the newest message after eviction', () => {
    const s = new InboxStore(2, 100);
    s.append(mk({ id: 'old', timestamp: '2026-01-01T00:00:00Z' }));
    s.append(mk({ id: 'mid', timestamp: '2026-01-01T00:01:00Z' }));
    s.append(mk({ id: 'new', timestamp: '2026-01-01T00:02:00Z' }));
    const preview = s.listChats(10)[0].last_timestamp;
    expect(preview).toBe('2026-01-01T00:02:00Z');
  });

  it('enforces global cap by evicting oldest timestamp across chats', () => {
    const s = new InboxStore(100, 3);
    s.append(mk({ chat_jid: 'c1@g.us', id: '1', timestamp: '2026-01-01T00:00:00Z' }));
    s.append(mk({ chat_jid: 'c2@g.us', id: '2', timestamp: '2026-01-01T00:01:00Z' }));
    s.append(mk({ chat_jid: 'c1@g.us', id: '3', timestamp: '2026-01-01T00:02:00Z' }));
    s.append(mk({ chat_jid: 'c2@g.us', id: '4', timestamp: '2026-01-01T00:03:00Z' }));
    expect(s.overview().total_messages).toBe(3);
    // The '1' message (oldest in c1) should have been evicted.
    const c1 = s.getMessages('c1@g.us', 10).map((m) => m.id);
    expect(c1).not.toContain('1');
  });

  it('listChats orders by last_timestamp desc and slices by limit', () => {
    const s = new InboxStore(10, 100);
    s.append(mk({ chat_jid: 'a@s.whatsapp.net', timestamp: '2026-01-01T00:00:00Z' }));
    s.append(mk({ chat_jid: 'b@s.whatsapp.net', timestamp: '2026-01-02T00:00:00Z' }));
    s.append(mk({ chat_jid: 'c@s.whatsapp.net', timestamp: '2026-01-03T00:00:00Z' }));
    const chats = s.listChats(2);
    expect(chats.map((c) => c.chat_jid)).toEqual(['c@s.whatsapp.net', 'b@s.whatsapp.net']);
  });

  it('markRead clears unread for a chat', () => {
    const s = new InboxStore(10, 100);
    s.append(mk());
    s.append(mk());
    s.markRead('5521@s.whatsapp.net');
    expect(s.overview().total_unread).toBe(0);
  });

  it('clear() resets everything', () => {
    const s = new InboxStore(10, 100);
    s.append(mk());
    s.append(mk());
    s.clear();
    expect(s.overview()).toEqual({ total_messages: 0, chats: 0, total_unread: 0 });
  });

  it('previews media types when text is null', () => {
    const s = new InboxStore(10, 100);
    s.append(mk({ type: 'image', text: null }));
    const chats = s.listChats(10);
    expect(chats[0].last_message_preview).toBe('[image]');
  });

  it('truncates long text previews', () => {
    const s = new InboxStore(10, 100);
    s.append(mk({ text: 'x'.repeat(200) }));
    const p = s.listChats(10)[0].last_message_preview!;
    expect(p.length).toBe(120);
    expect(p.endsWith('...')).toBe(true);
  });
});

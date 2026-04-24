import { proto, WAMessageKey } from '@whiskeysockets/baileys';

export type InboxMessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'other';

export interface InboxMessage {
  id: string;
  chat_jid: string;
  from_jid: string;
  from_me: boolean;
  timestamp: string;
  type: InboxMessageType;
  text: string | null;
  pushName: string | null;
  media_filename: string | null;
}

export interface ChatSummary {
  chat_jid: string;
  last_timestamp: string;
  last_message_preview: string | null;
  last_from_me: boolean;
  unread_count: number;
  message_count: number;
}

/**
 * In-memory inbox buffer.
 *
 * Storage uses a bounded ring buffer per chat (head/tail indices) instead of
 * `Array.shift()` — shift is O(n). For the global cap we track the oldest
 * timestamp across chats via a min-heap-lite: we only recompute on eviction,
 * which happens at most once per insert once the cap is reached.
 */
export class InboxStore {
  private readonly perChatLimit: number;
  private readonly totalLimit: number;
  private readonly chats = new Map<string, InboxMessage[]>();
  private readonly heads = new Map<string, number>();
  private readonly unread = new Map<string, number>();
  private total = 0;

  constructor(perChatLimit = 100, totalLimit = 1000) {
    this.perChatLimit = perChatLimit;
    this.totalLimit = totalLimit;
  }

  append(msg: InboxMessage): void {
    const existing = this.chats.get(msg.chat_jid);
    if (!existing) {
      this.chats.set(msg.chat_jid, [msg]);
      this.heads.set(msg.chat_jid, 0);
    } else {
      existing.push(msg);
      const head = this.heads.get(msg.chat_jid) ?? 0;
      if (existing.length - head > this.perChatLimit) {
        // Evict the oldest by advancing head; the new message stays in the
        // live window (everything after head). Compaction happens lazily
        // to keep the underlying array bounded.
        this.heads.set(msg.chat_jid, head + 1);
        this.total--; // the evicted one no longer counts
        if (head + 1 > this.perChatLimit * 2) {
          const live = existing.slice(head + 1);
          this.chats.set(msg.chat_jid, live);
          this.heads.set(msg.chat_jid, 0);
        }
      }
    }
    this.total++;

    if (!msg.from_me) {
      this.unread.set(msg.chat_jid, (this.unread.get(msg.chat_jid) ?? 0) + 1);
    }

    this.enforceGlobalCap();
  }

  private enforceGlobalCap(): void {
    while (this.total > this.totalLimit) {
      let oldestChat: string | null = null;
      let oldestTs = Infinity;
      for (const [chat, list] of this.chats) {
        const head = this.heads.get(chat) ?? 0;
        if (head >= list.length) continue;
        const ts = Date.parse(list[head].timestamp);
        if (ts < oldestTs) {
          oldestTs = ts;
          oldestChat = chat;
        }
      }
      if (!oldestChat) break;
      this.dropOldest(oldestChat);
    }
  }

  private dropOldest(chat: string): void {
    const list = this.chats.get(chat);
    if (!list) return;
    const head = this.heads.get(chat) ?? 0;
    if (head >= list.length) return;
    this.heads.set(chat, head + 1);
    this.total--;
    // Compact occasionally to keep the underlying array bounded.
    if (head + 1 > this.perChatLimit * 2) {
      const live = list.slice(head + 1);
      this.chats.set(chat, live);
      this.heads.set(chat, 0);
      if (live.length === 0) {
        this.chats.delete(chat);
        this.heads.delete(chat);
        this.unread.delete(chat);
      }
    } else if (head + 1 >= list.length) {
      // chat emptied
      this.chats.delete(chat);
      this.heads.delete(chat);
      this.unread.delete(chat);
    }
  }

  listChats(limit: number): ChatSummary[] {
    const out: ChatSummary[] = [];
    for (const [chat_jid, list] of this.chats) {
      const head = this.heads.get(chat_jid) ?? 0;
      if (head >= list.length) continue;
      const last = list[list.length - 1];
      out.push({
        chat_jid,
        last_timestamp: last.timestamp,
        last_message_preview: previewText(last),
        last_from_me: last.from_me,
        unread_count: this.unread.get(chat_jid) ?? 0,
        message_count: list.length - head,
      });
    }
    out.sort((a, b) => b.last_timestamp.localeCompare(a.last_timestamp));
    return out.slice(0, limit);
  }

  getMessages(chat_jid: string, limit: number): InboxMessage[] {
    const list = this.chats.get(chat_jid);
    if (!list) return [];
    const head = this.heads.get(chat_jid) ?? 0;
    const live = list.slice(head);
    return live.slice(-limit);
  }

  markRead(chat_jid: string): void {
    this.unread.delete(chat_jid);
  }

  overview(): { total_messages: number; chats: number; total_unread: number } {
    let unread = 0;
    for (const n of this.unread.values()) unread += n;
    return { total_messages: this.total, chats: this.chats.size, total_unread: unread };
  }

  clear(): void {
    this.chats.clear();
    this.heads.clear();
    this.unread.clear();
    this.total = 0;
  }
}

export function normalizeInboxMessage(m: proto.IWebMessageInfo): InboxMessage | null {
  const id = m.key?.id;
  const chat_jid = m.key?.remoteJid;
  if (!id || !chat_jid) return null;

  const from_me = !!m.key?.fromMe;
  const from_jid = from_me
    ? (m.key?.remoteJid ?? '')
    : (m.key?.participant ?? m.key?.remoteJid ?? '');

  const tsRaw = m.messageTimestamp;
  const tsNum = typeof tsRaw === 'number'
    ? tsRaw
    : tsRaw && typeof (tsRaw as { toNumber?: () => number }).toNumber === 'function'
      ? (tsRaw as { toNumber: () => number }).toNumber()
      : Math.floor(Date.now() / 1000);
  const timestamp = new Date(tsNum * 1000).toISOString();

  const msg = m.message;
  let type: InboxMessageType = 'other';
  let text: string | null = null;
  let media_filename: string | null = null;

  if (msg?.conversation) {
    type = 'text';
    text = msg.conversation;
  } else if (msg?.extendedTextMessage?.text) {
    type = 'text';
    text = msg.extendedTextMessage.text;
  } else if (msg?.imageMessage) {
    type = 'image';
    text = msg.imageMessage.caption ?? null;
  } else if (msg?.videoMessage) {
    type = 'video';
    text = msg.videoMessage.caption ?? null;
  } else if (msg?.audioMessage) {
    type = 'audio';
  } else if (msg?.documentMessage) {
    type = 'document';
    text = msg.documentMessage.caption ?? null;
    media_filename = msg.documentMessage.fileName ?? null;
  } else if (msg?.documentWithCaptionMessage?.message?.documentMessage) {
    type = 'document';
    const doc = msg.documentWithCaptionMessage.message.documentMessage;
    text = doc.caption ?? null;
    media_filename = doc.fileName ?? null;
  } else if (msg?.stickerMessage) {
    type = 'sticker';
  } else if (msg?.locationMessage) {
    type = 'location';
  } else if (msg?.contactMessage || msg?.contactsArrayMessage) {
    type = 'contact';
  }

  return {
    id,
    chat_jid,
    from_jid,
    from_me,
    timestamp,
    type,
    text,
    pushName: m.pushName ?? null,
    media_filename,
  };
}

function previewText(m: InboxMessage): string | null {
  if (m.text) return m.text.length > 120 ? m.text.slice(0, 117) + '...' : m.text;
  switch (m.type) {
    case 'image': return '[image]';
    case 'video': return '[video]';
    case 'audio': return '[audio]';
    case 'document': return m.media_filename ? `[document: ${m.media_filename}]` : '[document]';
    case 'sticker': return '[sticker]';
    case 'location': return '[location]';
    case 'contact': return '[contact]';
    default: return '[unsupported message type]';
  }
}

// Type re-exported so the existing imports in services/whatsapp-api.ts continue
// to work without touching every call site.
export type { WAMessageKey };

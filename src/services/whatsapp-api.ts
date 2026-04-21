import { promises as fs } from 'fs';
import * as path from 'path';
import * as mime from 'mime-types';
import { Boom } from '@hapi/boom';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  WAMessageKey,
  WASocket,
  proto,
} from '@whiskeysockets/baileys';
import pino, { Logger } from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';

import { ConfigManager } from '../config/whatsapp.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { RetryHandler } from '../utils/retry.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';

export type MediaType = 'image' | 'document' | 'audio' | 'video';

export interface SendMessageParams {
  to: string;
  message: string;
  preview_url?: boolean;
}

export interface SendMediaParams {
  to: string;
  mediaPath: string;
  mediaType: MediaType;
  caption?: string;
  filename?: string;
}

export interface SentMessage {
  message_id: string;
  to_jid: string;
  timestamp: string;
  status: MessageStatus;
}

export type MessageStatus = 'pending' | 'server_ack' | 'delivered' | 'read' | 'played' | 'error';

export type ConnectionState = 'disconnected' | 'connecting' | 'qr' | 'open' | 'logged_out';

interface StatusEntry {
  status: MessageStatus;
  updatedAt: string;
  to_jid: string;
}

export type InboxMessageType = 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' | 'contact' | 'other';

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

const INBOX_PER_CHAT_LIMIT = 100;
const INBOX_TOTAL_LIMIT = 1000;

export class WhatsAppService {
  private readonly config = ConfigManager.getInstance();
  private readonly logger: Logger;
  private readonly messageLimiter: RateLimiter;
  private readonly mediaLimiter: RateLimiter;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly retryHandler: RetryHandler;

  private sock: WASocket | null = null;
  private saveCreds: (() => Promise<void>) | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private currentQr: string | null = null;
  private currentQrGeneratedAt: number | null = null;
  private me: { id: string; name?: string } | null = null;
  private readonly statusMap = new Map<string, StatusEntry>();
  private readonly inbox = new Map<string, InboxMessage[]>();
  private readonly unreadByChat = new Map<string, number>();
  private inboxTotalCount = 0;
  private readyWaiters: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
  private manualLogout = false;

  constructor() {
    const cfg = this.config.getConfig();
    this.logger = pino({ level: cfg.logLevel }).child({ mod: 'whatsapp' });
    this.messageLimiter = new RateLimiter(cfg.rateLimit.messagesPerSecond, cfg.rateLimit.burstLimit);
    this.mediaLimiter = new RateLimiter(cfg.rateLimit.mediaPerSecond, cfg.rateLimit.burstLimit);
    this.circuitBreaker = new CircuitBreaker();
    this.retryHandler = new RetryHandler({
      maxRetries: cfg.retryPolicy.maxRetries,
      baseDelay: cfg.retryPolicy.baseDelay,
      maxDelay: cfg.retryPolicy.maxDelay,
      backoffMultiplier: cfg.retryPolicy.backoffMultiplier,
    });
  }

  async start(): Promise<void> {
    const cfg = this.config.getConfig();
    await fs.mkdir(cfg.sessionDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(cfg.sessionDir);
    this.saveCreds = saveCreds;

    const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({
      version: [2, 3000, 0] as [number, number, number],
      isLatest: false,
    }));
    this.logger.info({ version, isLatest }, 'Starting Baileys socket');

    this.connectionState = 'connecting';
    this.sock = makeWASocket({
      auth: state,
      version,
      logger: this.logger.child({ mod: 'baileys' }) as any,
      printQRInTerminal: false,
      browser: ['mcp-whatsapp', 'Chrome', '2.0.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    this.sock.ev.on('creds.update', saveCreds);
    this.sock.ev.on('connection.update', (update) => this.handleConnectionUpdate(update));
    this.sock.ev.on('messages.update', (updates) => this.handleMessageUpdates(updates));
    this.sock.ev.on('messages.upsert', (payload) => this.handleMessagesUpsert(payload));
  }

  private handleMessagesUpsert(payload: { messages: proto.IWebMessageInfo[]; type: string }): void {
    if (payload.type !== 'notify' && payload.type !== 'append') return;
    for (const m of payload.messages) {
      const normalized = normalizeInboxMessage(m);
      if (!normalized) continue;
      this.appendInbox(normalized);
    }
  }

  private appendInbox(msg: InboxMessage): void {
    const list = this.inbox.get(msg.chat_jid) ?? [];
    list.push(msg);
    if (list.length > INBOX_PER_CHAT_LIMIT) list.shift();
    this.inbox.set(msg.chat_jid, list);
    this.inboxTotalCount++;

    if (!msg.from_me) {
      this.unreadByChat.set(msg.chat_jid, (this.unreadByChat.get(msg.chat_jid) ?? 0) + 1);
    }

    while (this.inboxTotalCount > INBOX_TOTAL_LIMIT) {
      let oldestChat: string | null = null;
      let oldestTs = Infinity;
      for (const [chat, msgs] of this.inbox) {
        if (msgs.length === 0) continue;
        const ts = new Date(msgs[0].timestamp).getTime();
        if (ts < oldestTs) { oldestTs = ts; oldestChat = chat; }
      }
      if (!oldestChat) break;
      const msgs = this.inbox.get(oldestChat)!;
      msgs.shift();
      this.inboxTotalCount--;
      if (msgs.length === 0) this.inbox.delete(oldestChat);
    }
  }

  private async handleConnectionUpdate(update: {
    connection?: 'open' | 'close' | 'connecting';
    qr?: string;
    lastDisconnect?: { error: Error | undefined; date: Date };
  }): Promise<void> {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      this.currentQr = qr;
      this.currentQrGeneratedAt = Date.now();
      this.connectionState = 'qr';
      this.logger.info('QR code generated — scan from WhatsApp → Linked Devices');
      qrcodeTerminal.generate(qr, { small: true }, (ascii) => {
        process.stderr.write('\n' + ascii + '\n');
      });
    }

    if (connection === 'open') {
      this.currentQr = null;
      this.connectionState = 'open';
      this.me = this.sock?.user ? { id: this.sock.user.id, name: this.sock.user.name } : null;
      this.logger.info({ me: this.me }, 'Connection OPEN');
      this.flushReadyWaiters();
    }

    if (connection === 'close') {
      const boom = lastDisconnect?.error as Boom | undefined;
      const statusCode = boom?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      this.logger.warn({ statusCode, loggedOut, manual: this.manualLogout }, 'Connection closed');

      if (loggedOut || this.manualLogout) {
        this.connectionState = 'logged_out';
        this.rejectReadyWaiters(new Error('Logged out — scan QR again via `npm start`'));
        return;
      }

      this.connectionState = 'connecting';
      setTimeout(() => {
        this.start().catch((err) => this.logger.error({ err }, 'Reconnect failed'));
      }, 2000);
    }
  }

  private handleMessageUpdates(updates: Array<{ key: WAMessageKey; update: Partial<proto.IWebMessageInfo> }>): void {
    for (const { key, update } of updates) {
      const id = key.id;
      if (!id) continue;
      const existing = this.statusMap.get(id);
      if (!existing) continue;
      const statusCode = update.status;
      if (statusCode === undefined || statusCode === null) continue;
      const mapped = mapProtoStatus(statusCode);
      if (mapped) {
        this.statusMap.set(id, { ...existing, status: mapped, updatedAt: new Date().toISOString() });
      }
    }
  }

  private flushReadyWaiters(): void {
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) w.resolve();
  }

  private rejectReadyWaiters(err: Error): void {
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) w.reject(err);
  }

  /**
   * Wait until the connection is open. Throws if the connection enters
   * logged_out state or the timeout elapses. The QR state is NOT an error —
   * the caller just needs to scan it.
   */
  waitReady(timeoutMs = 120_000): Promise<void> {
    if (this.connectionState === 'open') return Promise.resolve();
    if (this.connectionState === 'logged_out') {
      return Promise.reject(new Error('Logged out — re-pair required'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((w) => w.resolve !== resolve);
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for WhatsApp connection (state=${this.connectionState})`));
      }, timeoutMs);
      this.readyWaiters.push({
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  async sendMessage(params: SendMessageParams): Promise<SentMessage> {
    await this.ensureReady();
    const jid = this.config.normalizeJid(params.to);
    validateText(params.message);

    return this.circuitBreaker.execute(() =>
      this.retryHandler.execute(async () => {
        await this.messageLimiter.wait();
        const content: any = { text: params.message };
        if (!params.preview_url) content.linkPreview = null;
        const sent = await this.requireSocket().sendMessage(jid, content);
        return this.recordSent(sent, jid);
      }),
    );
  }

  async sendMediaMessage(params: SendMediaParams): Promise<SentMessage> {
    await this.ensureReady();
    const jid = this.config.normalizeJid(params.to);
    await this.validateMediaFile(params.mediaPath);

    const mimeType = (mime.lookup(params.mediaPath) || 'application/octet-stream').toString();
    const filename = params.filename || path.basename(params.mediaPath);
    const buffer = await fs.readFile(params.mediaPath);

    return this.circuitBreaker.execute(() =>
      this.retryHandler.execute(async () => {
        await this.mediaLimiter.wait();
        const content = buildMediaContent(params.mediaType, buffer, mimeType, filename, params.caption);
        const sent = await this.requireSocket().sendMessage(jid, content);
        return this.recordSent(sent, jid);
      }),
    );
  }

  listChats(limit = 50): ChatSummary[] {
    const summaries: ChatSummary[] = [];
    for (const [chat_jid, msgs] of this.inbox) {
      if (msgs.length === 0) continue;
      const last = msgs[msgs.length - 1];
      summaries.push({
        chat_jid,
        last_timestamp: last.timestamp,
        last_message_preview: previewText(last),
        last_from_me: last.from_me,
        unread_count: this.unreadByChat.get(chat_jid) ?? 0,
        message_count: msgs.length,
      });
    }
    summaries.sort((a, b) => b.last_timestamp.localeCompare(a.last_timestamp));
    return summaries.slice(0, limit);
  }

  getChatMessages(chatJid: string, limit = 50): InboxMessage[] {
    const normalized = this.config.normalizeJid(chatJid);
    const msgs = this.inbox.get(normalized) ?? this.inbox.get(chatJid) ?? [];
    return msgs.slice(-limit);
  }

  markChatRead(chatJid: string): void {
    const normalized = this.config.normalizeJid(chatJid);
    this.unreadByChat.delete(normalized);
    this.unreadByChat.delete(chatJid);
  }

  getInboxOverview(): { total_messages: number; chats: number; total_unread: number } {
    let unread = 0;
    for (const n of this.unreadByChat.values()) unread += n;
    return { total_messages: this.inboxTotalCount, chats: this.inbox.size, total_unread: unread };
  }

  getMessageStatus(messageId: string): StatusEntry | undefined {
    return this.statusMap.get(messageId);
  }

  getAllStatuses(): Array<{ message_id: string } & StatusEntry> {
    return [...this.statusMap.entries()].map(([id, e]) => ({ message_id: id, ...e }));
  }

  async logout(): Promise<void> {
    this.manualLogout = true;
    try {
      await this.sock?.logout();
    } catch (err) {
      this.logger.warn({ err }, 'Error during logout, clearing state anyway');
    }
    const cfg = this.config.getConfig();
    await fs.rm(cfg.sessionDir, { recursive: true, force: true });
    this.connectionState = 'logged_out';
    this.currentQr = null;
    this.me = null;
    this.statusMap.clear();
    this.inbox.clear();
    this.unreadByChat.clear();
    this.inboxTotalCount = 0;
    this.logger.info('Logged out and session cleared');
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  getCurrentQr(): { qr: string; generatedAt: string } | null {
    if (!this.currentQr || !this.currentQrGeneratedAt) return null;
    return { qr: this.currentQr, generatedAt: new Date(this.currentQrGeneratedAt).toISOString() };
  }

  async getCurrentQrAsDataUrl(): Promise<string | null> {
    if (!this.currentQr) return null;
    return QRCode.toDataURL(this.currentQr, { width: 300, margin: 1 });
  }

  getMe(): { id: string; name?: string } | null {
    return this.me;
  }

  getHealth(): {
    connection: ConnectionState;
    me: { id: string; name?: string } | null;
    circuitBreaker: ReturnType<CircuitBreaker['getMetrics']>;
    rateLimiter: { messages: ReturnType<RateLimiter['getStatus']>; media: ReturnType<RateLimiter['getStatus']> };
    pendingMessages: number;
  } {
    return {
      connection: this.connectionState,
      me: this.me,
      circuitBreaker: this.circuitBreaker.getMetrics(),
      rateLimiter: {
        messages: this.messageLimiter.getStatus(),
        media: this.mediaLimiter.getStatus(),
      },
      pendingMessages: [...this.statusMap.values()].filter((s) => s.status === 'pending' || s.status === 'server_ack').length,
    };
  }

  private requireSocket(): WASocket {
    if (!this.sock) throw new Error('Socket not initialized — call start() first');
    return this.sock;
  }

  private async ensureReady(): Promise<void> {
    if (this.connectionState === 'open') return;
    if (this.connectionState === 'logged_out') {
      throw new Error('WhatsApp is logged out. Restart the server and scan the QR code.');
    }
    await this.waitReady(15_000).catch((err) => {
      throw new Error(`WhatsApp not ready: ${err.message}`);
    });
  }

  private recordSent(sent: proto.WebMessageInfo | undefined, jid: string): SentMessage {
    if (!sent || !sent.key?.id) throw new Error('Send failed: no message ID returned');
    const id = sent.key.id;
    const entry: StatusEntry = {
      status: 'pending',
      updatedAt: new Date().toISOString(),
      to_jid: jid,
    };
    this.statusMap.set(id, entry);
    return { message_id: id, to_jid: jid, timestamp: entry.updatedAt, status: 'pending' };
  }

  private async validateMediaFile(filePath: string): Promise<void> {
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`File not found: ${filePath}`);
    }
    const mimeType = (mime.lookup(filePath) || '').toString();
    if (!mimeType || !this.config.isAllowedMimeType(mimeType)) {
      throw new Error(`Unsupported media type: "${mimeType || 'unknown'}" for ${filePath}`);
    }
    const stat = await fs.stat(filePath);
    const max = this.config.getConfig().media.maxSize;
    if (stat.size > max) {
      throw new Error(`File too large: ${stat.size} bytes (max ${max})`);
    }
  }
}

function validateText(text: string): void {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Message must be a non-empty string');
  }
  if (text.length > 4096) {
    throw new Error(`Message too long: ${text.length} (max 4096)`);
  }
}

function buildMediaContent(
  type: MediaType,
  buffer: Buffer,
  mimeType: string,
  filename: string,
  caption?: string,
): any {
  switch (type) {
    case 'image':
      return { image: buffer, caption, mimetype: mimeType };
    case 'document':
      return { document: buffer, fileName: filename, mimetype: mimeType, caption };
    case 'audio':
      return { audio: buffer, mimetype: mimeType, ptt: false };
    case 'video':
      return { video: buffer, caption, mimetype: mimeType };
  }
}

function normalizeInboxMessage(m: proto.IWebMessageInfo): InboxMessage | null {
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
    : tsRaw && typeof (tsRaw as any).toNumber === 'function'
      ? (tsRaw as any).toNumber()
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

function mapProtoStatus(status: proto.WebMessageInfo.Status | number | null | undefined): MessageStatus | null {
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

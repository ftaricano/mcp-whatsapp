import { promises as fs } from 'fs';
import * as path from 'path';
import * as mime from 'mime-types';
import { Boom } from '@hapi/boom';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
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
import { resolveSafePath } from '../utils/path-safety.js';
import {
  InboxStore,
  InboxMessage,
  ChatSummary,
  InboxMessageType,
  normalizeInboxMessage,
} from './inbox-store.js';
import { StatusTracker, StatusEntry, MessageStatus } from './status-tracker.js';

export type MediaType = 'image' | 'document' | 'audio' | 'video';
export type { InboxMessage, ChatSummary, InboxMessageType, StatusEntry, MessageStatus };

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

export type ConnectionState = 'disconnected' | 'connecting' | 'qr' | 'open' | 'logged_out';

const RECONNECT_DELAY_MS = 2000;
const DEFAULT_ENSURE_READY_MS = 15_000;

export class WhatsAppService {
  private readonly config = ConfigManager.getInstance();
  private readonly logger: Logger;
  private readonly messageLimiter: RateLimiter;
  private readonly mediaLimiter: RateLimiter;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly retryHandler: RetryHandler;
  private readonly inbox: InboxStore;
  private readonly statuses: StatusTracker;

  private sock: WASocket | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private currentQr: string | null = null;
  private currentQrGeneratedAt: number | null = null;
  private me: { id: string; name?: string } | null = null;
  private readyWaiters: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  private manualLogout = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shutdown = false;

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
    this.inbox = new InboxStore();
    this.statuses = new StatusTracker();
  }

  async start(): Promise<void> {
    if (this.shutdown) throw new Error('Service is shutting down');
    const cfg = this.config.getConfig();
    await fs.mkdir(cfg.sessionDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(cfg.sessionDir);

    const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({
      version: [2, 3000, 0] as [number, number, number],
      isLatest: false,
    }));
    this.logger.info({ version, isLatest }, 'Starting Baileys socket');

    this.teardownSocket();
    this.connectionState = 'connecting';

    this.sock = makeWASocket({
      auth: state,
      version,
      logger: this.logger.child({ mod: 'baileys' }) as unknown as Logger,
      printQRInTerminal: false,
      browser: ['mcp-whatsapp', 'Chrome', '2.1.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    this.sock.ev.on('creds.update', saveCreds);
    this.sock.ev.on('connection.update', (u) => this.handleConnectionUpdate(u));
    this.sock.ev.on('messages.update', (u) => this.statuses.applyUpdates(u));
    this.sock.ev.on('messages.upsert', (p) => this.handleMessagesUpsert(p));
  }

  private teardownSocket(): void {
    if (!this.sock) return;
    try {
      this.sock.ev.removeAllListeners('creds.update');
      this.sock.ev.removeAllListeners('connection.update');
      this.sock.ev.removeAllListeners('messages.update');
      this.sock.ev.removeAllListeners('messages.upsert');
      // end() emits 'close'; that's fine because we just removed our listener.
      this.sock.end(undefined);
    } catch (err) {
      this.logger.debug({ err }, 'teardownSocket ignored error');
    }
    this.sock = null;
  }

  private handleMessagesUpsert(payload: { messages: proto.IWebMessageInfo[]; type: string }): void {
    if (payload.type !== 'notify' && payload.type !== 'append') return;
    for (const m of payload.messages) {
      const normalized = normalizeInboxMessage(m);
      if (normalized) this.inbox.append(normalized);
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
      if (this.config.getConfig().logLevel !== 'silent') {
        qrcodeTerminal.generate(qr, { small: true }, (ascii) => {
          process.stderr.write('\n' + ascii + '\n');
        });
      }
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
        this.rejectReadyWaiters(new Error('Logged out — scan QR again via `whatsapp pair` or `npm start`'));
        return;
      }

      if (this.shutdown) return;
      this.connectionState = 'connecting';
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start().catch((err) => {
        this.logger.error({ err }, 'Reconnect failed — will wait for next socket close');
      });
    }, RECONNECT_DELAY_MS);
    this.reconnectTimer.unref?.();
  }

  private flushReadyWaiters(): void {
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.resolve();
    }
  }

  private rejectReadyWaiters(err: Error): void {
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.reject(err);
    }
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
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const idx = this.readyWaiters.indexOf(waiter);
          if (idx >= 0) this.readyWaiters.splice(idx, 1);
          reject(new Error(
            `Timed out after ${timeoutMs}ms waiting for WhatsApp connection (state=${this.connectionState})`,
          ));
        }, timeoutMs),
      };
      waiter.timer.unref?.();
      this.readyWaiters.push(waiter);
    });
  }

  async sendMessage(params: SendMessageParams): Promise<SentMessage> {
    await this.ensureReady();
    const jid = this.config.normalizeJid(params.to);
    validateText(params.message);

    return this.circuitBreaker.execute(() =>
      this.retryHandler.execute(async () => {
        await this.messageLimiter.wait();
        const content: { text: string; linkPreview?: null } = { text: params.message };
        if (!params.preview_url) content.linkPreview = null;
        const sent = await this.requireSocket().sendMessage(jid, content);
        return this.recordSent(sent, jid);
      }),
    );
  }

  async sendMediaMessage(params: SendMediaParams): Promise<SentMessage> {
    await this.ensureReady();
    const jid = this.config.normalizeJid(params.to);
    const safePath = await this.validateMediaFile(params.mediaPath);

    const mimeType = (mime.lookup(safePath) || 'application/octet-stream').toString();
    const filename = params.filename || path.basename(safePath);
    const buffer = await fs.readFile(safePath);

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
    return this.inbox.listChats(limit);
  }

  getChatMessages(chatJid: string, limit = 50): InboxMessage[] {
    const normalized = this.safeNormalizeJid(chatJid) ?? chatJid;
    const msgs = this.inbox.getMessages(normalized, limit);
    if (msgs.length > 0 || normalized === chatJid) return msgs;
    return this.inbox.getMessages(chatJid, limit);
  }

  markChatRead(chatJid: string): void {
    const normalized = this.safeNormalizeJid(chatJid) ?? chatJid;
    this.inbox.markRead(normalized);
    if (normalized !== chatJid) this.inbox.markRead(chatJid);
  }

  private safeNormalizeJid(chatJid: string): string | null {
    try {
      return this.config.normalizeJid(chatJid);
    } catch {
      return null;
    }
  }

  getInboxOverview(): { total_messages: number; chats: number; total_unread: number } {
    return this.inbox.overview();
  }

  getMessageStatus(messageId: string): StatusEntry | undefined {
    return this.statuses.get(messageId);
  }

  getAllStatuses(): Array<{ message_id: string } & StatusEntry> {
    return this.statuses.all();
  }

  async logout(): Promise<void> {
    this.manualLogout = true;
    try {
      await this.sock?.logout();
    } catch (err) {
      this.logger.warn({ err }, 'Error during logout, clearing state anyway');
    }
    this.teardownSocket();
    const cfg = this.config.getConfig();
    await fs.rm(cfg.sessionDir, { recursive: true, force: true });
    this.connectionState = 'logged_out';
    this.currentQr = null;
    this.me = null;
    this.statuses.clear();
    this.inbox.clear();
    this.logger.info('Logged out and session cleared');
  }

  async dispose(): Promise<void> {
    this.shutdown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.messageLimiter.dispose();
    this.mediaLimiter.dispose();
    this.rejectReadyWaiters(new Error('Service disposed'));
    this.teardownSocket();
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
    rateLimiter: {
      messages: ReturnType<RateLimiter['getStatus']>;
      media: ReturnType<RateLimiter['getStatus']>;
    };
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
      pendingMessages: this.statuses.pendingCount(),
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
    await this.waitReady(DEFAULT_ENSURE_READY_MS).catch((err) => {
      throw new Error(`WhatsApp not ready: ${err.message}`);
    });
  }

  private recordSent(sent: proto.WebMessageInfo | undefined, jid: string): SentMessage {
    if (!sent || !sent.key?.id) throw new Error('Send failed: no message ID returned');
    const id = sent.key.id;
    const entry = this.statuses.record(id, jid);
    return { message_id: id, to_jid: jid, timestamp: entry.updatedAt, status: 'pending' };
  }

  private async validateMediaFile(filePath: string): Promise<string> {
    const cfg = this.config.getConfig();
    const safePath = await resolveSafePath(filePath, {
      allowedDirs: cfg.media.allowedDirs,
      blockSymlinksOutsideAllowed: true,
    });
    const mimeType = (mime.lookup(safePath) || '').toString();
    if (!mimeType || !this.config.isAllowedMimeType(mimeType)) {
      throw new Error(`Unsupported media type: "${mimeType || 'unknown'}" for ${filePath}`);
    }
    const stat = await fs.stat(safePath);
    if (stat.size > cfg.media.maxSize) {
      throw new Error(`File too large: ${stat.size} bytes (max ${cfg.media.maxSize})`);
    }
    return safePath;
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

type MediaContent =
  | { image: Buffer; caption?: string; mimetype: string }
  | { document: Buffer; fileName: string; mimetype: string; caption?: string }
  | { audio: Buffer; mimetype: string; ptt: false }
  | { video: Buffer; caption?: string; mimetype: string };

function buildMediaContent(
  type: MediaType,
  buffer: Buffer,
  mimeType: string,
  filename: string,
  caption?: string,
): MediaContent {
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

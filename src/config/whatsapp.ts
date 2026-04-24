import * as path from 'path';
import { z } from 'zod';
import { parseAllowedDirs } from '../utils/path-safety.js';

const ConfigSchema = z.object({
  sessionDir: z.string(),
  rateLimit: z.object({
    messagesPerSecond: z.number().positive(),
    mediaPerSecond: z.number().positive(),
    burstLimit: z.number().positive(),
  }),
  retryPolicy: z.object({
    maxRetries: z.number().int().min(0),
    baseDelay: z.number().int().positive(),
    maxDelay: z.number().int().positive(),
    backoffMultiplier: z.number().positive(),
  }),
  media: z.object({
    maxSize: z.number().int().positive(),
    allowedMimeTypes: z.array(z.string()),
    allowedDirs: z.array(z.string()).min(1),
  }),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  defaultCountryCode: z.string().regex(/^\d{1,3}$/),
});

export type WhatsAppConfig = z.infer<typeof ConfigSchema>;

// `text/plain` was removed intentionally: combined with absolute-path media
// inputs it allowed exfiltration of arbitrary text files (/etc/passwd, dotfiles,
// .env). Re-enable explicitly if you really need it. `text/csv` stays because
// it is a common business attachment and less of a credential vector.
const DEFAULT_ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'audio/mpeg', 'audio/mp4', 'audio/amr', 'audio/ogg', 'audio/ogg; codecs=opus',
  'video/mp4', 'video/3gpp',
];

function num(env: string | undefined, fallback: number): number {
  if (env === undefined || env === '') return fallback;
  const n = Number(env);
  if (Number.isNaN(n)) throw new Error(`Invalid number for env var: "${env}"`);
  return n;
}

export class ConfigManager {
  private static instance: ConfigManager | null = null;
  private readonly config: WhatsAppConfig;

  private constructor() {
    const raw = {
      sessionDir: process.env.WHATSAPP_SESSION_DIR
        ? path.resolve(process.env.WHATSAPP_SESSION_DIR)
        : path.resolve(process.cwd(), 'auth-state'),
      rateLimit: {
        messagesPerSecond: num(process.env.WHATSAPP_RATE_LIMIT_MESSAGES, 2),
        mediaPerSecond: num(process.env.WHATSAPP_RATE_LIMIT_MEDIA, 1),
        burstLimit: num(process.env.WHATSAPP_BURST_LIMIT, 10),
      },
      retryPolicy: {
        maxRetries: num(process.env.WHATSAPP_MAX_RETRIES, 3),
        baseDelay: num(process.env.WHATSAPP_BASE_DELAY, 1000),
        maxDelay: num(process.env.WHATSAPP_MAX_DELAY, 30000),
        backoffMultiplier: num(process.env.WHATSAPP_BACKOFF_MULTIPLIER, 2),
      },
      media: {
        maxSize: num(process.env.WHATSAPP_MAX_MEDIA_SIZE, 15 * 1024 * 1024),
        allowedMimeTypes: DEFAULT_ALLOWED_MIME,
        allowedDirs: parseAllowedDirs(process.env.WHATSAPP_ALLOWED_DIRS),
      },
      logLevel: (process.env.WHATSAPP_LOG_LEVEL ?? 'info') as WhatsAppConfig['logLevel'],
      defaultCountryCode: process.env.WHATSAPP_DEFAULT_COUNTRY_CODE ?? '55',
    };
    this.config = ConfigSchema.parse(raw);
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) ConfigManager.instance = new ConfigManager();
    return ConfigManager.instance;
  }

  getConfig(): WhatsAppConfig {
    return this.config;
  }

  /**
   * Normalize a phone number to WhatsApp JID format: "<digits>@s.whatsapp.net".
   * Accepts E.164 ("+5521...") or bare digits. Applies defaultCountryCode only
   * when the number is clearly a local subscriber number (10–11 digits,
   * typical for Brazil DDD+number, with or without the 9-prefix).
   *
   * Rejects obviously-malformed inputs (< 8 or > 15 digits after stripping).
   * E.164 max is 15; min national significant numbers are 7, we add a
   * defensive floor of 8 to catch placeholders like "11111111".
   */
  normalizeJid(phone: string): string {
    if (typeof phone !== 'string') throw new Error('Phone must be a string');
    const trimmed = phone.trim();
    if (trimmed.endsWith('@s.whatsapp.net') || trimmed.endsWith('@g.us')) {
      const prefix = trimmed.split('@')[0] ?? '';
      if (!/^\d+$/.test(prefix) || prefix.length < 8 || prefix.length > 18) {
        throw new Error(`Invalid JID: "${phone}"`);
      }
      return trimmed;
    }
    const digits = trimmed.replace(/\D+/g, '');
    if (digits.length === 0) throw new Error(`Invalid phone: "${phone}"`);

    let full: string;
    if (digits.length >= 10 && digits.length <= 11) {
      full = `${this.config.defaultCountryCode}${digits}`;
    } else {
      full = digits;
    }

    if (full.length < 8 || full.length > 15) {
      throw new Error(
        `Invalid phone "${phone}" — expected 8–15 digits after normalization, got ${full.length}`,
      );
    }
    return `${full}@s.whatsapp.net`;
  }

  isAllowedMimeType(mime: string): boolean {
    return this.config.media.allowedMimeTypes.includes(mime.toLowerCase());
  }
}

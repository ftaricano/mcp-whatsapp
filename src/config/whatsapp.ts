import * as path from 'path';
import { z } from 'zod';

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
  }),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  defaultCountryCode: z.string().regex(/^\d{1,3}$/),
});

export type WhatsAppConfig = z.infer<typeof ConfigSchema>;

const DEFAULT_ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
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
   * Accepts E.164 ("+5521...") or bare digits. Applies defaultCountryCode if
   * the number is clearly local (fewer than 11 digits).
   */
  normalizeJid(phone: string): string {
    if (phone.endsWith('@s.whatsapp.net') || phone.endsWith('@g.us')) return phone;
    const digits = phone.replace(/\D+/g, '');
    if (digits.length === 0) throw new Error(`Invalid phone: "${phone}"`);
    const withCC = digits.length <= 11 ? `${this.config.defaultCountryCode}${digits}` : digits;
    return `${withCC}@s.whatsapp.net`;
  }

  isAllowedMimeType(mime: string): boolean {
    return this.config.media.allowedMimeTypes.includes(mime.toLowerCase());
  }
}

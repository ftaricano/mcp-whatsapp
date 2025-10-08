export interface WhatsAppConfig {
  // Authentication (required)
  accessToken: string;
  phoneNumberId: string;
  
  // API settings
  apiVersion: string;
  baseUrl: string;
  
  // Rate limiting
  rateLimit: {
    messagesPerSecond: number;
    mediaPerSecond: number;
    burstLimit: number;
  };
  
  // Retry policy
  retryPolicy: {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
  };
  
  // Media handling
  media: {
    maxSize: number;
    allowedTypes: string[];
    compressionEnabled: boolean;
    tempDir: string;
  };
}

export class ConfigManager {
  private static instance: ConfigManager;
  private config: WhatsAppConfig;

  private constructor() {
    this.config = this.loadConfig();
    this.validateConfig();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private loadConfig(): WhatsAppConfig {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!accessToken || !phoneNumberId) {
      throw new Error('WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required');
    }

    return {
      accessToken,
      phoneNumberId,
      apiVersion: process.env.WHATSAPP_API_VERSION || 'v17.0',
      baseUrl: process.env.WHATSAPP_BASE_URL || 'https://graph.facebook.com',
      rateLimit: {
        messagesPerSecond: parseInt(process.env.WHATSAPP_RATE_LIMIT_MESSAGES || '10'),
        mediaPerSecond: parseInt(process.env.WHATSAPP_RATE_LIMIT_MEDIA || '2'),
        burstLimit: parseInt(process.env.WHATSAPP_BURST_LIMIT || '50')
      },
      retryPolicy: {
        maxRetries: parseInt(process.env.WHATSAPP_MAX_RETRIES || '3'),
        baseDelay: parseInt(process.env.WHATSAPP_BASE_DELAY || '1000'),
        maxDelay: parseInt(process.env.WHATSAPP_MAX_DELAY || '30000'),
        backoffMultiplier: parseFloat(process.env.WHATSAPP_BACKOFF_MULTIPLIER || '2')
      },
      media: {
        maxSize: parseInt(process.env.WHATSAPP_MAX_MEDIA_SIZE || '15728640'), // 15MB
        allowedTypes: [
          'image/jpeg', 'image/png', 'image/webp',
          'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'text/plain', 'text/csv',
          'audio/mpeg', 'audio/mp4', 'audio/amr', 'audio/ogg',
          'video/mp4', 'video/3gpp'
        ],
        compressionEnabled: process.env.WHATSAPP_COMPRESSION_ENABLED !== 'false',
        tempDir: process.env.WHATSAPP_TEMP_DIR || './temp'
      }
    };
  }

  private validateConfig(): void {
    const { accessToken, phoneNumberId } = this.config;
    
    // Validate access token format
    if (!accessToken.startsWith('EAA') && !accessToken.startsWith('EAAG')) {
      console.warn('Access token may be invalid. Expected format: EAA... or EAAG...');
    }

    // Validate phone number ID format
    if (!/^\d+$/.test(phoneNumberId)) {
      throw new Error('Phone Number ID must contain only digits');
    }

    // Validate rate limits
    if (this.config.rateLimit.messagesPerSecond <= 0) {
      throw new Error('Messages per second must be greater than 0');
    }

    // Validate media size
    if (this.config.media.maxSize > 16777216) { // 16MB WhatsApp limit
      console.warn('Max media size exceeds WhatsApp limit of 16MB');
    }
  }

  public getConfig(): WhatsAppConfig {
    return { ...this.config };
  }

  public getApiUrl(): string {
    return `${this.config.baseUrl}/${this.config.apiVersion}/${this.config.phoneNumberId}`;
  }

  public getHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.config.accessToken}`,
      'Content-Type': 'application/json'
    };
  }

  public isValidPhoneNumber(phone: string): boolean {
    // E.164 format validation
    return /^\+[1-9]\d{1,14}$/.test(phone);
  }

  public isAllowedMediaType(mimeType: string): boolean {
    return this.config.media.allowedTypes.includes(mimeType);
  }
}
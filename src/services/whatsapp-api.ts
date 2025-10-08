import axios, { AxiosResponse } from 'axios';
import FormData from 'form-data';
import { createReadStream, promises as fs } from 'fs';
import * as path from 'path';
import * as mime from 'mime-types';

import { ConfigManager } from '../config/whatsapp.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { RetryHandler } from '../utils/retry.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';

export interface SendMessageParams {
  to: string;
  message: string;
  preview_url?: boolean;
}

export interface SendMediaParams {
  to: string;
  mediaPath: string;
  mediaType: 'image' | 'document' | 'audio' | 'video';
  caption?: string;
  filename?: string;
}

export interface MessageResponse {
  messaging_product: string;
  contacts: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string;
    message_status?: string;
  }>;
}

export interface MediaUploadResponse {
  id: string;
  url?: string;
}

export class WhatsAppService {
  private readonly config = ConfigManager.getInstance();
  private readonly messageLimiter: RateLimiter;
  private readonly mediaLimiter: RateLimiter;
  private readonly circuitBreaker = new CircuitBreaker();
  private readonly retryHandler = new RetryHandler();

  constructor() {
    const cfg = this.config.getConfig();
    this.messageLimiter = new RateLimiter(
      cfg.rateLimit.messagesPerSecond,
      cfg.rateLimit.burstLimit
    );
    this.mediaLimiter = new RateLimiter(
      cfg.rateLimit.mediaPerSecond,
      cfg.rateLimit.burstLimit
    );
  }

  public async sendMessage(params: SendMessageParams): Promise<MessageResponse> {
    this.validatePhoneNumber(params.to);
    
    return this.circuitBreaker.execute(async () => {
      await this.messageLimiter.wait();
      
      return this.retryHandler.execute(async () => {
        const response = await axios.post(
          `${this.config.getApiUrl()}/messages`,
          {
            messaging_product: "whatsapp",
            to: params.to,
            type: "text",
            text: { 
              body: params.message,
              preview_url: params.preview_url || false
            }
          },
          {
            headers: this.config.getHeaders(),
            timeout: 10000
          }
        );
        
        return this.transformResponse(response);
      });
    });
  }

  public async sendMediaMessage(params: SendMediaParams): Promise<MessageResponse> {
    this.validatePhoneNumber(params.to);
    await this.validateMediaFile(params.mediaPath);
    
    return this.circuitBreaker.execute(async () => {
      await this.mediaLimiter.wait();
      
      return this.retryHandler.execute(async () => {
        // First upload the media
        const mediaId = await this.uploadMedia(params.mediaPath);
        
        // Then send the message with media
        const mediaPayload = this.buildMediaPayload(params, mediaId);
        
        const response = await axios.post(
          `${this.config.getApiUrl()}/messages`,
          {
            messaging_product: "whatsapp",
            to: params.to,
            type: params.mediaType,
            ...mediaPayload
          },
          {
            headers: this.config.getHeaders(),
            timeout: 30000 // Longer timeout for media
          }
        );
        
        return this.transformResponse(response);
      });
    });
  }

  public async uploadMedia(filePath: string): Promise<string> {
    const fileSize = await this.getFileSize(filePath);
    const cfg = this.config.getConfig();
    
    if (fileSize > cfg.media.maxSize) {
      throw new Error(`File size ${fileSize} exceeds maximum allowed size ${cfg.media.maxSize}`);
    }

    // For files larger than 5MB, use resumable upload
    if (fileSize > 5 * 1024 * 1024) {
      return this.resumableUpload(filePath);
    }
    
    return this.standardUpload(filePath);
  }

  private async standardUpload(filePath: string): Promise<string> {
    const formData = new FormData();
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    
    formData.append('file', createReadStream(filePath), {
      filename: path.basename(filePath),
      contentType: mimeType
    });
    formData.append('messaging_product', 'whatsapp');

    const response = await axios.post(
      `${this.config.getApiUrl()}/media`,
      formData,
      {
        headers: {
          ...this.config.getHeaders(),
          ...formData.getHeaders()
        },
        timeout: 60000,
        maxContentLength: this.config.getConfig().media.maxSize,
        maxBodyLength: this.config.getConfig().media.maxSize
      }
    );

    return response.data.id;
  }

  private async resumableUpload(filePath: string): Promise<string> {
    // For large files, implement chunked upload
    // This is a simplified version - production should implement proper resumable upload
    console.warn('Large file detected, using standard upload. Consider implementing resumable upload for production.');
    return this.standardUpload(filePath);
  }

  public async getMessageStatus(messageId: string): Promise<any> {
    return this.circuitBreaker.execute(async () => {
      return this.retryHandler.execute(async () => {
        const response = await axios.get(
          `${this.config.getApiUrl()}/messages/${messageId}`,
          {
            headers: this.config.getHeaders(),
            timeout: 10000
          }
        );
        
        return response.data;
      });
    });
  }

  public async testConnection(): Promise<boolean> {
    try {
      const response = await axios.get(
        `${this.config.getApiUrl()}`,
        {
          headers: this.config.getHeaders(),
          timeout: 5000
        }
      );
      
      return response.status === 200;
    } catch (error) {
      console.error('WhatsApp API connection test failed:', error);
      return false;
    }
  }

  private validatePhoneNumber(phone: string): void {
    if (!this.config.isValidPhoneNumber(phone)) {
      throw new Error(`Invalid phone number format: ${phone}. Must be in E.164 format (e.g., +5511999999999)`);
    }
  }

  private async validateMediaFile(filePath: string): Promise<void> {
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`File not found: ${filePath}`);
    }

    const mimeType = mime.lookup(filePath);
    if (!mimeType || !this.config.isAllowedMediaType(mimeType)) {
      throw new Error(`Unsupported media type: ${mimeType}`);
    }

    const fileSize = await this.getFileSize(filePath);
    const maxSize = this.config.getConfig().media.maxSize;
    
    if (fileSize > maxSize) {
      throw new Error(`File size ${fileSize} exceeds maximum allowed size ${maxSize}`);
    }
  }

  private async getFileSize(filePath: string): Promise<number> {
    const stats = await fs.stat(filePath);
    return stats.size;
  }

  private buildMediaPayload(params: SendMediaParams, mediaId: string): any {
    const payload: any = {};
    
    switch (params.mediaType) {
      case 'image':
        payload.image = { id: mediaId };
        if (params.caption) payload.image.caption = params.caption;
        break;
      case 'document':
        payload.document = { 
          id: mediaId,
          filename: params.filename || path.basename(params.mediaPath)
        };
        if (params.caption) payload.document.caption = params.caption;
        break;
      case 'audio':
        payload.audio = { id: mediaId };
        break;
      case 'video':
        payload.video = { id: mediaId };
        if (params.caption) payload.video.caption = params.caption;
        break;
    }
    
    return payload;
  }

  private transformResponse(response: AxiosResponse): MessageResponse {
    return {
      messaging_product: response.data.messaging_product,
      contacts: response.data.contacts || [],
      messages: response.data.messages || []
    };
  }

  public getHealthStatus(): {
    isHealthy: boolean;
    circuitBreaker: any;
    rateLimiter: {
      messages: any;
      media: any;
    };
  } {
    return {
      isHealthy: this.circuitBreaker.getState() === 'closed',
      circuitBreaker: this.circuitBreaker.getMetrics(),
      rateLimiter: {
        messages: this.messageLimiter.getStatus(),
        media: this.mediaLimiter.getStatus()
      }
    };
  }
}
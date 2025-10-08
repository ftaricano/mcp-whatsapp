import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { WhatsAppService } from '../services/whatsapp-api.js';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as mime from 'mime-types';

export const sendMediaMessageTool: Tool = {
  name: "send_media_message",
  description: "Enviar mensagem com anexo (imagem, documento, áudio ou vídeo) até 15MB",
  inputSchema: {
    type: "object",
    properties: {
      to: {
        type: "string",
        pattern: "^\\+[1-9]\\d{1,14}$",
        description: "Número WhatsApp no formato E.164 (ex: +5511999999999)"
      },
      media_path: {
        type: "string",
        description: "Caminho para o arquivo de mídia (máximo 15MB)"
      },
      media_type: {
        type: "string",
        enum: ["image", "document", "audio", "video"],
        description: "Tipo de mídia do arquivo"
      },
      caption: {
        type: "string",
        maxLength: 1024,
        description: "Legenda/descrição do arquivo (opcional, máximo 1024 caracteres)"
      },
      filename: {
        type: "string",
        description: "Nome personalizado para o arquivo (opcional, usado principalmente para documentos)"
      }
    },
    required: ["to", "media_path", "media_type"]
  }
};

export async function handleSendMediaMessage(
  whatsappService: WhatsAppService,
  args: any
): Promise<any> {
  try {
    // Validate required parameters
    if (!args.to || !args.media_path || !args.media_type) {
      throw new Error('Parâmetros obrigatórios: to, media_path, media_type');
    }

    // Validate phone number format
    if (!args.to.match(/^\+[1-9]\d{1,14}$/)) {
      throw new Error(`Número de telefone inválido: ${args.to}. Use o formato E.164 (ex: +5511999999999)`);
    }

    // Validate media type
    const allowedTypes = ['image', 'document', 'audio', 'video'];
    if (!allowedTypes.includes(args.media_type)) {
      throw new Error(`Tipo de mídia inválido: ${args.media_type}. Tipos permitidos: ${allowedTypes.join(', ')}`);
    }

    // Check if file exists
    try {
      await fs.access(args.media_path);
    } catch {
      throw new Error(`Arquivo não encontrado: ${args.media_path}`);
    }

    // Get file information
    const fileStats = await fs.stat(args.media_path);
    const fileSize = fileStats.size;
    const mimeType = mime.lookup(args.media_path);
    const fileName = args.filename || path.basename(args.media_path);

    // Validate file size (15MB limit)
    const maxSize = 15 * 1024 * 1024; // 15MB
    if (fileSize > maxSize) {
      throw new Error(`Arquivo muito grande: ${(fileSize / 1024 / 1024).toFixed(2)}MB. Máximo permitido: 15MB`);
    }

    // Validate MIME type
    if (!mimeType) {
      throw new Error(`Não foi possível determinar o tipo do arquivo: ${args.media_path}`);
    }

    // Validate caption length
    if (args.caption && args.caption.length > 1024) {
      throw new Error(`Legenda muito longa: ${args.caption.length} caracteres. Máximo permitido: 1024`);
    }

    console.log(`Sending ${args.media_type} to ${args.to}: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);

    const response = await whatsappService.sendMediaMessage({
      to: args.to,
      mediaPath: args.media_path,
      mediaType: args.media_type,
      caption: args.caption,
      filename: fileName
    });

    // Extract relevant information from response
    const messageId = response.messages?.[0]?.id;
    const contactWaId = response.contacts?.[0]?.wa_id;

    return {
      success: true,
      message_id: messageId,
      contact_wa_id: contactWaId,
      to: args.to,
      media_info: {
        type: args.media_type,
        filename: fileName,
        size_mb: Number((fileSize / 1024 / 1024).toFixed(2)),
        mime_type: mimeType,
        caption: args.caption || null
      },
      timestamp: new Date().toISOString(),
      details: {
        messaging_product: response.messaging_product,
        status: "sent"
      }
    };

  } catch (error: any) {
    console.error('Error sending media message:', error);
    
    return {
      success: false,
      error: {
        message: error.message,
        type: error.response?.status ? 'api_error' : 'validation_error',
        status_code: error.response?.status,
        details: error.response?.data || null
      },
      to: args.to,
      media_path: args.media_path,
      timestamp: new Date().toISOString()
    };
  }
}
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { WhatsAppService } from '../services/whatsapp-api.js';

export const sendMessageTool: Tool = {
  name: "send_message",
  description: "Enviar mensagem de texto simples via WhatsApp",
  inputSchema: {
    type: "object",
    properties: {
      to: {
        type: "string",
        pattern: "^\\+[1-9]\\d{1,14}$",
        description: "Número WhatsApp no formato E.164 (ex: +5511999999999)"
      },
      message: {
        type: "string",
        maxLength: 4096,
        minLength: 1,
        description: "Texto da mensagem (máximo 4096 caracteres)"
      },
      preview_url: {
        type: "boolean",
        default: false,
        description: "Gerar preview automático de URLs na mensagem"
      }
    },
    required: ["to", "message"]
  }
};

export async function handleSendMessage(
  whatsappService: WhatsAppService,
  args: any
): Promise<any> {
  try {
    // Validate input
    if (!args.to || !args.message) {
      throw new Error('Parâmetros obrigatórios: to, message');
    }

    // Validate phone number format
    if (!args.to.match(/^\+[1-9]\d{1,14}$/)) {
      throw new Error(`Número de telefone inválido: ${args.to}. Use o formato E.164 (ex: +5511999999999)`);
    }

    // Validate message length
    if (args.message.length > 4096) {
      throw new Error(`Mensagem muito longa: ${args.message.length} caracteres. Máximo permitido: 4096`);
    }

    if (args.message.trim().length === 0) {
      throw new Error('Mensagem não pode estar vazia');
    }

    console.log(`Sending message to ${args.to}: ${args.message.substring(0, 50)}${args.message.length > 50 ? '...' : ''}`);

    const response = await whatsappService.sendMessage({
      to: args.to,
      message: args.message,
      preview_url: args.preview_url || false
    });

    // Extract relevant information from response
    const messageId = response.messages?.[0]?.id;
    const contactWaId = response.contacts?.[0]?.wa_id;

    return {
      success: true,
      message_id: messageId,
      contact_wa_id: contactWaId,
      to: args.to,
      message_length: args.message.length,
      preview_url_enabled: args.preview_url || false,
      timestamp: new Date().toISOString(),
      details: {
        messaging_product: response.messaging_product,
        status: "sent"
      }
    };

  } catch (error: any) {
    console.error('Error sending message:', error);
    
    return {
      success: false,
      error: {
        message: error.message,
        type: error.response?.status ? 'api_error' : 'validation_error',
        status_code: error.response?.status,
        details: error.response?.data || null
      },
      to: args.to,
      timestamp: new Date().toISOString()
    };
  }
}
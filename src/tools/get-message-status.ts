import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { WhatsAppService } from '../services/whatsapp-api.js';

export const getMessageStatusTool: Tool = {
  name: "get_message_status",
  description: "Verificar o status de entrega de uma mensagem enviada",
  inputSchema: {
    type: "object",
    properties: {
      message_id: {
        type: "string",
        minLength: 1,
        description: "ID da mensagem retornado após o envio"
      }
    },
    required: ["message_id"]
  }
};

export async function handleGetMessageStatus(
  whatsappService: WhatsAppService,
  args: any
): Promise<any> {
  try {
    // Validate required parameters
    if (!args.message_id) {
      throw new Error('Parâmetro obrigatório: message_id');
    }

    // Validate message ID format
    if (typeof args.message_id !== 'string' || args.message_id.trim().length === 0) {
      throw new Error('message_id deve ser uma string não vazia');
    }

    console.log(`Checking status for message ID: ${args.message_id}`);

    const statusResponse = await whatsappService.getMessageStatus(args.message_id);

    return {
      success: true,
      message_id: args.message_id,
      status: statusResponse.status || 'unknown',
      timestamp: new Date().toISOString(),
      details: statusResponse
    };

  } catch (error: any) {
    console.error('Error getting message status:', error);
    
    // Handle specific API errors
    let errorType = 'unknown_error';
    let errorMessage = error.message;

    if (error.response?.status === 404) {
      errorType = 'message_not_found';
      errorMessage = `Mensagem não encontrada: ${args.message_id}`;
    } else if (error.response?.status === 401) {
      errorType = 'unauthorized';
      errorMessage = 'Token de acesso inválido ou expirado';
    } else if (error.response?.status === 403) {
      errorType = 'forbidden';
      errorMessage = 'Acesso negado para consultar status da mensagem';
    }
    
    return {
      success: false,
      message_id: args.message_id,
      error: {
        message: errorMessage,
        type: errorType,
        status_code: error.response?.status,
        details: error.response?.data || null
      },
      timestamp: new Date().toISOString()
    };
  }
}
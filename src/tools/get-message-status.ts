import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { WhatsAppService } from '../services/whatsapp-api.js';
import { failValidation } from '../utils/tool-response.js';

export const getMessageStatusTool: Tool = {
  name: 'get_message_status',
  description: 'Consultar status de entrega de uma mensagem enviada nesta sessão (tracked via eventos da socket).',
  inputSchema: {
    type: 'object',
    properties: {
      message_id: { type: 'string', minLength: 1, description: 'ID retornado no envio.' },
    },
    required: ['message_id'],
  },
};

const schema = z.object({ message_id: z.string().min(1) });

export async function handleGetMessageStatus(service: WhatsAppService, args: unknown): Promise<unknown> {
  const parsed = schema.safeParse(args);
  if (!parsed.success) return failValidation(parsed.error);
  const entry = service.getMessageStatus(parsed.data.message_id);
  if (!entry) {
    return {
      success: false,
      message_id: parsed.data.message_id,
      error: {
        type: 'not_tracked',
        message:
          'Mensagem não rastreada. Status só é persistido em memória desta sessão — se o servidor reiniciou, o histórico foi perdido.',
      },
    };
  }
  return {
    success: true,
    message_id: parsed.data.message_id,
    status: entry.status,
    to_jid: entry.to_jid,
    updated_at: entry.updatedAt,
  };
}

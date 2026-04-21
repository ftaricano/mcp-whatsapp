import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { WhatsAppService } from '../services/whatsapp-api.js';

export const sendMessageTool: Tool = {
  name: 'send_message',
  description: 'Enviar mensagem de texto via WhatsApp. Aceita número E.164 (+5521999999999) ou dígitos puros (5521999999999).',
  inputSchema: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        minLength: 8,
        description: 'Número WhatsApp. E.164 com + (+5521999999999) ou só dígitos (5521999999999).',
      },
      message: {
        type: 'string',
        minLength: 1,
        maxLength: 4096,
        description: 'Texto da mensagem (máx 4096 caracteres).',
      },
      preview_url: {
        type: 'boolean',
        default: false,
        description: 'Gerar preview automático de URLs.',
      },
    },
    required: ['to', 'message'],
  },
};

const schema = z.object({
  to: z.string().min(8),
  message: z.string().min(1).max(4096),
  preview_url: z.boolean().optional().default(false),
});

export async function handleSendMessage(service: WhatsAppService, args: unknown): Promise<unknown> {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    return { success: false, error: { type: 'validation_error', message: parsed.error.message } };
  }
  try {
    const sent = await service.sendMessage(parsed.data);
    return {
      success: true,
      message_id: sent.message_id,
      to_jid: sent.to_jid,
      status: sent.status,
      timestamp: sent.timestamp,
    };
  } catch (err) {
    return errorResponse(err, { to: parsed.data.to });
  }
}

function errorResponse(err: unknown, ctx: Record<string, unknown>): unknown {
  const e = err as Error;
  return {
    success: false,
    error: { type: 'send_failed', message: e.message },
    ...ctx,
    timestamp: new Date().toISOString(),
  };
}

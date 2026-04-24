import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { WhatsAppService } from '../services/whatsapp-api.js';
import { failValidation } from '../utils/tool-response.js';

export const readChatTool: Tool = {
  name: 'read_chat',
  description:
    'Lê as últimas mensagens de um chat (bufferizadas em memória desde o start do servidor). Aceita JID completo (`...@s.whatsapp.net` / `...@g.us`) ou número/E.164. `mark_read=true` zera o contador de não lidas.',
  inputSchema: {
    type: 'object',
    properties: {
      chat_jid: { type: 'string', minLength: 3, description: 'JID do chat ou número de telefone.' },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      mark_read: { type: 'boolean', default: false },
    },
    required: ['chat_jid'],
  },
};

const schema = z.object({
  chat_jid: z.string().min(3),
  limit: z.number().int().min(1).max(200).optional(),
  mark_read: z.boolean().optional(),
});

export async function handleReadChat(service: WhatsAppService, args: unknown): Promise<unknown> {
  const parsed = schema.safeParse(args);
  if (!parsed.success) return failValidation(parsed.error);
  const { chat_jid, limit = 50, mark_read = false } = parsed.data;
  const messages = service.getChatMessages(chat_jid, limit);
  if (mark_read) service.markChatRead(chat_jid);
  return { success: true, chat_jid, count: messages.length, messages };
}

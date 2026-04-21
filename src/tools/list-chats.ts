import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { WhatsAppService } from '../services/whatsapp-api.js';

export const listChatsTool: Tool = {
  name: 'list_chats',
  description:
    'Lista chats com atividade recente (apenas mensagens recebidas depois do servidor iniciar). Ordenado pela última mensagem. Estado em memória: reinicia = perde.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
    },
  },
};

const schema = z.object({ limit: z.number().int().min(1).max(200).optional() });

export async function handleListChats(service: WhatsAppService, args: unknown): Promise<unknown> {
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) {
    return { success: false, error: { type: 'validation_error', message: parsed.error.message } };
  }
  const chats = service.listChats(parsed.data.limit ?? 50);
  const overview = service.getInboxOverview();
  return { success: true, overview, chats };
}

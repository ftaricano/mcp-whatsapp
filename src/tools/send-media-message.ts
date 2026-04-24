import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as mime from 'mime-types';
import { WhatsAppService } from '../services/whatsapp-api.js';
import { fail, failValidation } from '../utils/tool-response.js';

export const sendMediaMessageTool: Tool = {
  name: 'send_media_message',
  description:
    'Enviar anexo (imagem, documento, áudio ou vídeo) até 15MB. Caminhos ' +
    'são validados contra WHATSAPP_ALLOWED_DIRS (default: HOME + CWD) para ' +
    'prevenir leitura de arquivos sensíveis.',
  inputSchema: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        minLength: 8,
        description: 'Número WhatsApp (E.164 ou dígitos).',
      },
      media_path: {
        type: 'string',
        description: 'Caminho absoluto do arquivo (máx 15MB, dentro de WHATSAPP_ALLOWED_DIRS).',
      },
      media_type: {
        type: 'string',
        enum: ['image', 'document', 'audio', 'video'],
        description: 'Tipo de mídia.',
      },
      caption: {
        type: 'string',
        maxLength: 1024,
        description: 'Legenda (opcional, máx 1024). Ignorada para áudio.',
      },
      filename: {
        type: 'string',
        description: 'Nome personalizado (usado para documentos).',
      },
    },
    required: ['to', 'media_path', 'media_type'],
  },
};

const schema = z.object({
  to: z.string().min(8),
  media_path: z.string().min(1),
  media_type: z.enum(['image', 'document', 'audio', 'video']),
  caption: z.string().max(1024).optional(),
  filename: z.string().optional(),
});

export async function handleSendMediaMessage(
  service: WhatsAppService,
  args: unknown,
): Promise<unknown> {
  const parsed = schema.safeParse(args);
  if (!parsed.success) return failValidation(parsed.error);
  const data = parsed.data;
  try {
    const sent = await service.sendMediaMessage({
      to: data.to,
      mediaPath: data.media_path,
      mediaType: data.media_type,
      caption: data.caption,
      filename: data.filename,
    });
    const stat = await fs.stat(data.media_path).catch(() => null);
    const mimeType = (mime.lookup(data.media_path) || '').toString() || null;
    return {
      success: true,
      message_id: sent.message_id,
      to_jid: sent.to_jid,
      status: sent.status,
      media_info: {
        type: data.media_type,
        filename: data.filename ?? path.basename(data.media_path),
        size_mb: stat ? Number((stat.size / 1024 / 1024).toFixed(2)) : null,
        mime_type: mimeType,
        caption: data.caption ?? null,
      },
      timestamp: sent.timestamp,
    };
  } catch (err) {
    return fail('send_failed', err, { to: data.to, media_path: data.media_path });
  }
}

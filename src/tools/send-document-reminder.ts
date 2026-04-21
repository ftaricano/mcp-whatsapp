import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { promises as fs } from 'fs';
import * as path from 'path';
import { WhatsAppService } from '../services/whatsapp-api.js';
import { TemplateEngine } from '../services/template-engine.js';

export const sendDocumentReminderTool: Tool = {
  name: 'send_document_reminder',
  description: 'Enviar lembrete de documento com template formatado. Anexo opcional.',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', minLength: 8, description: 'Número WhatsApp (E.164 ou dígitos).' },
      document_type: {
        type: 'string',
        enum: ['rg', 'cpf', 'contrato', 'comprovante', 'custom'],
        description: 'Tipo de documento solicitado.',
      },
      due_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Data limite (YYYY-MM-DD).' },
      name: { type: 'string', description: 'Nome do destinatário (opcional).' },
      custom_message: { type: 'string', maxLength: 1000, description: 'Texto adicional (opcional).' },
      company_name: { type: 'string', description: 'Nome da empresa (opcional).' },
      attachment_path: { type: 'string', description: 'Arquivo anexo opcional.' },
    },
    required: ['to', 'document_type', 'due_date'],
  },
};

const schema = z.object({
  to: z.string().min(8),
  document_type: z.enum(['rg', 'cpf', 'contrato', 'comprovante', 'custom']),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().optional(),
  custom_message: z.string().max(1000).optional(),
  company_name: z.string().optional(),
  attachment_path: z.string().optional(),
});

export async function handleSendDocumentReminder(service: WhatsAppService, args: unknown): Promise<unknown> {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    return { success: false, error: { type: 'validation_error', message: parsed.error.message } };
  }
  const data = parsed.data;

  const dueDate = new Date(data.due_date);
  if (Number.isNaN(dueDate.getTime())) {
    return { success: false, error: { type: 'validation_error', message: `Data inválida: ${data.due_date}` } };
  }

  const messageText = TemplateEngine.createDocumentReminderMessage({
    name: data.name,
    document_type: data.document_type,
    due_date: data.due_date,
    custom_message: data.custom_message,
    company_name: data.company_name,
  });

  try {
    let sent;
    let attachmentInfo: { filename: string; size_mb: number } | null = null;

    if (data.attachment_path) {
      try {
        const stat = await fs.stat(data.attachment_path);
        sent = await service.sendMediaMessage({
          to: data.to,
          mediaPath: data.attachment_path,
          mediaType: 'document',
          caption: messageText.slice(0, 1024),
          filename: path.basename(data.attachment_path),
        });
        attachmentInfo = {
          filename: path.basename(data.attachment_path),
          size_mb: Number((stat.size / 1024 / 1024).toFixed(2)),
        };
      } catch {
        sent = await service.sendMessage({ to: data.to, message: messageText });
      }
    } else {
      sent = await service.sendMessage({ to: data.to, message: messageText });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysRemaining = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    return {
      success: true,
      message_id: sent.message_id,
      to_jid: sent.to_jid,
      status: sent.status,
      reminder_details: {
        document_type: data.document_type,
        due_date: data.due_date,
        days_remaining: daysRemaining,
        recipient_name: data.name ?? 'Cliente',
        company_name: data.company_name ?? 'Nossa Empresa',
        has_attachment: !!data.attachment_path,
        attachment_info: attachmentInfo,
      },
      timestamp: sent.timestamp,
    };
  } catch (err) {
    return {
      success: false,
      error: { type: 'send_failed', message: (err as Error).message },
      to: data.to,
      timestamp: new Date().toISOString(),
    };
  }
}

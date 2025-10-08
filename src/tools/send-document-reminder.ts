import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { WhatsAppService } from '../services/whatsapp-api.js';
import { TemplateEngine } from '../services/template-engine.js';
import { promises as fs } from 'fs';

export const sendDocumentReminderTool: Tool = {
  name: "send_document_reminder",
  description: "Enviar lembrete de documento com anexo opcional usando template formatado",
  inputSchema: {
    type: "object",
    properties: {
      to: {
        type: "string",
        pattern: "^\\+[1-9]\\d{1,14}$",
        description: "Número WhatsApp no formato E.164 (ex: +5511999999999)"
      },
      document_type: {
        type: "string",
        enum: ["rg", "cpf", "contrato", "comprovante", "custom"],
        description: "Tipo de documento solicitado"
      },
      due_date: {
        type: "string",
        format: "date",
        description: "Data limite para envio do documento (formato: YYYY-MM-DD)"
      },
      name: {
        type: "string",
        description: "Nome do destinatário (opcional, padrão: 'Cliente')"
      },
      custom_message: {
        type: "string",
        maxLength: 1000,
        description: "Mensagem adicional personalizada (opcional)"
      },
      company_name: {
        type: "string",
        description: "Nome da empresa (opcional, padrão: 'Nossa Empresa')"
      },
      attachment_path: {
        type: "string", 
        description: "Caminho para arquivo anexo (opcional, exemplo: formulário, instruções)"
      },
      template_name: {
        type: "string",
        default: "document_reminder",
        description: "Nome do template a usar (padrão: document_reminder)"
      }
    },
    required: ["to", "document_type", "due_date"]
  }
};

export async function handleSendDocumentReminder(
  whatsappService: WhatsAppService,
  args: any
): Promise<any> {
  try {
    // Validate required parameters
    if (!args.to || !args.document_type || !args.due_date) {
      throw new Error('Parâmetros obrigatórios: to, document_type, due_date');
    }

    // Validate phone number format
    if (!args.to.match(/^\+[1-9]\d{1,14}$/)) {
      throw new Error(`Número de telefone inválido: ${args.to}. Use o formato E.164 (ex: +5511999999999)`);
    }

    // Validate document type
    const allowedDocuments = ['rg', 'cpf', 'contrato', 'comprovante', 'custom'];
    if (!allowedDocuments.includes(args.document_type)) {
      throw new Error(`Tipo de documento inválido: ${args.document_type}. Tipos permitidos: ${allowedDocuments.join(', ')}`);
    }

    // Validate date format
    const dueDateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dueDateRegex.test(args.due_date)) {
      throw new Error(`Formato de data inválido: ${args.due_date}. Use o formato YYYY-MM-DD`);
    }

    const dueDate = new Date(args.due_date);
    if (isNaN(dueDate.getTime())) {
      throw new Error(`Data inválida: ${args.due_date}`);
    }

    // Check if due date is not in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dueDate < today) {
      console.warn(`Warning: Due date ${args.due_date} is in the past`);
    }

    // Validate custom message length
    if (args.custom_message && args.custom_message.length > 1000) {
      throw new Error(`Mensagem personalizada muito longa: ${args.custom_message.length} caracteres. Máximo permitido: 1000`);
    }

    console.log(`Sending document reminder to ${args.to} for ${args.document_type} due ${args.due_date}`);

    // Generate message using template
    const messageText = TemplateEngine.createDocumentReminderMessage({
      name: args.name,
      document_type: args.document_type,
      due_date: args.due_date,
      custom_message: args.custom_message,
      company_name: args.company_name
    });

    let messageResponse;
    let attachmentInfo = null;

    // Send message with attachment if provided
    if (args.attachment_path) {
      try {
        // Check if attachment file exists
        await fs.access(args.attachment_path);
        
        // Send as media message with the reminder text as caption
        messageResponse = await whatsappService.sendMediaMessage({
          to: args.to,
          mediaPath: args.attachment_path,
          mediaType: 'document',
          caption: messageText.substring(0, 1024), // WhatsApp caption limit
          filename: `documento_solicitado_${args.document_type}.pdf`
        });

        const fileStats = await fs.stat(args.attachment_path);
        attachmentInfo = {
          filename: args.attachment_path.split('/').pop(),
          size_mb: Number((fileStats.size / 1024 / 1024).toFixed(2))
        };

        console.log(`Document reminder sent with attachment: ${attachmentInfo.filename}`);
        
      } catch (fileError) {
        console.warn(`Attachment file not found: ${args.attachment_path}, sending text message only`);
        
        // Fallback to text message if attachment fails
        messageResponse = await whatsappService.sendMessage({
          to: args.to,
          message: messageText
        });
      }
    } else {
      // Send as text message
      messageResponse = await whatsappService.sendMessage({
        to: args.to,
        message: messageText
      });
    }

    // Calculate days until due date
    const diffTime = dueDate.getTime() - today.getTime();
    const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Extract relevant information from response
    const messageId = messageResponse.messages?.[0]?.id;
    const contactWaId = messageResponse.contacts?.[0]?.wa_id;

    return {
      success: true,
      message_id: messageId,
      contact_wa_id: contactWaId,
      to: args.to,
      reminder_details: {
        document_type: args.document_type,
        due_date: args.due_date,
        days_remaining: daysRemaining,
        recipient_name: args.name || 'Cliente',
        company_name: args.company_name || 'Nossa Empresa',
        has_attachment: !!args.attachment_path,
        attachment_info: attachmentInfo
      },
      template_used: args.template_name || 'document_reminder',
      message_length: messageText.length,
      timestamp: new Date().toISOString(),
      details: {
        messaging_product: messageResponse.messaging_product,
        status: "sent"
      }
    };

  } catch (error: any) {
    console.error('Error sending document reminder:', error);
    
    return {
      success: false,
      error: {
        message: error.message,
        type: error.response?.status ? 'api_error' : 'validation_error',
        status_code: error.response?.status,
        details: error.response?.data || null
      },
      to: args.to,
      document_type: args.document_type,
      due_date: args.due_date,
      timestamp: new Date().toISOString()
    };
  }
}
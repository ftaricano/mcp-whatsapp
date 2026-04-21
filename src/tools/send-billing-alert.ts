import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { WhatsAppService } from '../services/whatsapp-api.js';
import { TemplateEngine } from '../services/template-engine.js';

export const sendBillingAlertTool: Tool = {
  name: 'send_billing_alert',
  description: 'Enviar alerta de cobrança/boleto com template formatado.',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', minLength: 8, description: 'Número WhatsApp (E.164 ou dígitos).' },
      amount: { type: 'number', minimum: 0.01, description: 'Valor em reais.' },
      due_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Vencimento (YYYY-MM-DD).' },
      invoice_number: { type: 'string', minLength: 1, description: 'Número da fatura/boleto.' },
      name: { type: 'string', description: 'Nome do cliente (opcional).' },
      barcode: { type: 'string', pattern: '^[0-9]{47,48}$', description: 'Código de barras (47-48 dígitos, opcional).' },
      payment_link: { type: 'string', format: 'uri', description: 'Link de pagamento (opcional).' },
      company_name: { type: 'string', description: 'Nome da empresa (opcional).' },
      include_interest_info: {
        type: 'boolean',
        default: false,
        description: 'Anexar aviso de juros/multa.',
      },
    },
    required: ['to', 'amount', 'due_date', 'invoice_number'],
  },
};

const schema = z.object({
  to: z.string().min(8),
  amount: z.number().positive(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  invoice_number: z.string().min(1),
  name: z.string().optional(),
  barcode: z.string().regex(/^[0-9]{47,48}$/).optional(),
  payment_link: z.string().url().optional(),
  company_name: z.string().optional(),
  include_interest_info: z.boolean().optional().default(false),
});

export async function handleSendBillingAlert(service: WhatsAppService, args: unknown): Promise<unknown> {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    return { success: false, error: { type: 'validation_error', message: parsed.error.message } };
  }
  const data = parsed.data;

  const dueDate = new Date(data.due_date);
  if (Number.isNaN(dueDate.getTime())) {
    return { success: false, error: { type: 'validation_error', message: `Data inválida: ${data.due_date}` } };
  }

  let messageText = TemplateEngine.createBillingAlertMessage({
    name: data.name,
    invoice_number: data.invoice_number,
    amount: data.amount,
    due_date: data.due_date,
    payment_link: data.payment_link,
    barcode: data.barcode,
    company_name: data.company_name,
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (data.include_interest_info && daysUntilDue >= 0) {
    messageText += `\n\n⚠️ *Importante:* Após o vencimento, incidirão juros de 1% ao mês e multa de 2%.`;
  }

  try {
    const sent = await service.sendMessage({ to: data.to, message: messageText });

    const status =
      daysUntilDue > 0 ? 'pending' : daysUntilDue === 0 ? 'due_today' : 'overdue';

    return {
      success: true,
      message_id: sent.message_id,
      to_jid: sent.to_jid,
      status: sent.status,
      billing_details: {
        invoice_number: data.invoice_number,
        amount: data.amount,
        amount_formatted: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(data.amount),
        due_date: data.due_date,
        days_until_due: daysUntilDue,
        billing_status: status,
        recipient_name: data.name ?? 'Cliente',
        company_name: data.company_name ?? 'Nossa Empresa',
        has_barcode: !!data.barcode,
        has_payment_link: !!data.payment_link,
      },
      payment_options: {
        barcode: data.barcode ?? null,
        payment_link: data.payment_link ?? null,
      },
      message_length: messageText.length,
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

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { WhatsAppService } from '../services/whatsapp-api.js';
import { TemplateEngine } from '../services/template-engine.js';

export const sendBillingAlertTool: Tool = {
  name: "send_billing_alert",
  description: "Enviar alerta de boleto/cobrança com dados formatados e template profissional",
  inputSchema: {
    type: "object",
    properties: {
      to: {
        type: "string",
        pattern: "^\\+[1-9]\\d{1,14}$",
        description: "Número WhatsApp no formato E.164 (ex: +5511999999999)"
      },
      amount: {
        type: "number",
        minimum: 0.01,
        description: "Valor da cobrança em reais (ex: 150.50)"
      },
      due_date: {
        type: "string",
        format: "date", 
        description: "Data de vencimento (formato: YYYY-MM-DD)"
      },
      invoice_number: {
        type: "string",
        minLength: 1,
        description: "Número da fatura/boleto"
      },
      name: {
        type: "string",
        description: "Nome do cliente (opcional, padrão: 'Cliente')"
      },
      barcode: {
        type: "string",
        pattern: "^[0-9]{47,48}$",
        description: "Código de barras do boleto (opcional, 47-48 dígitos)"
      },
      payment_link: {
        type: "string",
        format: "uri",
        description: "Link para pagamento online (opcional)"
      },
      company_name: {
        type: "string",
        description: "Nome da empresa (opcional, padrão: 'Nossa Empresa')"
      },
      include_interest_info: {
        type: "boolean",
        default: false,
        description: "Incluir informações sobre juros e multa em caso de atraso"
      }
    },
    required: ["to", "amount", "due_date", "invoice_number"]
  }
};

export async function handleSendBillingAlert(
  whatsappService: WhatsAppService,
  args: any
): Promise<any> {
  try {
    // Validate required parameters
    if (!args.to || !args.amount || !args.due_date || !args.invoice_number) {
      throw new Error('Parâmetros obrigatórios: to, amount, due_date, invoice_number');
    }

    // Validate phone number format
    if (!args.to.match(/^\+[1-9]\d{1,14}$/)) {
      throw new Error(`Número de telefone inválido: ${args.to}. Use o formato E.164 (ex: +5511999999999)`);
    }

    // Validate amount
    if (typeof args.amount !== 'number' || args.amount <= 0) {
      throw new Error(`Valor inválido: ${args.amount}. Deve ser um número positivo`);
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

    // Validate invoice number
    if (!args.invoice_number.trim()) {
      throw new Error('Número da fatura não pode estar vazio');
    }

    // Validate barcode if provided
    if (args.barcode && !args.barcode.match(/^[0-9]{47,48}$/)) {
      throw new Error(`Código de barras inválido: ${args.barcode}. Deve conter 47 ou 48 dígitos numéricos`);
    }

    // Validate payment link if provided
    if (args.payment_link) {
      try {
        new URL(args.payment_link);
      } catch {
        throw new Error(`Link de pagamento inválido: ${args.payment_link}`);
      }
    }

    console.log(`Sending billing alert to ${args.to} for invoice ${args.invoice_number} (R$ ${args.amount})`);

    // Generate message using template
    const messageText = TemplateEngine.createBillingAlertMessage({
      name: args.name,
      invoice_number: args.invoice_number,
      amount: args.amount,
      due_date: args.due_date,
      payment_link: args.payment_link,
      barcode: args.barcode,
      company_name: args.company_name
    });

    // Add interest information if requested
    let finalMessage = messageText;
    if (args.include_interest_info) {
      const today = new Date();
      const diffTime = dueDate.getTime() - today.getTime();
      const daysUntilDue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (daysUntilDue >= 0) {
        finalMessage += `\n\n⚠️ *Importante:* Após o vencimento, incidirão juros de 1% ao mês e multa de 2%.`;
      }
    }

    const messageResponse = await whatsappService.sendMessage({
      to: args.to,
      message: finalMessage
    });

    // Calculate billing status
    const today = new Date();
    const diffTime = dueDate.getTime() - today.getTime();
    const daysUntilDue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let billingStatus: string;
    if (daysUntilDue > 0) {
      billingStatus = 'pending';
    } else if (daysUntilDue === 0) {
      billingStatus = 'due_today';
    } else {
      billingStatus = 'overdue';
    }

    // Extract relevant information from response
    const messageId = messageResponse.messages?.[0]?.id;
    const contactWaId = messageResponse.contacts?.[0]?.wa_id;

    return {
      success: true,
      message_id: messageId,
      contact_wa_id: contactWaId,
      to: args.to,
      billing_details: {
        invoice_number: args.invoice_number,
        amount: args.amount,
        amount_formatted: new Intl.NumberFormat('pt-BR', {
          style: 'currency',
          currency: 'BRL'
        }).format(args.amount),
        due_date: args.due_date,
        days_until_due: daysUntilDue,
        status: billingStatus,
        recipient_name: args.name || 'Cliente',
        company_name: args.company_name || 'Nossa Empresa',
        has_barcode: !!args.barcode,
        has_payment_link: !!args.payment_link,
        includes_interest_info: args.include_interest_info || false
      },
      payment_options: {
        barcode: args.barcode || null,
        payment_link: args.payment_link || null
      },
      message_length: finalMessage.length,
      timestamp: new Date().toISOString(),
      details: {
        messaging_product: messageResponse.messaging_product,
        status: "sent"
      }
    };

  } catch (error: any) {
    console.error('Error sending billing alert:', error);
    
    return {
      success: false,
      error: {
        message: error.message,
        type: error.response?.status ? 'api_error' : 'validation_error',
        status_code: error.response?.status,
        details: error.response?.data || null
      },
      to: args.to,
      invoice_number: args.invoice_number,
      amount: args.amount,
      due_date: args.due_date,
      timestamp: new Date().toISOString()
    };
  }
}
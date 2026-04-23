import pino from 'pino';

const logger = pino({ level: process.env.WHATSAPP_LOG_LEVEL ?? 'info' }).child({
  mod: 'template-engine',
});

export interface TemplateVariable {
  name: string;
  value: string | number | Date;
}

export interface MessageTemplate {
  name: string;
  content: string;
  variables: string[];
  category: 'document_reminder' | 'billing_alert' | 'generic';
}

export interface BillingInterestPolicy {
  /** Percentual mensal de juros (e.g. 1.0 para 1% ao mês). Default: 1. */
  monthlyInterestPct: number;
  /** Multa única em % aplicada no primeiro dia de atraso. Default: 2. */
  penaltyPct: number;
}

const DEFAULT_INTEREST_POLICY: BillingInterestPolicy = {
  monthlyInterestPct: 1,
  penaltyPct: 2,
};

export class TemplateEngine {
  private static readonly templates: Record<string, MessageTemplate> = {
    document_reminder: {
      name: 'document_reminder',
      content: `🔔 *Lembrete de Documento*

Olá {{name}},

Você precisa enviar o documento: *{{document_type}}*
📅 Data limite: {{due_date}}
⏰ Restam {{days_remaining}} dia(s){{custom_message_block}}

Por favor, envie o documento o quanto antes para evitar atrasos.

_Mensagem automática - {{company_name}}_`,
      variables: ['name', 'document_type', 'due_date', 'days_remaining', 'custom_message_block', 'company_name'],
      category: 'document_reminder',
    },

    billing_alert: {
      name: 'billing_alert',
      content: `💰 *Alerta de Cobrança*

Olá {{name}},

Temos uma cobrança pendente:

📋 Fatura: {{invoice_number}}
💵 Valor: {{amount}}
📅 Vencimento: {{due_date}}
⏰ {{days_status}}

{{payment_details}}

{{company_name}}
_Mensagem automática_`,
      variables: ['name', 'invoice_number', 'amount', 'due_date', 'days_status', 'payment_details', 'company_name'],
      category: 'billing_alert',
    },

    payment_reminder: {
      name: 'payment_reminder',
      content: `💳 *Lembrete de Pagamento*

Olá {{name}},

Sua fatura está próxima do vencimento:

📋 Fatura: {{invoice_number}}
💵 Valor: {{amount}}
📅 Vencimento: {{due_date}}
⏰ Vence em {{days_remaining}} dia(s)

{{payment_details}}

Para evitar juros e multa, realize o pagamento até a data de vencimento.

_{{company_name}}_`,
      variables: ['name', 'invoice_number', 'amount', 'due_date', 'days_remaining', 'payment_details', 'company_name'],
      category: 'billing_alert',
    },

    overdue_notice: {
      name: 'overdue_notice',
      content: `⚠️ *Fatura Vencida*

Olá {{name}},

Sua fatura está em atraso:

📋 Fatura: {{invoice_number}}
💵 Valor original: {{amount}}
💵 Valor atualizado: {{amount_with_interest}}
📅 Venceu em: {{due_date}}
⏰ {{days_overdue}} dia(s) em atraso

{{payment_details}}

Entre em contato conosco para negociar ou regularize sua situação.

_{{company_name}}_`,
      variables: [
        'name', 'invoice_number', 'amount', 'amount_with_interest', 'due_date',
        'days_overdue', 'payment_details', 'company_name',
      ],
      category: 'billing_alert',
    },
  };

  public static getTemplate(name: string): MessageTemplate | undefined {
    return this.templates[name];
  }

  public static renderTemplate(templateName: string, variables: Record<string, unknown>): string {
    const template = this.getTemplate(templateName);
    if (!template) {
      throw new Error(`Template not found: ${templateName}`);
    }

    let content = template.content;
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${escapeRegExp(key)}}}`, 'g');
      content = content.replace(regex, String(value ?? ''));
    }

    const unresolved = content.match(/{{[\w_]+}}/g);
    if (unresolved) {
      logger.warn({ templateName, unresolved }, 'Unresolved variables in template');
    }

    return content;
  }

  public static createDocumentReminderMessage(params: {
    name?: string;
    document_type: string;
    due_date: string;
    custom_message?: string;
    company_name?: string;
  }): string {
    const dueDate = new Date(params.due_date);
    const daysRemaining = daysBetween(new Date(), dueDate);

    const customBlock = params.custom_message?.trim()
      ? `\n\n${params.custom_message.trim()}`
      : '';

    return this.renderTemplate('document_reminder', {
      name: params.name || 'Cliente',
      document_type: this.formatDocumentType(params.document_type),
      due_date: this.formatDate(dueDate),
      days_remaining: daysRemaining,
      custom_message_block: customBlock,
      company_name: params.company_name || 'Nossa Empresa',
    });
  }

  public static createBillingAlertMessage(params: {
    name?: string;
    invoice_number: string;
    amount: number;
    due_date: string;
    payment_link?: string;
    barcode?: string;
    company_name?: string;
    interest_policy?: Partial<BillingInterestPolicy>;
  }): string {
    const dueDate = new Date(params.due_date);
    const daysUntilDue = daysBetween(new Date(), dueDate);

    let daysStatus: string;
    let templateName: string;

    if (daysUntilDue > 0) {
      daysStatus = `Vence em ${daysUntilDue} dia(s)`;
      templateName = 'payment_reminder';
    } else if (daysUntilDue === 0) {
      daysStatus = 'Vence hoje!';
      templateName = 'billing_alert';
    } else {
      daysStatus = `${Math.abs(daysUntilDue)} dia(s) em atraso`;
      templateName = 'overdue_notice';
    }

    const paymentDetails = this.buildPaymentDetails(params.payment_link, params.barcode);
    const policy = { ...DEFAULT_INTEREST_POLICY, ...(params.interest_policy ?? {}) };
    const updatedAmount = daysUntilDue < 0
      ? computeOverdueAmount(params.amount, Math.abs(daysUntilDue), policy)
      : params.amount;

    return this.renderTemplate(templateName, {
      name: params.name || 'Cliente',
      invoice_number: params.invoice_number,
      amount: this.formatCurrency(params.amount),
      due_date: this.formatDate(dueDate),
      days_status: daysStatus,
      days_remaining: Math.max(0, daysUntilDue),
      days_overdue: Math.abs(Math.min(0, daysUntilDue)),
      amount_with_interest: this.formatCurrency(updatedAmount),
      payment_details: paymentDetails,
      company_name: params.company_name || 'Nossa Empresa',
    });
  }

  private static formatDocumentType(type: string): string {
    const types: Record<string, string> = {
      rg: 'RG (Documento de Identidade)',
      cpf: 'CPF',
      contrato: 'Contrato Assinado',
      comprovante: 'Comprovante de Residência',
      custom: type,
    };
    return types[type.toLowerCase()] || type;
  }

  private static formatDate(date: Date): string {
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  private static formatCurrency(amount: number): string {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(amount);
  }

  private static buildPaymentDetails(paymentLink?: string, barcode?: string): string {
    const details: string[] = [];
    if (paymentLink) details.push(`🔗 Link para pagamento: ${paymentLink}`);
    if (barcode) details.push(`📊 Código de barras: ${barcode}`);
    if (details.length === 0) details.push('Entre em contato para detalhes de pagamento.');
    return details.join('\n');
  }

  public static listTemplates(): MessageTemplate[] {
    return Object.values(this.templates);
  }

  public static validateTemplate(
    templateName: string,
    variables: Record<string, unknown>,
  ): { isValid: boolean; missingVariables: string[]; errors: string[] } {
    const template = this.getTemplate(templateName);
    if (!template) {
      return { isValid: false, missingVariables: [], errors: [`Template not found: ${templateName}`] };
    }

    const missingVariables = template.variables.filter(
      (varName) => !(varName in variables) || variables[varName] === undefined || variables[varName] === '',
    );

    const errors: string[] = [];
    if (template.category === 'billing_alert') {
      if (typeof variables.amount !== 'number' || (variables.amount as number) <= 0) {
        errors.push('Amount must be a positive number');
      }
    }

    return { isValid: missingVariables.length === 0 && errors.length === 0, missingVariables, errors };
  }
}

/**
 * Calcula valor atualizado com multa única + juros simples por mês proporcional
 * ao número de dias em atraso. Fórmula alinhada com o texto default pt-BR:
 *   atualizado = principal * (1 + multa%) + principal * (juros_mes%) * (dias/30)
 * (juros simples pro rata — não composto — conservador e fácil de conferir.)
 */
export function computeOverdueAmount(
  principal: number,
  daysOverdue: number,
  policy: BillingInterestPolicy,
): number {
  const penalty = principal * (policy.penaltyPct / 100);
  const interest = principal * (policy.monthlyInterestPct / 100) * (daysOverdue / 30);
  return Number((principal + penalty + interest).toFixed(2));
}

function daysBetween(from: Date, to: Date): number {
  const f = new Date(from);
  f.setHours(0, 0, 0, 0);
  const t = new Date(to);
  t.setHours(0, 0, 0, 0);
  return Math.ceil((t.getTime() - f.getTime()) / (1000 * 60 * 60 * 24));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

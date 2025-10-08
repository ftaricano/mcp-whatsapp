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

export class TemplateEngine {
  private static readonly templates: Record<string, MessageTemplate> = {
    document_reminder: {
      name: 'document_reminder',
      content: `🔔 *Lembrete de Documento*

Olá {{name}},

Você precisa enviar o documento: *{{document_type}}*
📅 Data limite: {{due_date}}
⏰ Restam {{days_remaining}} dia(s)

{{custom_message}}

Por favor, envie o documento o quanto antes para evitar atrasos.

_Mensagem automática - {{company_name}}_`,
      variables: ['name', 'document_type', 'due_date', 'days_remaining', 'custom_message', 'company_name'],
      category: 'document_reminder'
    },

    billing_alert: {
      name: 'billing_alert',
      content: `💰 *Alerta de Cobrança*

Olá {{name}},

Temos uma cobrança pendente:

📋 Fatura: {{invoice_number}}
💵 Valor: R$ {{amount}}
📅 Vencimento: {{due_date}}
⏰ {{days_status}}

{{payment_details}}

{{company_name}}
_Mensagem automática_`,
      variables: ['name', 'invoice_number', 'amount', 'due_date', 'days_status', 'payment_details', 'company_name'],
      category: 'billing_alert'
    },

    payment_reminder: {
      name: 'payment_reminder',
      content: `💳 *Lembrete de Pagamento*

Olá {{name}},

Sua fatura está próxima do vencimento:

📋 Fatura: {{invoice_number}}
💵 Valor: R$ {{amount}}
📅 Vencimento: {{due_date}}
⏰ Vence em {{days_remaining}} dia(s)

{{payment_link}}

Para evitar juros e multa, realize o pagamento até a data de vencimento.

_{{company_name}}_`,
      variables: ['name', 'invoice_number', 'amount', 'due_date', 'days_remaining', 'payment_link', 'company_name'],
      category: 'billing_alert'
    },

    overdue_notice: {
      name: 'overdue_notice',
      content: `⚠️ *Fatura Vencida*

Olá {{name}},

Sua fatura está em atraso:

📋 Fatura: {{invoice_number}}
💵 Valor original: R$ {{amount}}
💵 Valor com juros: R$ {{amount_with_interest}}
📅 Venceu em: {{due_date}}
⏰ {{days_overdue}} dia(s) em atraso

{{payment_link}}

Entre em contato conosco para negociar ou regularize sua situação.

_{{company_name}}_`,
      variables: ['name', 'invoice_number', 'amount', 'amount_with_interest', 'due_date', 'days_overdue', 'payment_link', 'company_name'],
      category: 'billing_alert'
    }
  };

  public static getTemplate(name: string): MessageTemplate | undefined {
    return this.templates[name];
  }

  public static renderTemplate(templateName: string, variables: Record<string, any>): string {
    const template = this.getTemplate(templateName);
    if (!template) {
      throw new Error(`Template not found: ${templateName}`);
    }

    let content = template.content;
    
    // Replace all variables in the template
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      content = content.replace(regex, String(value));
    }

    // Check for unresolved variables
    const unresolved = content.match(/{{[\w_]+}}/g);
    if (unresolved) {
      console.warn(`Unresolved variables in template ${templateName}:`, unresolved);
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
    const today = new Date();
    const diffTime = dueDate.getTime() - today.getTime();
    const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    const variables = {
      name: params.name || 'Cliente',
      document_type: this.formatDocumentType(params.document_type),
      due_date: this.formatDate(dueDate),
      days_remaining: daysRemaining,
      custom_message: params.custom_message || '',
      company_name: params.company_name || 'Nossa Empresa'
    };

    return this.renderTemplate('document_reminder', variables);
  }

  public static createBillingAlertMessage(params: {
    name?: string;
    invoice_number: string;
    amount: number;
    due_date: string;
    payment_link?: string;
    barcode?: string;
    company_name?: string;
  }): string {
    const dueDate = new Date(params.due_date);
    const today = new Date();
    const diffTime = dueDate.getTime() - today.getTime();
    const daysUntilDue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

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

    const variables = {
      name: params.name || 'Cliente',
      invoice_number: params.invoice_number,
      amount: this.formatCurrency(params.amount),
      due_date: this.formatDate(dueDate),
      days_status: daysStatus,
      days_remaining: Math.max(0, daysUntilDue),
      days_overdue: Math.abs(Math.min(0, daysUntilDue)),
      amount_with_interest: this.formatCurrency(params.amount * 1.1), // 10% interest example
      payment_details: paymentDetails,
      payment_link: params.payment_link || '',
      company_name: params.company_name || 'Nossa Empresa'
    };

    return this.renderTemplate(templateName, variables);
  }

  private static formatDocumentType(type: string): string {
    const types: Record<string, string> = {
      'rg': 'RG (Documento de Identidade)',
      'cpf': 'CPF',
      'contrato': 'Contrato Assinado',
      'comprovante': 'Comprovante de Residência',
      'custom': type
    };

    return types[type.toLowerCase()] || type;
  }

  private static formatDate(date: Date): string {
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  private static formatCurrency(amount: number): string {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(amount);
  }

  private static buildPaymentDetails(paymentLink?: string, barcode?: string): string {
    const details: string[] = [];

    if (paymentLink) {
      details.push(`🔗 Link para pagamento: ${paymentLink}`);
    }

    if (barcode) {
      details.push(`📊 Código de barras: ${barcode}`);
    }

    if (details.length === 0) {
      details.push('Entre em contato para detalhes de pagamento.');
    }

    return details.join('\n');
  }

  public static listTemplates(): MessageTemplate[] {
    return Object.values(this.templates);
  }

  public static validateTemplate(templateName: string, variables: Record<string, any>): {
    isValid: boolean;
    missingVariables: string[];
    errors: string[];
  } {
    const template = this.getTemplate(templateName);
    if (!template) {
      return {
        isValid: false,
        missingVariables: [],
        errors: [`Template not found: ${templateName}`]
      };
    }

    const missingVariables = template.variables.filter(
      varName => !(varName in variables) || variables[varName] === undefined || variables[varName] === ''
    );

    const errors: string[] = [];
    
    // Check for required variables based on template type
    if (template.category === 'billing_alert') {
      if (typeof variables.amount !== 'number' || variables.amount <= 0) {
        errors.push('Amount must be a positive number');
      }
    }

    return {
      isValid: missingVariables.length === 0 && errors.length === 0,
      missingVariables,
      errors
    };
  }
}
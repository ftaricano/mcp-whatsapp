import { describe, expect, it } from 'vitest';
import { TemplateEngine, computeOverdueAmount } from '../src/services/template-engine.js';

describe('computeOverdueAmount', () => {
  it('applies penalty + pro-rata monthly interest', () => {
    const v = computeOverdueAmount(1000, 30, { monthlyInterestPct: 1, penaltyPct: 2 });
    // 1000 + 20 (2% penalty) + 10 (1% monthly * 30/30) = 1030
    expect(v).toBe(1030);
  });

  it('scales interest with days', () => {
    const v = computeOverdueAmount(1000, 15, { monthlyInterestPct: 1, penaltyPct: 2 });
    // 1000 + 20 + (10 * 15/30 = 5) = 1025
    expect(v).toBe(1025);
  });

  it('zero days overdue still applies penalty', () => {
    const v = computeOverdueAmount(1000, 0, { monthlyInterestPct: 1, penaltyPct: 2 });
    expect(v).toBe(1020);
  });

  it('honors custom policy', () => {
    const v = computeOverdueAmount(500, 30, { monthlyInterestPct: 5, penaltyPct: 10 });
    // 500 + 50 + 25 = 575
    expect(v).toBe(575);
  });
});

describe('TemplateEngine.renderTemplate', () => {
  it('substitutes all variables', () => {
    const out = TemplateEngine.renderTemplate('document_reminder', {
      name: 'João',
      document_type: 'RG',
      due_date: '10/05/2026',
      days_remaining: 3,
      custom_message_block: '',
      company_name: 'ACME',
    });
    expect(out).toContain('Olá João');
    expect(out).toContain('*RG*');
    expect(out).toContain('10/05/2026');
    expect(out).not.toMatch(/{{\w+}}/);
  });

  it('throws on unknown template', () => {
    expect(() => TemplateEngine.renderTemplate('nope', {})).toThrow(/Template not found/);
  });

  it('regex-escapes variable names (no ReDoS on weird keys)', () => {
    const out = TemplateEngine.renderTemplate('document_reminder', {
      name: 'x',
      document_type: 'y',
      due_date: 'z',
      days_remaining: 0,
      custom_message_block: '',
      company_name: 'ACME',
      // An adversarial variable that would previously have been treated as regex.
      '.*': 'INJECTED',
    });
    expect(out).not.toContain('INJECTED');
  });
});

describe('TemplateEngine.createDocumentReminderMessage', () => {
  it('includes custom_message when provided', () => {
    const msg = TemplateEngine.createDocumentReminderMessage({
      name: 'João',
      document_type: 'rg',
      due_date: '2026-12-31',
      custom_message: 'Precisamos pra finalizar.',
      company_name: 'ACME',
    });
    expect(msg).toContain('Precisamos pra finalizar.');
  });

  it('omits custom_message block cleanly when not provided (no double blank)', () => {
    const msg = TemplateEngine.createDocumentReminderMessage({
      name: 'João',
      document_type: 'rg',
      due_date: '2026-12-31',
      company_name: 'ACME',
    });
    expect(msg).not.toMatch(/\n{3,}/);
  });

  it('defaults cliente/empresa when omitted', () => {
    const msg = TemplateEngine.createDocumentReminderMessage({
      document_type: 'rg',
      due_date: '2026-12-31',
    });
    expect(msg).toContain('Olá Cliente');
    expect(msg).toContain('Nossa Empresa');
  });

  it('formats known doc types', () => {
    const msg = TemplateEngine.createDocumentReminderMessage({
      document_type: 'rg',
      due_date: '2026-12-31',
    });
    expect(msg).toContain('RG (Documento de Identidade)');
  });
});

describe('TemplateEngine.createBillingAlertMessage', () => {
  function future(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  it('picks payment_reminder when due is in the future', () => {
    const msg = TemplateEngine.createBillingAlertMessage({
      name: 'João',
      invoice_number: 'BOL-1',
      amount: 100,
      due_date: future(5),
      payment_link: 'https://pay.ex/1',
    });
    expect(msg).toContain('Lembrete de Pagamento');
    expect(msg).toContain('https://pay.ex/1');
  });

  it('picks overdue_notice when due is in the past (with interest)', () => {
    const msg = TemplateEngine.createBillingAlertMessage({
      name: 'João',
      invoice_number: 'BOL-1',
      amount: 1000,
      due_date: future(-30),
    });
    expect(msg).toContain('Fatura Vencida');
    expect(msg).toMatch(/\d+ dia\(s\) em atraso/);
    // Updated amount should be > principal (penalty + interest)
    expect(msg).toContain('R$');
  });

  it('validateTemplate flags missing variables and non-positive amounts', () => {
    const missing = TemplateEngine.validateTemplate('billing_alert', { amount: 100 });
    expect(missing.isValid).toBe(false);
    expect(missing.missingVariables.length).toBeGreaterThan(0);

    const bad = TemplateEngine.validateTemplate('billing_alert', {
      name: 'x',
      invoice_number: 'x',
      amount: 0,
      due_date: 'x',
      days_status: 'x',
      payment_details: 'x',
      company_name: 'x',
    });
    expect(bad.errors).toContain('Amount must be a positive number');
  });
});

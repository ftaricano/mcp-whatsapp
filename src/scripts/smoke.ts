#!/usr/bin/env node
/**
 * Smoke test CLI — exercita pareamento + envio sem precisar de cliente MCP.
 *
 * Uso:
 *   npm run smoke -- pair                         # só parea (vai imprimir QR se necessário)
 *   npm run smoke -- send <numero> <texto>        # envia texto
 *   npm run smoke -- media <numero> <arquivo>     # envia mídia (image/document/audio/video auto)
 *   npm run smoke -- billing <numero>             # envia billing alert de teste
 *   npm run smoke -- reminder <numero>            # envia document reminder de teste
 *   npm run smoke -- logout                       # desconecta e apaga sessão
 *   npm run smoke -- status                       # imprime health atual e sai
 */

import * as path from 'path';
import * as mime from 'mime-types';
import { WhatsAppService, MediaType } from '../services/whatsapp-api.js';

function detectMediaType(filePath: string): MediaType {
  const mt = (mime.lookup(filePath) || '').toString();
  if (mt.startsWith('image/')) return 'image';
  if (mt.startsWith('audio/')) return 'audio';
  if (mt.startsWith('video/')) return 'video';
  return 'document';
}

async function run(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) {
    console.error('Missing command. See smoke.ts header for usage.');
    process.exit(2);
  }

  const service = new WhatsAppService();
  await service.start();

  if (cmd === 'pair') {
    console.error('[smoke] waiting for connection...');
    await service.waitReady(180_000);
    console.error('[smoke] paired. me =', service.getMe());
    process.exit(0);
  }

  if (cmd === 'logout') {
    await service.waitReady(30_000).catch(() => undefined);
    await service.logout();
    console.error('[smoke] logged out');
    process.exit(0);
  }

  if (cmd === 'status') {
    await new Promise((r) => setTimeout(r, 3000));
    console.log(JSON.stringify(service.getHealth(), null, 2));
    process.exit(0);
  }

  // All send-* commands require readiness
  console.error('[smoke] waiting for connection (scan QR if shown)...');
  await service.waitReady(180_000);
  console.error('[smoke] connected as', service.getMe()?.id);

  if (cmd === 'send') {
    const [to, ...msgParts] = rest;
    if (!to || msgParts.length === 0) throw new Error('Usage: send <numero> <texto>');
    const result = await service.sendMessage({ to, message: msgParts.join(' ') });
    console.log(JSON.stringify(result, null, 2));
  } else if (cmd === 'media') {
    const [to, filePath] = rest;
    if (!to || !filePath) throw new Error('Usage: media <numero> <arquivo>');
    const abs = path.resolve(filePath);
    const mediaType = detectMediaType(abs);
    const result = await service.sendMediaMessage({
      to,
      mediaPath: abs,
      mediaType,
      caption: `smoke test ${new Date().toISOString()}`,
      filename: path.basename(abs),
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (cmd === 'billing') {
    const [to] = rest;
    if (!to) throw new Error('Usage: billing <numero>');
    const { handleSendBillingAlert } = await import('../tools/send-billing-alert.js');
    const result = await handleSendBillingAlert(service, {
      to,
      amount: 123.45,
      due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      invoice_number: 'SMOKE-001',
      name: 'Ferd (teste)',
      payment_link: 'https://example.com/pay/smoke-001',
      company_name: 'CPZ Seguros',
      include_interest_info: true,
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (cmd === 'reminder') {
    const [to] = rest;
    if (!to) throw new Error('Usage: reminder <numero>');
    const { handleSendDocumentReminder } = await import('../tools/send-document-reminder.js');
    const result = await handleSendDocumentReminder(service, {
      to,
      document_type: 'rg',
      due_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      name: 'Ferd (teste)',
      custom_message: 'Teste de lembrete via smoke — pode ignorar.',
      company_name: 'CPZ Seguros',
    });
    console.log(JSON.stringify(result, null, 2));
  } else {
    throw new Error(`Unknown command: ${cmd}`);
  }

  // Small delay to let send complete, then exit
  await new Promise((r) => setTimeout(r, 2000));
  process.exit(0);
}

run().catch((err) => {
  console.error('[smoke] error:', err?.stack ?? err);
  process.exit(1);
});

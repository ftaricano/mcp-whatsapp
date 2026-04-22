#!/usr/bin/env node
/**
 * WhatsApp CLI — on-demand send + admin commands.
 *
 * Invocado diretamente (`whatsapp <cmd>`) ou via Bash a partir de um agente.
 * Cada invocação spawna um processo novo: conecta → executa → encerra.
 *
 * NOTA: por ser one-shot, `list-chats`/`read-chat`/`status` de mensagem
 * enviada antes NÃO funcionam (buffer é em memória da sessão). Use o
 * servidor MCP de longa duração se precisar dessas features.
 */

import { parseArgs } from 'node:util';
import * as path from 'path';
import * as mime from 'mime-types';
import { WhatsAppService, MediaType } from './services/whatsapp-api.js';
import { handleSendBillingAlert } from './tools/send-billing-alert.js';
import { handleSendDocumentReminder } from './tools/send-document-reminder.js';

type CommandResult = { ok: boolean; data?: unknown; error?: string };

const HELP = `WhatsApp CLI — on-demand invocation

Usage:
  whatsapp pair                                 # scan QR and save session
  whatsapp send     <to> <message>              # send plain text
  whatsapp media    <to> <file> [--caption c] [--name n]
                                                # auto-detect type from MIME
  whatsapp billing  <to> --amount N --due YYYY-MM-DD --invoice X --name N --link URL [--company C]
  whatsapp reminder <to> --doc TYPE --due YYYY-MM-DD --name N [--msg M] [--company C]
  whatsapp health                               # print connection/circuit/rate-limiter JSON
  whatsapp logout                               # drop session (next call requires new QR)

Global flags:
  --json                                         # machine-readable output on stdout
  --quiet                                        # suppress human log messages on stderr
  --timeout <ms>                                 # readiness timeout (default 60000)

Numbers: E.164 (+5521999999999) or digits (5521999999999). DDI default 55.

Doc types (reminder --doc): rg | cpf | contrato | comprovante | custom
Examples:
  whatsapp send +5521995762574 "ping"
  whatsapp billing +5521995762574 --amount 299.90 --due 2026-05-10 \\
    --invoice BOL-42 --name "João" --link https://pay.ex/42 --company "CPZ Seguros"
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sub = argv[0];

  if (!sub || sub === '-h' || sub === '--help' || sub === 'help') {
    process.stdout.write(HELP);
    process.exit(0);
  }

  const rest = argv.slice(1);
  const parsed = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: false,
    options: {
      json: { type: 'boolean' },
      quiet: { type: 'boolean' },
      timeout: { type: 'string' },
      caption: { type: 'string' },
      name: { type: 'string' },
      amount: { type: 'string' },
      due: { type: 'string' },
      invoice: { type: 'string' },
      link: { type: 'string' },
      company: { type: 'string' },
      doc: { type: 'string' },
      msg: { type: 'string' },
    },
  });

  const positionals = parsed.positionals;
  const rawFlags = parsed.values as Record<string, string | boolean | undefined>;
  const str = (v: string | boolean | undefined): string | undefined =>
    typeof v === 'string' ? v : undefined;
  const bool = (v: string | boolean | undefined): boolean => v === true;

  const flags = {
    json: bool(rawFlags.json),
    quiet: bool(rawFlags.quiet),
    timeout: str(rawFlags.timeout),
    caption: str(rawFlags.caption),
    name: str(rawFlags.name),
    amount: str(rawFlags.amount),
    due: str(rawFlags.due),
    invoice: str(rawFlags.invoice),
    link: str(rawFlags.link),
    company: str(rawFlags.company),
    doc: str(rawFlags.doc),
    msg: str(rawFlags.msg),
  };

  const log = (m: string): void => {
    if (!flags.quiet) process.stderr.write(`[whatsapp] ${m}\n`);
  };

  const out = (result: CommandResult): void => {
    if (flags.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else if (result.ok) {
      if (result.data !== undefined) {
        process.stdout.write(
          (typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)) + '\n',
        );
      }
    } else {
      process.stderr.write(`error: ${result.error ?? 'unknown'}\n`);
    }
  };

  const timeout = flags.timeout ? parseInt(flags.timeout, 10) : 60_000;

  // Suppress pino + Baileys internal logs when --quiet. The service's config
  // singleton reads WHATSAPP_LOG_LEVEL on first access, so we must set it
  // BEFORE constructing WhatsAppService.
  if (flags.quiet && !process.env.WHATSAPP_LOG_LEVEL) {
    process.env.WHATSAPP_LOG_LEVEL = 'silent';
  }

  const service = new WhatsAppService();

  try {
    await service.start();

    if (sub === 'pair') {
      log('waiting for pairing (scan QR if shown)...');
      await service.waitReady(180_000);
      out({ ok: true, data: { paired: true, me: service.getMe() } });
      return;
    }

    if (sub === 'logout') {
      await service.waitReady(15_000).catch(() => undefined);
      await service.logout();
      out({ ok: true, data: { logged_out: true } });
      return;
    }

    if (sub === 'health') {
      await new Promise((r) => setTimeout(r, 2000));
      out({ ok: true, data: service.getHealth() });
      return;
    }

    log('connecting...');
    await service.waitReady(timeout);
    log(`connected as ${service.getMe()?.id}`);

    if (sub === 'send') {
      const [to, ...messageParts] = positionals;
      if (!to || messageParts.length === 0) throw new Error('Usage: send <to> <message>');
      const res = await service.sendMessage({ to, message: messageParts.join(' ') });
      out({ ok: true, data: res });
      return;
    }

    if (sub === 'media') {
      const [to, filePath] = positionals;
      if (!to || !filePath) throw new Error('Usage: media <to> <file> [--caption c] [--name n]');
      const abs = path.resolve(filePath);
      const mt = (mime.lookup(abs) || '').toString();
      const mediaType: MediaType = mt.startsWith('image/')
        ? 'image'
        : mt.startsWith('audio/')
          ? 'audio'
          : mt.startsWith('video/')
            ? 'video'
            : 'document';
      const res = await service.sendMediaMessage({
        to,
        mediaPath: abs,
        mediaType,
        caption: flags.caption,
        filename: flags.name || path.basename(abs),
      });
      out({ ok: true, data: res });
      return;
    }

    if (sub === 'billing') {
      const [to] = positionals;
      if (!to) throw new Error('Usage: billing <to> --amount N --due YYYY-MM-DD --invoice X --name N --link URL [--company C]');
      if (!flags.amount || !flags.due || !flags.invoice || !flags.name || !flags.link) {
        throw new Error('Missing required flags: --amount, --due, --invoice, --name, --link');
      }
      const amount = Number(flags.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid --amount');
      const res = await handleSendBillingAlert(service, {
        to,
        amount,
        due_date: flags.due,
        invoice_number: flags.invoice,
        name: flags.name,
        payment_link: flags.link,
        company_name: flags.company,
      });
      out({ ok: true, data: res });
      return;
    }

    if (sub === 'reminder') {
      const [to] = positionals;
      if (!to) throw new Error('Usage: reminder <to> --doc TYPE --due YYYY-MM-DD --name N [--msg M] [--company C]');
      if (!flags.doc || !flags.due || !flags.name) {
        throw new Error('Missing required flags: --doc, --due, --name');
      }
      const res = await handleSendDocumentReminder(service, {
        to,
        document_type: flags.doc,
        due_date: flags.due,
        name: flags.name,
        custom_message: flags.msg,
        company_name: flags.company,
      });
      out({ ok: true, data: res });
      return;
    }

    throw new Error(`Unknown command: ${sub}. Run 'whatsapp --help' for usage.`);
  } catch (err) {
    out({ ok: false, error: (err as Error).message });
    process.exitCode = 1;
  } finally {
    // Allow send acks to land before we tear down
    await new Promise((r) => setTimeout(r, 1500));
    process.exit(process.exitCode ?? 0);
  }
}

main().catch((err) => {
  process.stderr.write(`[whatsapp] fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});

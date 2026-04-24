#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WhatsAppService } from './services/whatsapp-api.js';
import { setupTools } from './tools/index.js';
import { setupResources } from './resources/index.js';

const SERVER_NAME = 'mcp-whatsapp';
const SERVER_VERSION = '2.1.0';

async function main(): Promise<void> {
  process.stderr.write(`[${SERVER_NAME}] starting v${SERVER_VERSION}\n`);

  const service = new WhatsAppService();

  // Fire-and-forget: Baileys connects on its own, emits QR via stderr.
  // We don't block MCP startup — tools will wait for ready internally.
  service.start().catch((err) => {
    process.stderr.write(`[${SERVER_NAME}] Baileys failed to start: ${err.message}\n`);
  });

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );

  setupTools(server, service);
  setupResources(server, service);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`[${SERVER_NAME}] received ${signal}, shutting down\n`);
    try {
      await server.close();
    } catch {
      /* ignore */
    }
    try {
      await service.dispose();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[${SERVER_NAME}] ready on stdio\n`);
}

process.on('uncaughtException', (err) => {
  process.stderr.write(`[${SERVER_NAME}] uncaught: ${err.stack ?? err.message}\n`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[${SERVER_NAME}] unhandled rejection: ${String(reason)}\n`);
});

main().catch((err) => {
  process.stderr.write(`[${SERVER_NAME}] fatal: ${err.stack ?? err.message}\n`);
  process.exit(1);
});

#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WhatsAppService } from './services/whatsapp-api.js';
import { setupTools } from './tools/index.js';
import { setupResources } from './resources/index.js';

const SERVER_NAME = "mcp-whatsapp";
const SERVER_VERSION = "1.0.0";

async function main() {
  console.error(`Starting ${SERVER_NAME} v${SERVER_VERSION}`);

  try {
    // Create MCP server
    const server = new Server(
      {
        name: SERVER_NAME,
        version: SERVER_VERSION,
        description: "WhatsApp Cloud API integration for sending messages and 15MB attachments"
      },
      {
        capabilities: {
          tools: {},
          resources: {}
        }
      }
    );

    // Initialize WhatsApp service
    console.error('Initializing WhatsApp service...');
    const whatsappService = new WhatsAppService();
    
    // Test connection
    console.error('Testing WhatsApp API connection...');
    const isConnected = await whatsappService.testConnection();
    if (!isConnected) {
      console.error('Warning: WhatsApp API connection test failed. Check your configuration.');
    } else {
      console.error('✅ WhatsApp API connection successful');
    }

    // Setup tools and resources
    console.error('Setting up tools and resources...');
    setupTools(server, whatsappService);
    setupResources(server, whatsappService);

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.error('Received SIGINT, shutting down gracefully...');
      await server.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.error('Received SIGTERM, shutting down gracefully...');
      await server.close();
      process.exit(0);
    });

    // Start server
    const transport = new StdioServerTransport();
    console.error(`${SERVER_NAME} ready and listening on stdio`);
    console.error('Available tools: send_message, send_media_message, send_document_reminder, send_billing_alert, get_message_status');
    console.error('Available resources: whatsapp://templates, whatsapp://health, whatsapp://config');
    
    await server.connect(transport);

  } catch (error: any) {
    console.error('Failed to start server:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the server
main().catch((error) => {
  console.error('Error in main:', error);
  process.exit(1);
});
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WhatsAppService } from '../services/whatsapp-api.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Import tools
import { sendMessageTool, handleSendMessage } from './send-message.js';
import { sendMediaMessageTool, handleSendMediaMessage } from './send-media-message.js';
import { sendDocumentReminderTool, handleSendDocumentReminder } from './send-document-reminder.js';
import { sendBillingAlertTool, handleSendBillingAlert } from './send-billing-alert.js';
import { getMessageStatusTool, handleGetMessageStatus } from './get-message-status.js';

export function setupTools(server: Server, whatsappService: WhatsAppService): void {
  // Register all tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        sendMessageTool,
        sendMediaMessageTool,
        sendDocumentReminderTool,
        sendBillingAlertTool,
        getMessageStatusTool
      ]
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'send_message':
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(await handleSendMessage(whatsappService, args), null, 2)
              }
            ]
          };

        case 'send_media_message':
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(await handleSendMediaMessage(whatsappService, args), null, 2)
              }
            ]
          };

        case 'send_document_reminder':
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(await handleSendDocumentReminder(whatsappService, args), null, 2)
              }
            ]
          };

        case 'send_billing_alert':
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(await handleSendBillingAlert(whatsappService, args), null, 2)
              }
            ]
          };

        case 'get_message_status':
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(await handleGetMessageStatus(whatsappService, args), null, 2)
              }
            ]
          };

        default:
          throw new Error(`Tool desconhecido: ${name}`);
      }
    } catch (error: any) {
      console.error(`Error in tool ${name}:`, error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: {
                message: error.message,
                type: 'tool_execution_error',
                tool_name: name
              },
              timestamp: new Date().toISOString()
            }, null, 2)
          }
        ],
        isError: true
      };
    }
  });
}
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { WhatsAppService } from '../services/whatsapp-api.js';

import { sendMessageTool, handleSendMessage } from './send-message.js';
import { sendMediaMessageTool, handleSendMediaMessage } from './send-media-message.js';
import { sendDocumentReminderTool, handleSendDocumentReminder } from './send-document-reminder.js';
import { sendBillingAlertTool, handleSendBillingAlert } from './send-billing-alert.js';
import { getMessageStatusTool, handleGetMessageStatus } from './get-message-status.js';
import { logoutTool, handleLogout } from './logout.js';
import { listChatsTool, handleListChats } from './list-chats.js';
import { readChatTool, handleReadChat } from './read-chat.js';

type Handler = (service: WhatsAppService, args: unknown) => Promise<unknown>;

const HANDLERS: Record<string, Handler> = {
  send_message: handleSendMessage,
  send_media_message: handleSendMediaMessage,
  send_document_reminder: handleSendDocumentReminder,
  send_billing_alert: handleSendBillingAlert,
  get_message_status: handleGetMessageStatus,
  whatsapp_logout: handleLogout,
  list_chats: handleListChats,
  read_chat: handleReadChat,
};

const TOOLS = [
  sendMessageTool,
  sendMediaMessageTool,
  sendDocumentReminderTool,
  sendBillingAlertTool,
  getMessageStatusTool,
  logoutTool,
  listChatsTool,
  readChatTool,
];

export function setupTools(server: Server, service: WhatsAppService): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = HANDLERS[name];
    if (!handler) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: false, error: { type: 'unknown_tool', tool_name: name } }, null, 2),
          },
        ],
        isError: true,
      };
    }
    try {
      const result = await handler(service, args);
      const isError = typeof result === 'object' && result !== null && (result as { success?: boolean }).success === false;
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError,
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: { type: 'tool_execution_error', message: (err as Error).message, tool_name: name },
                timestamp: new Date().toISOString(),
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
  });
}

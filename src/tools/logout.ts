import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { WhatsAppService } from '../services/whatsapp-api.js';
import { fail } from '../utils/tool-response.js';

export const logoutTool: Tool = {
  name: 'whatsapp_logout',
  description: 'Desconectar do WhatsApp e apagar a sessão local. Próxima execução exigirá novo pareamento via QR.',
  inputSchema: { type: 'object', properties: {}, required: [] },
};

export async function handleLogout(service: WhatsAppService, _args: unknown): Promise<unknown> {
  try {
    await service.logout();
    return {
      success: true,
      message: 'Sessão encerrada. Reinicie o servidor (npm start) para gerar novo QR.',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return fail('logout_failed', err);
  }
}

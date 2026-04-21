import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { WhatsAppService } from '../services/whatsapp-api.js';
import { TemplateEngine } from '../services/template-engine.js';
import { ConfigManager } from '../config/whatsapp.js';

const RESOURCES = [
  {
    uri: 'whatsapp://qr',
    name: 'Pairing QR Code',
    description: 'QR code atual (data URL PNG). Null se já conectado.',
    mimeType: 'application/json',
  },
  {
    uri: 'whatsapp://templates',
    name: 'Message Templates',
    description: 'Templates disponíveis (document_reminder, billing_alert, payment_reminder, overdue_notice).',
    mimeType: 'application/json',
  },
  {
    uri: 'whatsapp://health',
    name: 'Service Health',
    description: 'Status de conexão, rate limiter e circuit breaker.',
    mimeType: 'application/json',
  },
  {
    uri: 'whatsapp://config',
    name: 'Configuration',
    description: 'Configuração efetiva do servidor.',
    mimeType: 'application/json',
  },
  {
    uri: 'whatsapp://statuses',
    name: 'Message Statuses',
    description: 'Status das mensagens enviadas nesta sessão.',
    mimeType: 'application/json',
  },
  {
    uri: 'whatsapp://inbox',
    name: 'Inbox Overview',
    description: 'Resumo dos chats com atividade desde o start do servidor (buffer em memória).',
    mimeType: 'application/json',
  },
] as const;

export function setupResources(server: Server, service: WhatsAppService): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [...RESOURCES] }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const payload = await readResource(uri, service);
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  });
}

async function readResource(uri: string, service: WhatsAppService): Promise<unknown> {
  switch (uri) {
    case 'whatsapp://qr': {
      const qr = service.getCurrentQr();
      if (!qr) {
        return {
          connection: service.getConnectionState(),
          qr: null,
          data_url: null,
          message:
            service.getConnectionState() === 'open'
              ? 'Já conectado. Use whatsapp_logout se quiser re-parear.'
              : 'Aguardando QR. Verifique se o servidor foi iniciado corretamente.',
        };
      }
      const dataUrl = await service.getCurrentQrAsDataUrl();
      return {
        connection: service.getConnectionState(),
        qr_string: qr.qr,
        data_url: dataUrl,
        generated_at: qr.generatedAt,
        instruction: 'WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho',
      };
    }

    case 'whatsapp://templates':
      return {
        available_templates: TemplateEngine.listTemplates().map((t) => ({
          name: t.name,
          category: t.category,
          variables: t.variables,
        })),
      };

    case 'whatsapp://health': {
      const health = service.getHealth();
      return {
        service_health: {
          status: health.connection === 'open' ? 'healthy' : 'unhealthy',
          connection: health.connection,
          me: health.me,
          timestamp: new Date().toISOString(),
        },
        circuit_breaker: health.circuitBreaker,
        rate_limiter: health.rateLimiter,
        messages: { pending_or_server_ack: health.pendingMessages },
      };
    }

    case 'whatsapp://config': {
      const cfg = ConfigManager.getInstance().getConfig();
      return {
        session_dir: cfg.sessionDir,
        rate_limits: cfg.rateLimit,
        retry_policy: cfg.retryPolicy,
        media: {
          max_size_mb: Math.round(cfg.media.maxSize / 1024 / 1024),
          allowed_mime_types: cfg.media.allowedMimeTypes,
        },
        log_level: cfg.logLevel,
        default_country_code: cfg.defaultCountryCode,
      };
    }

    case 'whatsapp://statuses':
      return { statuses: service.getAllStatuses() };

    case 'whatsapp://inbox': {
      const overview = service.getInboxOverview();
      const chats = service.listChats(50);
      return { overview, chats };
    }

    default:
      return {
        error: { type: 'resource_not_found', message: `Resource not found: ${uri}` },
      };
  }
}

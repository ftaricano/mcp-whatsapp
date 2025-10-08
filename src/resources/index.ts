import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WhatsAppService } from '../services/whatsapp-api.js';
import { TemplateEngine } from '../services/template-engine.js';
import { ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export function setupResources(server: Server, whatsappService: WhatsAppService): void {
  // List available resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: 'whatsapp://templates',
          name: 'Message Templates',
          description: 'Available message templates for document reminders and billing alerts',
          mimeType: 'application/json'
        },
        {
          uri: 'whatsapp://health',
          name: 'Service Health',
          description: 'Current health status of WhatsApp service including rate limits and circuit breaker',
          mimeType: 'application/json'
        },
        {
          uri: 'whatsapp://config',
          name: 'Configuration',
          description: 'Current WhatsApp API configuration (sanitized)',
          mimeType: 'application/json'
        }
      ]
    };
  });

  // Handle resource requests
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    try {
      switch (uri) {
        case 'whatsapp://templates':
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({
                  available_templates: TemplateEngine.listTemplates().map(template => ({
                    name: template.name,
                    category: template.category,
                    variables: template.variables,
                    description: getTemplateDescription(template.name)
                  })),
                  usage_examples: {
                    document_reminder: {
                      description: "Template para lembrete de documentos",
                      example_variables: {
                        name: "João Silva",
                        document_type: "rg", 
                        due_date: "2024-12-31",
                        custom_message: "Por favor, envie em alta resolução",
                        company_name: "Minha Empresa"
                      }
                    },
                    billing_alert: {
                      description: "Template para alertas de cobrança",
                      example_variables: {
                        name: "Maria Santos",
                        invoice_number: "INV-2024-001",
                        amount: 150.50,
                        due_date: "2024-12-25",
                        payment_link: "https://pay.example.com/inv001",
                        company_name: "Minha Empresa"
                      }
                    }
                  }
                }, null, 2)
              }
            ]
          };

        case 'whatsapp://health':
          const healthStatus = whatsappService.getHealthStatus();
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({
                  service_health: {
                    status: healthStatus.isHealthy ? 'healthy' : 'unhealthy',
                    timestamp: new Date().toISOString()
                  },
                  circuit_breaker: healthStatus.circuitBreaker,
                  rate_limiter: {
                    messages: {
                      ...healthStatus.rateLimiter.messages,
                      description: "Rate limiting for text messages"
                    },
                    media: {
                      ...healthStatus.rateLimiter.media,
                      description: "Rate limiting for media messages"
                    }
                  },
                  api_connection: {
                    last_tested: new Date().toISOString(),
                    status: await testApiConnection(whatsappService)
                  }
                }, null, 2)
              }
            ]
          };

        case 'whatsapp://config':
          const config = require('../config/whatsapp.js').ConfigManager.getInstance().getConfig();
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({
                  api_version: config.apiVersion,
                  base_url: config.baseUrl,
                  phone_number_id: config.phoneNumberId.substring(0, 4) + '****', // Masked
                  rate_limits: config.rateLimit,
                  retry_policy: config.retryPolicy,
                  media_settings: {
                    max_size_mb: Math.round(config.media.maxSize / 1024 / 1024),
                    compression_enabled: config.media.compressionEnabled,
                    allowed_types: config.media.allowedTypes,
                    temp_dir: config.media.tempDir
                  },
                  note: "Sensitive information has been masked for security"
                }, null, 2)
              }
            ]
          };

        default:
          throw new Error(`Resource not found: ${uri}`);
      }
    } catch (error: any) {
      console.error(`Error reading resource ${uri}:`, error);
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              error: {
                message: error.message,
                type: 'resource_read_error',
                uri: uri
              },
              timestamp: new Date().toISOString()
            }, null, 2)
          }
        ]
      };
    }
  });
}

function getTemplateDescription(templateName: string): string {
  const descriptions: Record<string, string> = {
    'document_reminder': 'Template para envio de lembretes de documentos pendentes com prazo',
    'billing_alert': 'Template para alertas de cobrança/boletos com informações de pagamento',
    'payment_reminder': 'Template para lembretes de pagamento próximo ao vencimento',
    'overdue_notice': 'Template para notificações de faturas vencidas com juros'
  };
  
  return descriptions[templateName] || 'Template personalizado';
}

async function testApiConnection(whatsappService: WhatsAppService): Promise<string> {
  try {
    const isConnected = await whatsappService.testConnection();
    return isConnected ? 'connected' : 'disconnected';
  } catch (error) {
    return 'error';
  }
}
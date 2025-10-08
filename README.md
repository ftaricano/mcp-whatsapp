# MCP WhatsApp

MCP (Model Context Protocol) server para integração com WhatsApp Cloud API. Permite envio de mensagens, anexos de até 15MB, lembretes de documentos e alertas de cobrança.

## 🚀 Características

- **Mensagens de Texto**: Envio de mensagens simples via WhatsApp
- **Anexos Grandes**: Suporte para arquivos de até 15MB (imagens, documentos, áudio, vídeo)
- **Templates Profissionais**: Lembretes de documentos e alertas de cobrança formatados
- **Rate Limiting**: Controle inteligente de taxa para evitar bloqueios
- **Retry Logic**: Recuperação automática de falhas com exponential backoff
- **Circuit Breaker**: Proteção contra falhas em cascata
- **Health Monitoring**: Monitoramento de saúde do serviço

## 📋 Pré-requisitos

1. **Node.js 18+**
2. **Conta Meta Business** com WhatsApp Cloud API configurada
3. **Access Token** permanente do WhatsApp Cloud API
4. **Phone Number ID** da conta comercial

## 🛠️ Instalação

### 1. Clone e instale dependências
```bash
git clone <repository-url>
cd mcp-whatsapp
npm install
```

### 2. Configure variáveis de ambiente
```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas credenciais:
```bash
# Obrigatório
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxx  # Seu token permanente
WHATSAPP_PHONE_NUMBER_ID=123456789  # ID do número comercial

# Opcional (valores padrão)
WHATSAPP_API_VERSION=v17.0
WHATSAPP_RATE_LIMIT_MESSAGES=10
WHATSAPP_RATE_LIMIT_MEDIA=2
WHATSAPP_MAX_RETRIES=3
```

### 3. Build e execute
```bash
npm run build
npm start
```

## 🔧 Configuração da WhatsApp Cloud API

### 1. Obter Access Token
1. Acesse [Meta Business](https://business.facebook.com/)
2. Vá para **Configurações do Sistema > Tokens de acesso**
3. Gere um token permanente com permissões `whatsapp_business_messaging`

### 2. Obter Phone Number ID
1. No Meta Business, vá para **WhatsApp > Primeiros passos**
2. Copie o Phone Number ID (números apenas)

### 3. Configurar Webhook (Opcional)
Para receber status de entrega, configure webhook apontando para seu servidor.

## 🛡️ Configuração MCP

Adicione ao seu arquivo de configuração MCP:

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "node",
      "args": ["/caminho/para/mcp-whatsapp/build/index.js"],
      "env": {
        "WHATSAPP_ACCESS_TOKEN": "seu_token_aqui",
        "WHATSAPP_PHONE_NUMBER_ID": "seu_phone_number_id"
      }
    }
  }
}
```

## 📚 Ferramentas Disponíveis

### 1. `send_message` - Mensagem Simples
Envio de mensagens de texto básicas.

```json
{
  "tool": "send_message",
  "arguments": {
    "to": "+5511999999999",
    "message": "Olá! Esta é uma mensagem de teste.",
    "preview_url": false
  }
}
```

### 2. `send_media_message` - Anexos até 15MB
Envio de arquivos (imagem, documento, áudio, vídeo).

```json
{
  "tool": "send_media_message", 
  "arguments": {
    "to": "+5511999999999",
    "media_path": "/caminho/para/arquivo.pdf",
    "media_type": "document",
    "caption": "Documento solicitado",
    "filename": "contrato_2024.pdf"
  }
}
```

**Tipos de mídia suportados:**
- `image`: JPEG, PNG, WebP
- `document`: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, CSV
- `audio`: MP3, MP4, AMR, OGG
- `video`: MP4, 3GPP

### 3. `send_document_reminder` - Lembrete de Documentos
Template profissional para solicitar documentos.

```json
{
  "tool": "send_document_reminder",
  "arguments": {
    "to": "+5511999999999",
    "document_type": "rg",
    "due_date": "2024-12-31",
    "name": "João Silva",
    "custom_message": "Por favor, envie em alta resolução",
    "company_name": "Minha Empresa",
    "attachment_path": "/caminho/para/formulario.pdf"
  }
}
```

**Tipos de documento:**
- `rg`: RG (Documento de Identidade)
- `cpf`: CPF
- `contrato`: Contrato Assinado
- `comprovante`: Comprovante de Residência
- `custom`: Personalizado

### 4. `send_billing_alert` - Alerta de Cobrança
Template profissional para boletos e cobranças.

```json
{
  "tool": "send_billing_alert",
  "arguments": {
    "to": "+5511999999999",
    "amount": 150.50,
    "due_date": "2024-12-25",
    "invoice_number": "INV-2024-001",
    "name": "Maria Santos",
    "barcode": "12345678901234567890123456789012345678901234567",
    "payment_link": "https://pay.example.com/inv001",
    "company_name": "Minha Empresa",
    "include_interest_info": true
  }
}
```

### 5. `get_message_status` - Status da Mensagem
Verificar status de entrega de mensagens enviadas.

```json
{
  "tool": "get_message_status",
  "arguments": {
    "message_id": "wamid.xxxxxxxxxxxxx"
  }
}
```

## 📊 Recursos Disponíveis

### 1. `whatsapp://templates` - Templates Disponíveis
Lista todos os templates de mensagens com variáveis e exemplos.

### 2. `whatsapp://health` - Status do Serviço
Status em tempo real do serviço, rate limits e circuit breaker.

### 3. `whatsapp://config` - Configuração
Configuração atual do servidor (dados sensíveis mascarados).

## 🔍 Exemplos de Uso

### Exemplo 1: Envio de Boleto
```javascript
// 1. Enviar alerta de cobrança
const billing = await mcp.callTool('send_billing_alert', {
  to: '+5511999999999',
  amount: 299.90,
  due_date: '2024-12-31',
  invoice_number: 'BOL-2024-12345',
  name: 'João Silva',
  payment_link: 'https://pay.empresa.com/bol123',
  company_name: 'Empresa LTDA'
});

// 2. Verificar status
const status = await mcp.callTool('get_message_status', {
  message_id: billing.message_id
});
```

### Exemplo 2: Solicitar Documento
```javascript
// 1. Lembrete com anexo
const reminder = await mcp.callTool('send_document_reminder', {
  to: '+5511999999999',
  document_type: 'rg',
  due_date: '2024-12-25',
  name: 'Maria Santos',
  custom_message: 'Precisamos da foto de frente e verso',
  attachment_path: '/docs/formulario_rg.pdf'
});
```

### Exemplo 3: Envio de Arquivo Grande
```javascript
// Arquivo até 15MB
const media = await mcp.callTool('send_media_message', {
  to: '+5511999999999',
  media_path: '/files/video_treinamento.mp4',
  media_type: 'video',
  caption: 'Vídeo de treinamento - Módulo 1'
});
```

## ⚙️ Configurações Avançadas

### Rate Limiting
```bash
# Mensagens por segundo (padrão: 10)
WHATSAPP_RATE_LIMIT_MESSAGES=10

# Mídia por segundo (padrão: 2) 
WHATSAPP_RATE_LIMIT_MEDIA=2

# Limite de rajada (padrão: 50)
WHATSAPP_BURST_LIMIT=50
```

### Retry Policy
```bash
# Tentativas máximas (padrão: 3)
WHATSAPP_MAX_RETRIES=3

# Delay inicial em ms (padrão: 1000)
WHATSAPP_BASE_DELAY=1000

# Delay máximo em ms (padrão: 30000)
WHATSAPP_MAX_DELAY=30000

# Multiplicador de backoff (padrão: 2)
WHATSAPP_BACKOFF_MULTIPLIER=2
```

### Media Settings
```bash
# Tamanho máximo em bytes (padrão: 15MB)
WHATSAPP_MAX_MEDIA_SIZE=15728640

# Diretório temporário (padrão: ./temp)
WHATSAPP_TEMP_DIR=./temp

# Habilitar compressão (padrão: true)
WHATSAPP_COMPRESSION_ENABLED=true
```

## 🚨 Tratamento de Erros

O servidor implementa tratamento robusto de erros:

### Rate Limiting
- **429 Too Many Requests**: Exponential backoff automático
- **Burst Protection**: Controle de rajadas para evitar bloqueios

### Circuit Breaker
- **5 falhas consecutivas**: Circuit breaker ativo por 30 segundos
- **Fail Fast**: Falha rápida quando circuit breaker ativo
- **Auto Recovery**: Recuperação automática após timeout

### Retry Logic
- **Network Errors**: 3 tentativas com delay exponencial
- **Rate Limits**: 5 tentativas com delays maiores
- **Client Errors (4xx)**: Falha imediata, sem retry
- **Media Errors**: Retry com fallback para link sharing

## 📈 Monitoramento

### Health Check
```javascript
const health = await mcp.readResource('whatsapp://health');
console.log(health.service_health.status); // 'healthy' ou 'unhealthy'
```

### Métricas Disponíveis
- **Circuit Breaker**: Estado e estatísticas de falhas
- **Rate Limiter**: Tokens disponíveis e tempo de espera
- **API Connection**: Status da conexão com WhatsApp
- **Message Status**: Status de entrega por tipo de mensagem

## 🔒 Segurança

### Validações Implementadas
- **E.164 Phone Format**: Validação de formato de telefone
- **File Size Limits**: Limite de 15MB para arquivos
- **MIME Type Validation**: Apenas tipos permitidos
- **Input Sanitization**: Validação de todos os inputs
- **Token Masking**: Dados sensíveis mascarados nos logs

### Boas Práticas
1. **Nunca commitar** tokens no código
2. **Usar HTTPS** em produção
3. **Monitorar logs** para detectar tentativas de abuso
4. **Rotacionar tokens** periodicamente
5. **Implementar webhook** para receber status de entrega

## 🐛 Troubleshooting

### Erro: "Access token invalid"
- Verifique se o token está correto
- Confirme se o token tem permissões `whatsapp_business_messaging`
- Verifique se o token não expirou

### Erro: "Phone number not found"
- Confirme o Phone Number ID
- Verifique se o número está verificado no Meta Business

### Erro: "Media upload failed"
- Confirme o tamanho do arquivo (máx 15MB)
- Verifique o tipo MIME do arquivo
- Confirme se há espaço em disco no diretório temporário

### Erro: "Rate limit exceeded"
- O servidor implementa retry automático
- Ajuste `WHATSAPP_RATE_LIMIT_MESSAGES` se necessário
- Monitore o resource `whatsapp://health`

## 📝 Changelog

### v1.0.0
- ✅ Envio de mensagens de texto
- ✅ Anexos até 15MB
- ✅ Templates de lembrete e cobrança
- ✅ Rate limiting e circuit breaker
- ✅ Error handling robusto
- ✅ Health monitoring
- ✅ Resources para monitoramento

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch (`git checkout -b feature/nova-funcionalidade`)
3. Commit suas mudanças (`git commit -am 'Adiciona nova funcionalidade'`)
4. Push para a branch (`git push origin feature/nova-funcionalidade`)
5. Crie um Pull Request

## 📄 Licença

Este projeto está licenciado sob a Licença MIT - veja o arquivo [LICENSE](LICENSE) para detalhes.
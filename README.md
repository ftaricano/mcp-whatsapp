# mcp-whatsapp

MCP (Model Context Protocol) server para WhatsApp, **autenticado via QR code** (Baileys). Sem token oficial da Meta, sem aprovação de Business account — usa a mesma sessão do WhatsApp Web. Ideal para disparo controlado de mensagens, lembretes de documentos e alertas de cobrança pra contatos que já te conhecem.

> ⚠️ **Uso responsável.** WhatsApp bane números por comportamento de spam, não por "biblioteca usada". Mantenha volume moderado (o rate limiter default é 2 msg/s), não mande pra quem não te conhece, e respeite opt-outs. Para disparo em massa de campanhas, use a Cloud API oficial.

## Requisitos

- Node.js ≥ 18
- Um WhatsApp instalado no celular para escanear o QR (WhatsApp → Configurações → **Aparelhos conectados**)

## Instalação

```bash
git clone <repo>
cd mcp-whatsapp
npm install
npm run build
```

## Primeiro pareamento (QR)

Rode o servidor uma vez pelo terminal:

```bash
npm start
```

Um QR code ASCII aparece no **stderr**. No celular:

1. WhatsApp → Configurações → **Aparelhos conectados**
2. **Conectar um aparelho**
3. Escanear o QR

A sessão é salva em `./auth-state/` (configurável via `WHATSAPP_SESSION_DIR`). Próximas execuções não pedem QR — conecta direto.

Para ler o QR como PNG (ex: num cliente MCP), leia o resource `whatsapp://qr` — retorna `data_url` (base64 PNG).

## Uso via MCP

Adicione ao `~/.claude.json` ou equivalente:

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "node",
      "args": ["/caminho/absoluto/para/mcp-whatsapp/build/index.js"]
    }
  }
}
```

Nenhuma variável de ambiente é obrigatória. Veja [.env.example](.env.example) para opções.

## Tools

| Tool | O que faz |
|---|---|
| `send_message` | Texto simples até 4096 chars |
| `send_media_message` | Anexo (image/document/audio/video) até 15MB |
| `send_document_reminder` | Template formatado de lembrete de documento |
| `send_billing_alert` | Template formatado de cobrança/boleto |
| `get_message_status` | Status de entrega de uma msg enviada na sessão atual |
| `whatsapp_logout` | Desconecta e apaga sessão local (próxima execução exige QR) |

**Formato de número**: aceita E.164 (`+5521999999999`) ou dígitos puros (`5521999999999`, `21999999999` — nesse último caso aplica o DDI default do `WHATSAPP_DEFAULT_COUNTRY_CODE`, padrão `55`).

### Exemplos

```json
// Texto
{ "tool": "send_message", "arguments": {
  "to": "+5521999999999",
  "message": "Olá! Recado de teste."
}}

// PDF
{ "tool": "send_media_message", "arguments": {
  "to": "5521999999999",
  "media_path": "/Users/voce/docs/boleto.pdf",
  "media_type": "document",
  "caption": "Seu boleto em anexo",
  "filename": "boleto-2026-04.pdf"
}}

// Cobrança
{ "tool": "send_billing_alert", "arguments": {
  "to": "+5521999999999",
  "amount": 299.90,
  "due_date": "2026-05-10",
  "invoice_number": "BOL-2026-0042",
  "name": "João Silva",
  "payment_link": "https://pay.cpz.com.br/bol42",
  "company_name": "CPZ Seguros"
}}
```

## Resources

| URI | Conteúdo |
|---|---|
| `whatsapp://qr` | QR atual (string + data URL PNG) — null se conectado |
| `whatsapp://health` | Estado da conexão, rate limiter, circuit breaker, `me` |
| `whatsapp://config` | Configuração efetiva |
| `whatsapp://templates` | Templates registrados |
| `whatsapp://statuses` | Status de todas as msgs enviadas nesta sessão |

## Arquitetura

```
src/
├── index.ts                    # bootstrap + shutdown
├── config/whatsapp.ts          # zod-validated config, JID normalization
├── services/
│   ├── whatsapp-api.ts         # Baileys socket, QR handling, send, status tracking
│   └── template-engine.ts      # templates pt-BR (lembrete, cobrança)
├── tools/                      # MCP tools (zod-validated input)
├── resources/                  # MCP resources
└── utils/
    ├── rate-limiter.ts         # token bucket
    ├── retry.ts                # exponential backoff + error categorization
    └── circuit-breaker.ts      # fail-fast após 5 falhas seguidas
```

### Confiabilidade

- **Rate limiter** (token bucket) separado para msgs e mídia
- **Circuit breaker** abre após 5 falhas; tenta reset em 30s
- **Retry** com exponential backoff + jitter; não retenta erros 4xx/auth
- **Reconnect automático** em queda de socket (exceto logout)
- **Sessão persistida** em arquivos multi-file auth state

### Limitações conhecidas

- `get_message_status` só conhece mensagens desta sessão (estado em memória). Reiniciou, perdeu.
- `whatsapp-web.js`-style: status recebidos via eventos `messages.update` — propagação pode levar segundos.
- Grupos: não testados. JID de grupo (`...@g.us`) é aceito pela normalização mas flows voltados a grupos não foram validados.

## Desenvolvimento

```bash
npm run dev        # tsc --watch
npm run build
npm run clean
```

## Smoke test (sem cliente MCP)

Script CLI pra validar envio fim-a-fim sem precisar montar um cliente:

```bash
# 1. Parear (só na primeira vez — imprime QR, escanear do celular)
npm run smoke -- pair

# 2. Enviar texto
npm run smoke -- send +5521999999999 "teste via smoke"

# 3. Enviar mídia (tipo detectado pelo MIME)
npm run smoke -- media +5521999999999 /caminho/arquivo.pdf

# 4. Template de cobrança (dados de teste)
npm run smoke -- billing +5521999999999

# 5. Template de lembrete
npm run smoke -- reminder +5521999999999

# 6. Status atual (rate limiter, circuit breaker, conexão)
npm run smoke -- status

# 7. Logout (apaga sessão, força novo QR)
npm run smoke -- logout
```

## Troubleshooting

**QR não aparece** → stderr está sendo suprimido? Rode direto `node build/index.js` e veja o output.

**Conecta e cai em loop** → provavelmente sessão corrompida. `rm -rf auth-state/` e parea de novo.

**Mensagem não chega** → cheque `whatsapp://health` (`connection` deve ser `open`). Veja `whatsapp://statuses` pro status de cada msg. Baileys precisa da conexão estável — wifi ruim derruba.

**Erro "not ready"** → o servidor ainda está pareando ou reconectando. Espere o `connection: open` no health resource, ou rode `npm start` no terminal pra ver o QR.

## Licença

MIT.

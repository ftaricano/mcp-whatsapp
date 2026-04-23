# mcp-whatsapp

[![CI](https://github.com/ftaricano/mcp-whatsapp/actions/workflows/ci.yml/badge.svg)](https://github.com/ftaricano/mcp-whatsapp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A518.3-brightgreen.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-8A2BE2.svg)](https://modelcontextprotocol.io)

Integração com WhatsApp via Baileys (autenticação por QR code). Distribui dois binários:

- **`whatsapp` (CLI)** — on-demand. Spawna, envia, encerra. Use pro dia-a-dia (envio pontual, integração em scripts/cron, agentes que precisam "mandar algo agora").
- **`mcp-whatsapp` (MCP server)** — long-running. Necessário se você precisa **ler** mensagens recebidas (`list_chats`, `read_chat`) ou acompanhar status de entrega em tempo real.

Sem token oficial da Meta, sem aprovação de Business account — usa a mesma sessão do WhatsApp Web. Funciona com **WhatsApp pessoal ou Business** (qualquer conta que pareia em "Aparelhos conectados"). Ideal para disparo controlado de mensagens, lembretes de documentos e alertas de cobrança pra contatos que já te conhecem.

> ⚠️ **Uso responsável.** WhatsApp bane números por comportamento de spam, não por "biblioteca usada". Mantenha volume moderado (o rate limiter default é 2 msg/s), não mande pra quem não te conhece, e respeite opt-outs. Para disparo em massa de campanhas, use a Cloud API oficial.

## Requisitos

- Node.js ≥ 18.3 (fetch/AbortSignal estável — Baileys ≥ 7 depende disso)
- Um WhatsApp instalado no celular para escanear o QR (WhatsApp → Configurações → **Aparelhos conectados**)

## Instalação

```bash
git clone https://github.com/ftaricano/mcp-whatsapp.git
cd mcp-whatsapp
npm install
npm run build
npm link     # opcional — expõe `whatsapp` e `mcp-whatsapp` globalmente
```

## Primeiro pareamento (QR)

Rode qualquer um dos dois comandos abaixo pela primeira vez:

```bash
whatsapp pair        # via CLI
# ou
npm start            # via MCP server
```

Um QR code ASCII aparece no **stderr**. No celular:

1. WhatsApp → Configurações → **Aparelhos conectados**
2. **Conectar um aparelho**
3. Escanear o QR

A sessão é salva em `./auth-state/` (configurável via `WHATSAPP_SESSION_DIR`). Próximas execuções não pedem QR — conecta direto.

Para ler o QR como PNG (ex: num cliente MCP), leia o resource `whatsapp://qr` — retorna `data_url` (base64 PNG).

## Uso via CLI (recomendado pra maioria dos casos)

Depois de pareado, invoque direto:

```bash
whatsapp send "+5521999999999" "Passando só pra avisar."

whatsapp media "+5521999999999" /path/para/boleto.pdf \
  --caption "Seu boleto em anexo" --name "boleto-2026-04.pdf"

whatsapp billing "+5521999999999" \
  --amount 299.90 --due 2026-05-10 --invoice BOL-42 \
  --name "João Silva" --link "https://pay.ex/42" --company "CPZ Seguros"

whatsapp reminder "+5521999999999" \
  --doc rg --due 2026-05-03 --name "João Silva" --company "CPZ Seguros"

whatsapp health --json --quiet | jq '.connection'   # pre-flight check
whatsapp logout
```

Flags globais: `--json` (saída parseável), `--quiet` (suprime logs humanos em stderr), `--timeout <ms>` (padrão 60s).

Rode `whatsapp --help` pra ver tudo.

**Latência típica:** 3-5s por comando (handshake Baileys a cada invocação). Se isso for dealbreaker, ou se você precisa ler mensagens, use o MCP server (abaixo).

## Uso via MCP

Necessário quando você precisa de inbox em tempo real (`list_chats`, `read_chat`) ou status de entrega persistente. Adicione ao `~/.claude.json` ou equivalente:

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

// Cobrança (interest_policy opcional — default: 2% multa + 1% ao mês)
{ "tool": "send_billing_alert", "arguments": {
  "to": "+5521999999999",
  "amount": 299.90,
  "due_date": "2026-05-10",
  "invoice_number": "BOL-2026-0042",
  "name": "João Silva",
  "payment_link": "https://pay.cpz.com.br/bol42",
  "company_name": "CPZ Seguros",
  "interest_policy": { "monthlyInterestPct": 1, "penaltyPct": 2 }
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
npm run typecheck  # tsc --noEmit
npm test           # vitest (unit tests)
npm run test:watch # vitest em modo interativo
npm run audit:ci   # npm audit --audit-level=high (production-only)
```

### Testes

Cobertura atual via [vitest](https://vitest.dev/): **79 unit tests** em `tests/`:
- `config.test.ts` — `normalizeJid`, `isAllowedMimeType`, `media.allowedDirs`
- `rate-limiter.test.ts` — FIFO, refill, dispose, fairness
- `retry.test.ts` — `categorizeError` (todos os ramos) + `RetryHandler`
- `circuit-breaker.test.ts` — CLOSED/OPEN/HALF_OPEN transições
- `path-safety.test.ts` — allowlist, traversal, symlinks, null bytes
- `inbox-store.test.ts` — ring buffer, eviction global, preview
- `status-tracker.test.ts` — mapeamento proto, FIFO bounded
- `template-engine.test.ts` — render, overdue, validate, `computeOverdueAmount`
- `tool-response.test.ts` — envelope padronizado de erro

Rode `npm test` antes de abrir PR. CI roda em Node 20 e 22 via GitHub Actions.

### Configuração sensível

Variáveis que afetam segurança/observabilidade (todas opcionais):

- `WHATSAPP_ALLOWED_DIRS` — colon-separated. Whitelist de diretórios de onde o CLI/MCP pode ler anexos. Default: `$HOME:$(pwd)`. Realpath é aplicado → symlinks que apontam pra fora são bloqueados.
- `WHATSAPP_LOG_LEVEL` — pino level. **⚠️ Nunca use `debug`/`trace` em produção** — esses níveis logam material de sessão (chaves de criptografia Baileys).
- `WHATSAPP_DEFAULT_COUNTRY_CODE` — DDI default quando o número não é E.164. Default `55`.
- `WHATSAPP_SESSION_DIR` — onde salvar a sessão. Default `./auth-state/`. **Não commite.**

Veja [.env.example](.env.example) pra lista completa.

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

## Segurança

- **Nunca commite** `auth-state/` — contém as credenciais da sessão (equivale à chave do seu WhatsApp).
- O diretório de sessão default é `./auth-state/` e já está no `.gitignore`.
- Em caso de suspeita de vazamento, rode `whatsapp logout` (apaga local) **e** desconecte o aparelho em *WhatsApp → Aparelhos conectados*.
- Encontrou vulnerabilidade? Abra uma [security advisory privada](https://github.com/ftaricano/mcp-whatsapp/security/advisories/new) — não reporte em issue pública.

## Contribuindo

PRs bem-vindos. Antes de abrir:

1. `npm run build` passa sem erro
2. `npm run smoke -- status` funciona numa sessão pareada
3. Descrição do PR explica o *porquê*, não só o *o quê*

Bugs e feature requests em [Issues](https://github.com/ftaricano/mcp-whatsapp/issues).

## Licença

[MIT](LICENSE) © Fernando Taricano

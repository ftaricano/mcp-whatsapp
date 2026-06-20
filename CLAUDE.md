# CLAUDE.md -- mcp-whatsapp

Servidor MCP + CLI para envio de mensagens WhatsApp via Baileys (autenticacao por QR code), sem token oficial Meta.

## O que e

Distribui dois binarios: `whatsapp` (CLI on-demand para scripts/cron/agentes) e `mcp-whatsapp` (servidor MCP long-running para leitura de inbox e status de entrega em tempo real). Usa a sessao do WhatsApp Web do numero pareado -- funciona com conta pessoal ou Business. Consumido principalmente por automacoes CPZ (cobranças, lembretes de documentos) e por agentes via MCP.

## Stack & estrutura

Node.js >= 20 + TypeScript strict + @whiskeysockets/baileys + @modelcontextprotocol/sdk + zod + pino + vitest

```
src/
├── index.ts               # bootstrap MCP server + shutdown
├── cli.ts                 # CLI entry point (whatsapp send/media/billing/reminder/...)
├── config/whatsapp.ts     # zod-validated config, JID normalization, allowedDirs
├── services/
│   ├── whatsapp-api.ts    # Baileys socket, QR handling, send, reconnect, status tracking
│   ├── template-engine.ts # templates pt-BR (lembrete, cobrança)
│   ├── inbox-store.ts     # ring buffer de mensagens recebidas (estado em memória)
│   └── status-tracker.ts  # mapeamento de status de entrega, FIFO bounded
├── tools/                 # MCP tools (send_message, send_media, send_billing_alert, ...)
├── resources/             # MCP resources (qr, health, config, templates, statuses)
└── utils/
    ├── rate-limiter.ts    # token bucket separado para texto e mídia
    ├── retry.ts           # exponential backoff + jitter; não retenta 4xx/auth
    ├── circuit-breaker.ts # abre após 5 falhas, tenta reset em 30s
    ├── path-safety.ts     # allowlist + traversal guard + symlinks
    └── tool-response.ts   # envelope padronizado de resposta/erro MCP
auth-state/                # sessão Baileys persistida -- NUNCA commitar
build/                     # output tsc (gerado)
tests/                     # 85 unit tests vitest
```

## Como rodar / validar

```bash
# setup
npm install
npm run build

# dev (watch)
npm run dev

# typecheck + testes + audit (obrigatorio antes de DONE)
npm run typecheck
npm test
npm run audit:ci

# smoke test fim-a-fim (requer sessao pareada)
npm run smoke -- status

# primeiro pareamento (QR no stderr)
node build/index.js    # MCP server -- QR aparece no stderr
# ou
node build/cli.js pair # CLI
```

## Invariantes / regras criticas

- **auth-state/ nunca commitado**: contem credenciais equivalentes a chave do WhatsApp; esta no .gitignore. Se suspeitar de leak, rodar `whatsapp logout` e desconectar em WhatsApp > Aparelhos conectados.
- **WHATSAPP_LOG_LEVEL nunca debug/trace em producao**: esses niveis logam payloads Baileys incluindo material de sessao. Default `info`.
- **Allowlist de destinatarios em MCP/agentes**: sempre configurar `WHATSAPP_ALLOWED_RECIPIENTS` quando o servidor rodar com acesso de agente -- previne envio nao autorizado.
- **WHATSAPP_ALLOWED_DIRS menor possivel**: default e so o cwd do processo. Realpath e aplicado; symlinks que apontam pra fora sao bloqueados.
- **Grupos bloqueados por default**: `WHATSAPP_ENABLE_GROUPS=false`. Flows de grupo sao menos testados; habilitar explicitamente so quando necessario.
- **Pacote npm escopado**: o nome canonico e `@ftaricano/mcp-whatsapp`; o nome sem escopo `mcp-whatsapp` no npm pertence a outro projeto.
- **Estado de inbox/status e em memoria**: `list_chats`, `read_chat` e `get_message_status` so conhecem eventos da execucao atual do servidor. Reiniciou, perdeu.

## Gotchas

- Baileys nao e API oficial Meta; mudancas no WhatsApp Web podem quebrar pareamento/envio sem aviso.
- QR nao aparece: checar se stderr esta sendo suprimido. Rodar `node build/index.js` direto para ver o output.
- Sessao em loop de reconexao: provavelmente corrompida. `rm -rf auth-state/` e parear de novo.
- Latencia CLI e 3-5s por invocacao (handshake Baileys a cada chamada). Para throughput alto ou leitura de inbox, usar o MCP server.
- Status de entrega chegam via `messages.update`; propagacao pode levar segundos e nem todo caso vira "delivered/read".

## Documentacao canonica

- Skill: `whatsapp-cli` (em `skills/`) | Nota: n/a | Tracking: n/a

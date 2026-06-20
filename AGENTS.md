# AGENTS.md -- mcp-whatsapp

As regras operacionais deste repo sao canonicas em [CLAUDE.md](CLAUDE.md) (fonte unica para Claude/Codex/Hermes). Leia-o antes de tocar em codigo.

TL;DR das invariantes:
- `auth-state/` nunca commitado -- credenciais da sessao WhatsApp; leak exige logout + desconexao no celular
- `WHATSAPP_LOG_LEVEL` nunca `debug`/`trace` em producao -- logam material de sessao Baileys
- `WHATSAPP_ALLOWED_RECIPIENTS` obrigatorio em deployments MCP/agente -- previne envio nao autorizado
- Grupos bloqueados por default (`WHATSAPP_ENABLE_GROUPS=false`) -- flows menos testados
- Estado de inbox/status e em memoria -- reiniciar o servidor apaga historico da sessao

Validar: `npm run typecheck && npm test && npm run audit:ci`

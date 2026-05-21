# Security Policy

`mcp-whatsapp` controls a real WhatsApp Web session through Baileys. Treat the local session files and any pairing QR as credentials.

## Supported Versions

Only the latest `main` branch and the latest published package are supported for security fixes.

## Reporting a Vulnerability

Use GitHub private vulnerability reporting:

https://github.com/ftaricano/mcp-whatsapp/security/advisories/new

Do not open a public issue with secrets, QR codes, screenshots of pairing flows, `auth-state/` contents, or debug logs.

## Sensitive Local Data

Never commit or publish:

- `auth-state/`
- `auth-state-*/`
- `.wwebjs_auth/`
- `session.json`
- `*.session`
- `*.session.json`
- `tokens.json`
- QR screenshots or QR data URLs
- `WHATSAPP_LOG_LEVEL=debug` or `trace` logs

The session directory contains WhatsApp credentials. If it leaks, revoke it from the phone:

1. Open WhatsApp on the phone.
2. Go to Settings -> Linked Devices.
3. Log out the leaked linked device.
4. Run `whatsapp logout` locally or delete the affected `auth-state/` directory.

## Safe MCP Configuration

For MCP clients and autonomous agents, prefer explicit constraints:

```json
{
  "env": {
    "WHATSAPP_ALLOWED_RECIPIENTS": "+5521999999999",
    "WHATSAPP_ALLOWED_DIRS": "/absolute/path/to/attachments",
    "WHATSAPP_LOG_LEVEL": "info"
  }
}
```

`WHATSAPP_ALLOWED_DIRS` defaults to the process working directory. Widen it only to directories that intentionally contain sendable attachments.

`WHATSAPP_ALLOWED_RECIPIENTS` is optional, but recommended for MCP use. When set, every send target must match the allowlist after normalization.

Group sends are disabled by default. Set `WHATSAPP_ENABLE_GROUPS=true` only after you have tested the target group flow.

## Known Security Limits

- This is not the official Meta WhatsApp Cloud API.
- Baileys depends on WhatsApp Web behavior and can break when upstream changes.
- Pairing QR codes are sensitive until they expire or are scanned.
- Media sending reads files from local disk. Path traversal and symlink escapes are blocked, but operators still choose which directories are allowed.
- Delivery/read status and inbox data are in-memory only and should not be treated as an audit log.
- This project cannot prevent account bans caused by spam-like or abusive sending patterns.

## Package Name

The npm package name for this project is `@ftaricano/mcp-whatsapp`. The unscoped package `mcp-whatsapp` on npm is a different project.

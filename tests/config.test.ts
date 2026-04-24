import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as os from 'os';

/**
 * Cada teste reseta o módulo com `vi.resetModules()` e recria o singleton
 * depois de setar as envs — assim o ConfigManager lê as vars certas.
 */
async function freshConfig(env: Record<string, string | undefined>) {
  const original = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  const mod = await import('../src/config/whatsapp.js');
  (mod.ConfigManager as unknown as { instance: unknown }).instance = null;
  const reset = () => {
    for (const k of Object.keys(env)) delete process.env[k];
    for (const [k, v] of Object.entries(original)) process.env[k] = v;
  };
  return { ConfigManager: mod.ConfigManager, reset };
}

describe('ConfigManager', () => {
  let cleanupFns: Array<() => void> = [];

  beforeEach(() => {
    cleanupFns = [];
  });

  afterEach(() => {
    cleanupFns.forEach((f) => f());
  });

  describe('normalizeJid', () => {
    it('accepts full JIDs unchanged', async () => {
      const { ConfigManager, reset } = await freshConfig({});
      cleanupFns.push(reset);
      const cfg = ConfigManager.getInstance();
      expect(cfg.normalizeJid('5521999999999@s.whatsapp.net')).toBe('5521999999999@s.whatsapp.net');
      expect(cfg.normalizeJid('120363000000000000@g.us')).toBe('120363000000000000@g.us');
    });

    it('prepends default country code for 10-11 digit national numbers', async () => {
      const { ConfigManager, reset } = await freshConfig({});
      cleanupFns.push(reset);
      const cfg = ConfigManager.getInstance();
      expect(cfg.normalizeJid('21999999999')).toBe('5521999999999@s.whatsapp.net');
      expect(cfg.normalizeJid('2199999999')).toBe('552199999999@s.whatsapp.net');
    });

    it('keeps E.164 numbers (13+ digits) without prepending', async () => {
      const { ConfigManager, reset } = await freshConfig({});
      cleanupFns.push(reset);
      const cfg = ConfigManager.getInstance();
      expect(cfg.normalizeJid('+5521999999999')).toBe('5521999999999@s.whatsapp.net');
      expect(cfg.normalizeJid('5521999999999')).toBe('5521999999999@s.whatsapp.net');
    });

    it('honors WHATSAPP_DEFAULT_COUNTRY_CODE', async () => {
      const { ConfigManager, reset } = await freshConfig({ WHATSAPP_DEFAULT_COUNTRY_CODE: '1' });
      cleanupFns.push(reset);
      const cfg = ConfigManager.getInstance();
      expect(cfg.normalizeJid('4155551234')).toBe('14155551234@s.whatsapp.net');
    });

    it('rejects obvious garbage', async () => {
      const { ConfigManager, reset } = await freshConfig({});
      cleanupFns.push(reset);
      const cfg = ConfigManager.getInstance();
      expect(() => cfg.normalizeJid('')).toThrow(/Invalid phone/);
      expect(() => cfg.normalizeJid('abc')).toThrow(/Invalid phone/);
      expect(() => cfg.normalizeJid('1234')).toThrow(/Invalid phone/);
      expect(() => cfg.normalizeJid('1'.repeat(20))).toThrow(/Invalid phone/);
    });

    it('rejects malformed @s.whatsapp.net JIDs', async () => {
      const { ConfigManager, reset } = await freshConfig({});
      cleanupFns.push(reset);
      const cfg = ConfigManager.getInstance();
      expect(() => cfg.normalizeJid('abc@s.whatsapp.net')).toThrow(/Invalid JID/);
      expect(() => cfg.normalizeJid('@s.whatsapp.net')).toThrow(/Invalid JID/);
    });
  });

  describe('isAllowedMimeType', () => {
    it('defaults exclude text/plain (security fix A4)', async () => {
      const { ConfigManager, reset } = await freshConfig({});
      cleanupFns.push(reset);
      const cfg = ConfigManager.getInstance();
      expect(cfg.isAllowedMimeType('text/plain')).toBe(false);
    });

    it('allows common business attachments', async () => {
      const { ConfigManager, reset } = await freshConfig({});
      cleanupFns.push(reset);
      const cfg = ConfigManager.getInstance();
      expect(cfg.isAllowedMimeType('application/pdf')).toBe(true);
      expect(cfg.isAllowedMimeType('image/jpeg')).toBe(true);
      expect(cfg.isAllowedMimeType('text/csv')).toBe(true);
    });
  });

  describe('media.allowedDirs', () => {
    it('defaults to HOME + CWD', async () => {
      const { ConfigManager, reset } = await freshConfig({});
      cleanupFns.push(reset);
      const cfg = ConfigManager.getInstance().getConfig();
      const resolvedHome = path.resolve(os.homedir());
      const resolvedCwd = path.resolve(process.cwd());
      expect(cfg.media.allowedDirs).toEqual(expect.arrayContaining([resolvedHome, resolvedCwd]));
    });

    it('parses WHATSAPP_ALLOWED_DIRS as colon-separated list', async () => {
      const { ConfigManager, reset } = await freshConfig({
        WHATSAPP_ALLOWED_DIRS: '/tmp/a:/tmp/b',
      });
      cleanupFns.push(reset);
      const cfg = ConfigManager.getInstance().getConfig();
      expect(cfg.media.allowedDirs).toEqual(['/tmp/a', '/tmp/b']);
    });
  });
});

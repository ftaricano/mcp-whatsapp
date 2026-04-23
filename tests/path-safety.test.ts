import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveSafePath, parseAllowedDirs } from '../src/utils/path-safety.js';

describe('parseAllowedDirs', () => {
  it('defaults to HOME + CWD when unset', () => {
    const dirs = parseAllowedDirs(undefined);
    expect(dirs).toEqual(
      expect.arrayContaining([path.resolve(os.homedir()), path.resolve(process.cwd())]),
    );
  });

  it('parses colon-separated list and trims whitespace', () => {
    expect(parseAllowedDirs('/tmp/a:/tmp/b : /tmp/c')).toEqual([
      '/tmp/a',
      '/tmp/b',
      '/tmp/c',
    ]);
  });

  it('expands leading ~ to HOME', () => {
    const dirs = parseAllowedDirs('~/sub');
    expect(dirs[0]).toBe(path.resolve(path.join(os.homedir(), 'sub')));
  });

  it('skips empty fragments', () => {
    expect(parseAllowedDirs('/tmp/a::/tmp/b')).toEqual(['/tmp/a', '/tmp/b']);
  });
});

describe('resolveSafePath', () => {
  let tmpRoot: string;
  let allowedDir: string;
  let allowedFile: string;
  let outsideFile: string;
  let symlinkInside: string;

  beforeAll(async () => {
    // NOTE: intentionally do NOT realpath here — we want the allowlist we
    // pass into resolveSafePath() to contain the symlinked path (on macOS
    // /var → /private/var). The production code must realpath the allowlist
    // itself; if it regresses, these tests will fail.
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-test-'));
    allowedDir = path.join(tmpRoot, 'allowed');
    const outsideDir = path.join(tmpRoot, 'outside');
    await fs.mkdir(allowedDir);
    await fs.mkdir(outsideDir);
    allowedFile = path.join(allowedDir, 'ok.txt');
    outsideFile = path.join(outsideDir, 'bad.txt');
    await fs.writeFile(allowedFile, 'ok');
    await fs.writeFile(outsideFile, 'bad');
    symlinkInside = path.join(allowedDir, 'link-out.txt');
    try {
      await fs.symlink(outsideFile, symlinkInside);
    } catch {
      // symlinks may fail on some CI envs; the test will skip that branch
    }
  });

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('rejects empty string', async () => {
    await expect(resolveSafePath('', { allowedDirs: [tmpRoot], blockSymlinksOutsideAllowed: true }))
      .rejects.toThrow(/non-empty/);
  });

  it('rejects null byte', async () => {
    await expect(resolveSafePath('a\0b', { allowedDirs: [tmpRoot], blockSymlinksOutsideAllowed: true }))
      .rejects.toThrow(/null byte/);
  });

  it('allows files inside allowedDirs even when the allowlist is a symlink', async () => {
    const p = await resolveSafePath(allowedFile, {
      allowedDirs: [allowedDir],
      blockSymlinksOutsideAllowed: true,
    });
    expect(p).toBe(await fs.realpath(allowedFile));
  });

  it('rejects files outside allowedDirs', async () => {
    await expect(
      resolveSafePath(outsideFile, {
        allowedDirs: [allowedDir],
        blockSymlinksOutsideAllowed: true,
      }),
    ).rejects.toThrow(/outside the allowed directories/);
  });

  it('rejects ../ traversal', async () => {
    const traversal = path.join(tmpRoot, 'allowed', '..', 'outside', 'bad.txt');
    await expect(
      resolveSafePath(traversal, {
        allowedDirs: [allowedDir],
        blockSymlinksOutsideAllowed: true,
      }),
    ).rejects.toThrow(/outside the allowed directories/);
  });

  it('resolves symlinks and rejects if target escapes allowlist', async () => {
    let linkExists = true;
    try {
      await fs.lstat(symlinkInside);
    } catch {
      linkExists = false;
    }
    if (!linkExists) return;
    await expect(
      resolveSafePath(symlinkInside, {
        allowedDirs: [allowedDir],
        blockSymlinksOutsideAllowed: true,
      }),
    ).rejects.toThrow(/outside the allowed directories/);
  });

  it('reports missing files as File not found', async () => {
    await expect(
      resolveSafePath(path.join(tmpRoot, 'allowed', 'nope.txt'), {
        allowedDirs: [tmpRoot],
        blockSymlinksOutsideAllowed: true,
      }),
    ).rejects.toThrow(/File not found/);
  });
});

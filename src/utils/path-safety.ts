import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface PathPolicy {
  allowedDirs: string[];
  blockSymlinksOutsideAllowed: boolean;
}

/**
 * Resolve + realpath a user-provided file path and ensure it lives inside one
 * of the allowed directories. Protects against:
 *  - absolute paths to sensitive files (/etc/passwd, ~/.ssh/id_rsa, …)
 *  - `../` traversal
 *  - symlinks that point outside the allowlist
 *
 * Throws with a sanitized message on violation; never includes the resolved
 * real path in the error, only the original input.
 */
export async function resolveSafePath(
  input: string,
  policy: PathPolicy,
): Promise<string> {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('File path must be a non-empty string');
  }
  // Reject null bytes (path truncation attack)
  if (input.includes('\0')) {
    throw new Error('File path contains null bytes');
  }

  const resolved = path.resolve(input);

  // realpath forces symlink resolution — if the file does not exist we surface
  // "File not found" (same message shape as the previous validateMediaFile).
  let real: string;
  try {
    real = await fs.realpath(resolved);
  } catch {
    throw new Error(`File not found: ${input}`);
  }

  const normalizedReal = path.normalize(real);
  // Realpath allowed dirs too — on macOS /var → /private/var, and any user
  // might point WHATSAPP_ALLOWED_DIRS at a symlink. Without this the file's
  // real path is compared against a symlinked parent and falsely rejected.
  const realDirs = await Promise.all(
    policy.allowedDirs.map(async (dir) => {
      try {
        return path.normalize(await fs.realpath(dir));
      } catch {
        return path.normalize(path.resolve(dir));
      }
    }),
  );
  const ok = realDirs.some((dir) => isWithin(normalizedReal, dir));
  if (!ok) {
    throw new Error(
      `File path is outside the allowed directories: ${input}. ` +
        `Configure WHATSAPP_ALLOWED_DIRS if this is intentional.`,
    );
  }
  return normalizedReal;
}

function isWithin(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Parse WHATSAPP_ALLOWED_DIRS (colon-separated, tilde-expanded).
 * Defaults to [HOME, CWD] — ou seja: o CLI pode anexar qualquer coisa dentro
 * do home do usuário ou do diretório de onde foi invocado.
 */
export function parseAllowedDirs(envValue: string | undefined): string[] {
  const home = os.homedir();
  const cwd = process.cwd();
  if (!envValue) return [home, cwd].map((p) => path.resolve(p));
  return envValue
    .split(':')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith('~') ? path.join(home, p.slice(1)) : p))
    .map((p) => path.resolve(p));
}

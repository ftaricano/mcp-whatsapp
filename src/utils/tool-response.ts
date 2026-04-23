/**
 * Uniform failure helper for MCP tool handlers. Success shapes remain
 * flat (handler-specific) to preserve the v2.0 public response format; only
 * the failure envelope is centralized so every tool emits the same
 * `{ success: false, error: { type, message }, ... }` skeleton.
 */
export interface ToolError {
  success: false;
  error: { type: string; message: string };
  timestamp: string;
  [key: string]: unknown;
}

export function fail(
  type: string,
  err: unknown,
  context: Record<string, unknown> = {},
): ToolError {
  const message = err instanceof Error ? err.message : String(err);
  return {
    success: false,
    error: { type, message },
    ...context,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Convenience for validation errors coming from zod `safeParse`.
 */
export function failValidation(err: unknown): ToolError {
  const message = err instanceof Error ? err.message : String(err);
  return {
    success: false,
    error: { type: 'validation_error', message },
    timestamp: new Date().toISOString(),
  };
}

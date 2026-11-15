/** Keys whose values never reach the log, whatever their nesting or case. */
const SECRET_KEY =
  /password|passphrase|secret|token|^otp$|backup.?codes?|api.?key|authorization|cookie/i;
const REDACTED = "[redacted]";
const MAX_DEPTH = 5;

/**
 * Copies metadata with secret-looking values replaced, so a careless
 * `recordAuditEvent` call can't put a password or token in the log.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SECRET_KEY.test(key) ? REDACTED : redact(item, depth + 1),
      ]),
    );
  }
  return value;
}

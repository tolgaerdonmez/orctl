/**
 * Secret redaction (plan §9 S1/S8). Anything that may carry an OpenRouter key passes through
 * here before it reaches a terminal, a log line or an error message.
 */

/**
 * A full key is long (sk-or-v1- plus 64 hex). Short forms such as the server's own masked label
 * "sk-or-v1-0e6...1c96" are display values and stay readable.
 */
const KEY_PATTERN = /sk-or-[A-Za-z0-9_-]{16,}/g;
const BEARER_PATTERN = /(authorization\s*[:=]\s*"?\s*bearer\s+)[^\s",}]+/gi;
const BARE_BEARER_PATTERN = /\bBearer\s+(?!\*\*\*)[A-Za-z0-9._~+/=-]{8,}/g;
const KEY_FIELD_PATTERN = /("key"\s*:\s*")[^"]*(")/g;

/** `sk-or-v1-abc…1c96` → `sk-or-…1c96`. Never reveals more than the last four characters. */
export function maskKey(key: string): string {
  const tail = key.length > 10 ? key.slice(-4) : "";
  return `sk-or-…${tail}`;
}

export function redact(text: string): string {
  return text
    .replace(BEARER_PATTERN, "$1***")
    .replace(BARE_BEARER_PATTERN, "Bearer ***")
    .replace(KEY_FIELD_PATTERN, "$1***$2")
    .replace(KEY_PATTERN, (m) => maskKey(m));
}

const SENSITIVE_FIELDS = new Set(["key", "authorization", "apikey", "api_key"]);

/** Deep copy with every string redacted and known secret-bearing fields blanked. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[depth]";
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_FIELDS.has(k.toLowerCase()) && v != null ? "***" : redactValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** True when the text still contains something that looks like a full OpenRouter key. */
export function containsKeyMaterial(text: string): boolean {
  return /sk-or-[A-Za-z0-9_-]{16,}/.test(text);
}

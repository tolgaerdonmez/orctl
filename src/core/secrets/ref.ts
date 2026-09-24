import { usageError } from "../errors.ts";

/**
 * Secret references (plan §6.4). Config files only ever hold one of these strings; the value
 * behind it is resolved at call time and kept in memory only.
 *
 *   keychain:<service>/<account>   macOS Keychain generic password (default target)
 *   op://<vault>/<item>/<field>    1Password CLI, read-only
 *   env:<VAR>                      environment variable, read-only
 *   file:<path>                    file with 0600 permissions, read-only
 */
export type SecretRef =
  | { scheme: "keychain"; raw: string; service: string; account: string }
  | { scheme: "op"; raw: string }
  | { scheme: "env"; raw: string; name: string }
  | { scheme: "file"; raw: string; path: string };

export type SecretScheme = SecretRef["scheme"];

const KEYCHAIN_SERVICE = /^[A-Za-z0-9._-]{1,64}$/;
/** Characters that are safe to pass through `security -i` inside double quotes. */
export const KEYCHAIN_SAFE = /^[A-Za-z0-9 ._/-]{1,128}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OP_REF = /^op:\/\/[^/\s][^/]*\/[^/]+\/.+$/;

export function parseSecretRef(raw: string): SecretRef {
  const value = raw.trim();
  if (value.startsWith("sk-or-")) {
    throw usageError(
      "A secret reference was expected, but this looks like a raw API key.",
      "Never put key values in flags or config. Use --mgmt-key-stdin, or a reference such as keychain:orctl/<profile>/management.",
    );
  }
  if (value.startsWith("keychain:")) {
    const body = value.slice("keychain:".length);
    const slash = body.indexOf("/");
    const service = slash > 0 ? body.slice(0, slash) : "";
    const account = slash > 0 ? body.slice(slash + 1) : "";
    if (!KEYCHAIN_SERVICE.test(service) || !KEYCHAIN_SAFE.test(account)) {
      throw usageError(
        `Invalid keychain reference "${value}".`,
        "Expected keychain:<service>/<account>, for example keychain:orctl/personal/management.",
      );
    }
    return { scheme: "keychain", raw: value, service, account };
  }
  if (value.startsWith("op://")) {
    if (!OP_REF.test(value)) {
      throw usageError(`Invalid 1Password reference "${value}".`, "Expected op://<vault>/<item>/<field>.");
    }
    return { scheme: "op", raw: value };
  }
  if (value.startsWith("env:")) {
    const name = value.slice("env:".length);
    if (!ENV_NAME.test(name))
      throw usageError(`Invalid environment reference "${value}".`, "Expected env:<VAR>.");
    return { scheme: "env", raw: value, name };
  }
  if (value.startsWith("file:")) {
    const path = value.slice("file:".length);
    if (!path) throw usageError(`Invalid file reference "${value}".`, "Expected file:<path>.");
    return { scheme: "file", raw: value, path };
  }
  throw usageError(
    `Unknown secret reference "${value}".`,
    "Supported: keychain:<service>/<account>, op://<vault>/<item>/<field>, env:<VAR>, file:<path>.",
  );
}

export function isSecretRef(raw: string): boolean {
  try {
    parseSecretRef(raw);
    return true;
  } catch {
    return false;
  }
}

export type KeyRole = "management" | "user";

/** Default Keychain location orctl writes profile keys to (plan §6.4 naming). */
export function defaultKeychainRef(profile: string, role: KeyRole): string {
  return `keychain:orctl/${profile}/${role}`;
}

/** Keychain location for keys orctl creates (keys create --store / rotate). */
export function generatedKeyRef(profile: string, name: string, hash: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "key";
  return `keychain:orctl/${profile}/keys/${slug}-${hash.slice(0, 8)}`;
}

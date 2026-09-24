import { OrctlError } from "../errors.ts";
import type { Secret } from "../secret.ts";
import { parseSecretRef, type SecretRef, type SecretScheme } from "./ref.ts";

export interface SecretBackend {
  readonly scheme: SecretScheme;
  readonly writable: boolean;
  read(ref: SecretRef): Promise<Secret>;
  write?(ref: SecretRef, secret: Secret, label: string): Promise<void>;
  /** Returns false when there was nothing to delete. */
  delete?(ref: SecretRef): Promise<boolean>;
}

/**
 * Resolves reference strings to secrets through the registered backends. Resolved values are
 * memoized for the life of one run, so a Keychain or `op` prompt happens at most once.
 */
export class SecretStore {
  readonly #backends = new Map<SecretScheme, SecretBackend>();
  readonly #memo = new Map<string, Promise<Secret>>();

  constructor(backends: readonly SecretBackend[]) {
    for (const backend of backends) this.#backends.set(backend.scheme, backend);
  }

  backend(scheme: SecretScheme): SecretBackend {
    const backend = this.#backends.get(scheme);
    if (!backend) throw new OrctlError("NO_CREDENTIAL", `No secret backend for ${scheme}: references.`);
    return backend;
  }

  resolve(raw: string): Promise<Secret> {
    const cached = this.#memo.get(raw);
    if (cached) return cached;
    const ref = parseSecretRef(raw);
    const pending = this.backend(ref.scheme).read(ref);
    this.#memo.set(raw, pending);
    pending.catch(() => this.#memo.delete(raw));
    return pending;
  }

  canWrite(raw: string): boolean {
    return this.#backends.get(parseSecretRef(raw).scheme)?.writable ?? false;
  }

  async write(raw: string, secret: Secret, label: string): Promise<void> {
    const ref = parseSecretRef(raw);
    const backend = this.backend(ref.scheme);
    if (!backend.writable || !backend.write) {
      throw new OrctlError("USAGE", `orctl cannot write to ${ref.scheme}: references.`, {
        hint: "Use a keychain: target, or deliver the key with --show / --copy.",
      });
    }
    await backend.write(ref, secret, label);
    this.#memo.set(raw, Promise.resolve(secret));
  }

  async delete(raw: string): Promise<boolean> {
    const ref = parseSecretRef(raw);
    const backend = this.backend(ref.scheme);
    this.#memo.delete(raw);
    if (!backend.delete) return false;
    return backend.delete(ref);
  }
}

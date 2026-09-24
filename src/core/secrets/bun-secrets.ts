import { OrctlError } from "../errors.ts";
import { KEY_SHAPE, Secret } from "../secret.ts";
import type { SecretRef } from "./ref.ts";
import type { SecretBackend } from "./store.ts";

/**
 * `keychain:` references on Linux, through Bun.secrets (the Secret Service / libsecret). macOS
 * keeps using /usr/bin/security (plan §6.5: an item created by the fixed, Apple-signed binary does
 * not re-prompt after every rebuild, and Bun.secrets is still marked experimental).
 */
export interface SecretsApi {
  get(o: { service: string; name: string }): Promise<string | null>;
  set(o: { service: string; name: string; value: string }): Promise<void>;
  delete(o: { service: string; name: string }): Promise<boolean>;
}

type KeychainRef = Extract<SecretRef, { scheme: "keychain" }>;

export function bunSecretsApi(): SecretsApi | undefined {
  const api = (Bun as unknown as { secrets?: SecretsApi }).secrets;
  return api && typeof api.get === "function" ? api : undefined;
}

export function createBunSecretsBackend(api: SecretsApi): SecretBackend {
  const call = async <T>(what: string, ref: SecretRef, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      throw new OrctlError(
        "NO_CREDENTIAL",
        `Could not ${what} ${ref.raw} in the Secret Service: ${(err as Error).message}`,
        {
          hint: "Is a Secret Service provider (GNOME Keyring, KeePassXC) running and unlocked? Otherwise use op://, env: or file:.",
        },
      );
    }
  };
  return {
    scheme: "keychain",
    writable: true,
    async read(ref) {
      const { service, account } = ref as KeychainRef;
      const value = await call("read", ref, () => api.get({ service, name: account }));
      if (!value) throw new OrctlError("NO_CREDENTIAL", `Secret ${ref.raw} was not found.`);
      return new Secret(value);
    },
    async write(ref, secret) {
      const { service, account } = ref as KeychainRef;
      if (!KEY_SHAPE.test(secret.reveal())) {
        throw new OrctlError("USAGE", "Refusing to store a value that does not look like an OpenRouter key.");
      }
      await call("write", ref, () => api.set({ service, name: account, value: secret.reveal() }));
    },
    async delete(ref) {
      const { service, account } = ref as KeychainRef;
      return call("delete", ref, () => api.delete({ service, name: account }));
    },
  };
}

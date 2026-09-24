import { OrctlError } from "../../src/core/errors.ts";
import { Secret } from "../../src/core/secret.ts";
import type { SecretRef } from "../../src/core/secrets/ref.ts";
import type { SecretBackend } from "../../src/core/secrets/store.ts";

/** In-memory Keychain stand-in; `items` maps "service/account" to the stored value. */
export class FakeKeychain implements SecretBackend {
  readonly scheme = "keychain" as const;
  readonly writable = true;
  readonly items = new Map<string, { value: string; label: string }>();
  readonly log: string[] = [];

  #key(ref: SecretRef): string {
    if (ref.scheme !== "keychain") throw new Error("not a keychain ref");
    return `${ref.service}/${ref.account}`;
  }

  set(serviceAccount: string, value: string): this {
    this.items.set(serviceAccount, { value, label: "seed" });
    return this;
  }

  async read(ref: SecretRef): Promise<Secret> {
    this.log.push(`read ${ref.raw}`);
    const item = this.items.get(this.#key(ref));
    if (!item) throw new OrctlError("NO_CREDENTIAL", `Keychain item ${ref.raw} was not found.`);
    return new Secret(item.value);
  }

  async write(ref: SecretRef, secret: Secret, label: string): Promise<void> {
    this.log.push(`write ${ref.raw}`);
    this.items.set(this.#key(ref), { value: secret.reveal(), label });
  }

  async delete(ref: SecretRef): Promise<boolean> {
    this.log.push(`delete ${ref.raw}`);
    return this.items.delete(this.#key(ref));
  }
}

/** Fake 1Password: resolves op:// references from a map; read-only like the real backend. */
export class FakeOnePassword implements SecretBackend {
  readonly scheme = "op" as const;
  readonly writable = false;
  constructor(readonly values: Record<string, string> = {}) {}
  async read(ref: SecretRef): Promise<Secret> {
    const v = this.values[ref.raw];
    if (!v) throw new OrctlError("NO_CREDENTIAL", `op could not read ${ref.raw}`);
    return new Secret(v);
  }
}
